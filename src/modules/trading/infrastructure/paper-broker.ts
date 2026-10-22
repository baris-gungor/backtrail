import { randomUUID } from 'node:crypto';
import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In, IsNull } from 'typeorm';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain.error';
import { AnalysisQueryService } from '../../analysis/application/analysis-query.service';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import type { StrategyRunner } from '../../analysis/domain/strategy';
import { AssetsService } from '../../assets/application/assets.service';
import { EarningsService } from '../../market-data/application/earnings.service';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import { NotificationService } from '../../notifications/application/notification.service';
import type { FillNote } from '../../notifications/domain/messages';
import type { Bar } from '../../market-data/domain/bar';
import { PortfolioValuationService } from '../application/portfolio-valuation.service';
import type { BrokerPort, ManualOrderRequest } from '../domain/broker.port';
import {
  Account,
  checkExitLevels,
  closeSlot,
  feeFor,
  holdsPosition,
  slippedPrice,
  stepBar,
  type ClosedTrade,
  type ExitLevels,
  type ExitReason,
  type PositionSizing,
  type Slot,
  type StepContext,
  type StepEvent,
  earningsFilter,
  type DecisionFilter,
  closingSide,
  exitFee,
  type TradeDirection,
} from '../domain/execution';
import { limitFillPrice, transition, type OrderSide } from '../domain/order';
import { checkRisk, earningsRuleOf } from '../domain/risk';
import { signalRunner } from '../domain/signal-runner';
import { FLAT_SLOT, indexAtOrBefore, loadSlot, storeSlot } from '../domain/slot-state';
import { fillLogText } from '../domain/trade-log';
import { ClosedTradeEntity } from './closed-trade.entity';
import { FillEntity } from './fill.entity';
import { OrderEntity } from './order.entity';
import { PortfolioSubscriptionEntity } from './portfolio-subscription.entity';
import { PortfolioEntity } from './portfolio.entity';
import { PositionEntity } from './position.entity';
import { TRADING_STATE_ID, TradingStateEntity } from './trading-state.entity';

/** Paper trading trades closed 4h bars, the same bars signals and backtests use. */
const TIMEFRAME = '4h';

/** One subscription being processed: its strategy state and its pending order row. */
interface Lane {
  sub: PortfolioSubscriptionEntity;
  slot: Slot;
  runner: StrategyRunner;
  sizing: PositionSizing;
  /** Signal ids by bar time, to link orders to stored signals. */
  signalIds: Map<number, string>;
  /** First bar index to process. */
  start: number;
  pendingOrder: OrderEntity | null;
}

/** Everything one processing run of one portfolio on one asset reads and changes. */
interface Session {
  m: EntityManager;
  portfolio: PortfolioEntity;
  account: Account;
  assetId: string;
  /** For log lines. */
  symbol: string;
  bars: Bar[];
  /** Latest closed-bar close of the portfolio's other positions. */
  marks: Map<string, number>;
  dayStartEquity: Decimal | null;
  /** The asset's position row as loaded (null when flat). */
  position: PositionEntity | null;
  /** Levels and checked-through bar of a position without a subscription. */
  manual: { levels: ExitLevels; lastBarTime: Date | null } | null;
  /** Kill switch (global or this portfolio): no new automatic orders, no manual BUYs. */
  halted: boolean;
  /** Fills of this run, notified after the transaction commits. */
  fills: FillNote[];
  /** Earnings filter from the portfolio's risk rules. */
  filter?: DecisionFilter;
}

const ISO = (d: Date) => d.toISOString();

/**
 * `BrokerPort` that simulates fills on stored bars with the shared execution rules
 * (`trading/domain/execution`), so a subscription trades exactly like a backtest of its strategy.
 * All changes of one run happen in one transaction; runs of the same portfolio are serialized.
 */
@Injectable()
export class PaperBroker implements BrokerPort, OnApplicationShutdown {
  private readonly logger = new Logger(PaperBroker.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  /** processAsset calls, tracked from the start (they read before they reach a queue). */
  private readonly running = new Set<Promise<unknown>>();

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly marketData: MarketDataQueryService,
    private readonly catalog: StrategyCatalogService,
    private readonly analysis: AnalysisQueryService,
    private readonly valuation: PortfolioValuationService,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationService,
    private readonly earnings: EarningsService,
  ) {}

  async whenIdle(): Promise<void> {
    while (this.queues.size > 0 || this.running.size > 0) {
      await Promise.allSettled([...this.queues.values(), ...this.running]);
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.whenIdle();
  }

  processAsset(assetId: string, portfolioId?: string): Promise<void> {
    const task = this.processAssetNow(assetId, portfolioId);
    this.running.add(task);
    void task.catch(() => undefined).finally(() => this.running.delete(task));
    return task;
  }

  private async processAssetNow(assetId: string, portfolioId?: string): Promise<void> {
    const bars = await this.marketData.getHistory(assetId, TIMEFRAME, { completeOnly: true });
    if (bars.length === 0) return;

    const scope = portfolioId ? { portfolioId } : {};
    const repo = this.dataSource.manager;
    const ids = new Set<string>([
      ...(
        await repo.findBy(PortfolioSubscriptionEntity, { ...scope, assetId, isActive: true })
      ).map((s) => s.portfolioId),
      ...(
        await repo.findBy(OrderEntity, { ...scope, assetId, status: 'pending', source: 'manual' })
      ).map((o) => o.portfolioId),
      ...(await repo.findBy(PositionEntity, { ...scope, assetId, subscriptionId: IsNull() })).map(
        (p) => p.portfolioId,
      ),
    ]);
    if (ids.size === 0) return;
    // Demo-broker portfolios trade through their broker, not through simulated fills.
    const active = await repo.findBy(PortfolioEntity, {
      id: In([...ids]),
      isActive: true,
      mode: 'paper',
    });

    for (const portfolio of active) {
      try {
        const fills = await this.serial(portfolio.id, () =>
          this.process(portfolio.id, assetId, bars),
        );
        await this.notifyFills(portfolio, assetId, fills);
        await this.valuation.trySnapshot(portfolio.id);
      } catch (error) {
        this.logger.error({
          msg: `Paper processing failed for ${portfolio.name}`,
          portfolioId: portfolio.id,
          assetId,
          err: error,
        });
        if (portfolioId) throw error;
      }
    }
  }

  async placeOrder(portfolioId: string, request: ManualOrderRequest): Promise<string> {
    const orderId = await this.serial(portfolioId, () =>
      this.dataSource.transaction((m) => this.manualOrder(m, portfolioId, request)),
    );
    await this.valuation.trySnapshot(portfolioId);
    return orderId;
  }

  cancelOrder(portfolioId: string, orderId: string): Promise<void> {
    return this.serial(portfolioId, () =>
      this.dataSource.transaction(async (m) => {
        const order = await m.findOneBy(OrderEntity, { id: orderId, portfolioId });
        if (!order) throw new NotFoundError(`Order ${orderId} not found`);
        if (order.status !== 'pending') {
          throw new ConflictError(`Order ${orderId} is ${order.status}, not pending`);
        }
        order.status = transition(order.status, 'cancelled');
        await m.save(order);
        this.logger.log({ msg: 'Order cancelled', portfolioId, orderId });
        if (order.subscriptionId) {
          // The strategy's decision is dropped with it.
          const sub = await m.findOneByOrFail(PortfolioSubscriptionEntity, {
            id: order.subscriptionId,
          });
          sub.state = { ...sub.state, pending: null };
          await m.save(sub);
        }
      }),
    );
  }

  cancelAutomatic(portfolioId: string): Promise<void> {
    return this.serial(portfolioId, () =>
      this.dataSource.transaction(async (m) => {
        await m.update(
          OrderEntity,
          { portfolioId, status: 'pending', source: 'signal' },
          { status: 'cancelled', rejectReason: 'halted' },
        );
        const subs = await m.findBy(PortfolioSubscriptionEntity, { portfolioId });
        for (const sub of subs.filter((x) => x.state.pending)) {
          sub.state = { ...sub.state, pending: null };
          await m.save(sub);
        }
      }),
    );
  }

  deactivateSubscription(portfolioId: string, subscriptionId: string): Promise<void> {
    return this.serial(portfolioId, () =>
      this.dataSource.transaction(async (m) => {
        const sub = await m.findOneBy(PortfolioSubscriptionEntity, {
          id: subscriptionId,
          portfolioId,
        });
        if (!sub) throw new NotFoundError(`Subscription ${subscriptionId} not found`);
        sub.isActive = false;
        sub.state = { ...sub.state, pending: null };
        await m.save(sub);
        await m.update(
          OrderEntity,
          { subscriptionId, status: 'pending' },
          { status: 'cancelled', rejectReason: 'subscription_removed' },
        );
        // The position stays; from now on its levels are checked like a manual position's.
        await m.update(
          PositionEntity,
          { portfolioId, subscriptionId },
          { subscriptionId: null, lastBarTime: sub.lastBarTime },
        );
      }),
    );
  }

  /** Runs tasks of one portfolio one after another. */
  private serial<T>(portfolioId: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(portfolioId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    this.queues.set(portfolioId, tail);
    void tail.then(() => {
      if (this.queues.get(portfolioId) === tail) this.queues.delete(portfolioId);
    });
    return next;
  }

  // --- Bar processing -------------------------------------------------------------------------

  private async notifyFills(
    portfolio: PortfolioEntity,
    assetId: string,
    fills: FillNote[],
  ): Promise<void> {
    if (fills.length === 0 || !this.notifications.enabled) return;
    try {
      const { symbol } = await this.assets.findById(assetId);
      this.notifications.notify(
        this.notifications.texts.fillsMessage(portfolio.name, symbol, fills),
      );
    } catch (error) {
      this.logger.warn({ msg: 'Fill notification failed', portfolioId: portfolio.id, err: error });
    }
  }

  /** Returns the run's fills (after commit). */
  private process(portfolioId: string, assetId: string, bars: Bar[]): Promise<FillNote[]> {
    return this.dataSource.transaction(async (m) => {
      const s = await this.openSession(m, portfolioId, assetId, bars);
      const lanes = await this.lanes(s);
      const manualOrders = await m.find(OrderEntity, {
        where: { portfolioId, assetId, status: 'pending', source: 'manual' },
        order: { createdAt: 'ASC' },
      });

      const starts = [
        ...lanes.map((l) => l.start),
        ...manualOrders.map((o) => firstBarAtOrAfter(bars, o.createdAt)),
      ];
      if (s.manual) starts.push(nextBar(bars, s.manual.lastBarTime ?? s.position!.openedAt));
      const from = Math.min(bars.length, ...starts);

      for (let t = from; t < bars.length; t++) {
        for (const order of manualOrders) {
          if (order.status === 'pending' && bars[t].openTime >= order.createdAt) {
            await this.fillManualLimit(s, lanes, order, t);
          }
        }
        await this.checkManualLevels(s, t);
        for (const lane of lanes) {
          if (t >= lane.start) await this.stepLane(s, lane, t);
        }
      }
      await this.saveSession(s, lanes);
      return s.fills;
    });
  }

  private async openSession(
    m: EntityManager,
    portfolioId: string,
    assetId: string,
    bars: Bar[],
  ): Promise<Session> {
    const portfolio = await m.findOne(PortfolioEntity, {
      where: { id: portfolioId },
      lock: { mode: 'pessimistic_write' },
    });
    if (!portfolio) throw new NotFoundError(`Portfolio ${portfolioId} not found`);
    const positions = await m.findBy(PositionEntity, { portfolioId });
    const position = positions.find((p) => p.assetId === assetId) ?? null;
    const state = await m.findOneBy(TradingStateEntity, { id: TRADING_STATE_ID });
    const others = positions.filter((p) => p.assetId !== assetId).map((p) => p.assetId);
    return {
      m,
      portfolio,
      account: toAccount(portfolio, positions),
      assetId,
      symbol: await this.assets.findById(assetId).then(
        (a) => a.symbol,
        () => assetId,
      ),
      bars,
      marks: await this.valuation.latestCloses(others, TIMEFRAME),
      dayStartEquity: await this.valuation.dayStartEquity(portfolioId),
      position,
      manual:
        position && !position.subscriptionId
          ? { levels: levelsOf(position), lastBarTime: position.lastBarTime }
          : null,
      halted: Boolean(state?.halted || portfolio.haltedAt),
      fills: [],
      filter: await this.filterFor(portfolio, assetId, bars),
    };
  }

  private async filterFor(
    portfolio: PortfolioEntity,
    assetId: string,
    bars: Bar[],
  ): Promise<DecisionFilter | undefined> {
    const rule = earningsRuleOf(portfolio.riskRules);
    if (!rule) return undefined;
    const { sessionType } = await this.assets.findById(assetId);
    return earningsFilter(bars, await this.earnings.reports(assetId), rule, sessionType);
  }

  private async lanes(s: Session): Promise<Lane[]> {
    const subs = await s.m.find(PortfolioSubscriptionEntity, {
      where: { portfolioId: s.portfolio.id, assetId: s.assetId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    const pending = await s.m.findBy(OrderEntity, {
      subscriptionId: In(subs.map((sub) => sub.id)),
      status: 'pending',
    });

    const lanes: Lane[] = [];
    for (const sub of subs) {
      const { config, strategy } = await this.catalog.configById(sub.strategyConfigId);
      const signals = await this.analysis.storedSignals(s.assetId, sub.strategyConfigId);
      const slot = loadSlot(s.assetId, sub.state, s.bars);
      // A position closed outside the subscription (manual close) leaves the strategy flat.
      if (slot.entrySignalIndex >= 0 && s.position?.subscriptionId !== sub.id) {
        Object.assign(slot, { entrySignalIndex: -1, entryBarIndex: -1, levels: {} });
      }
      // A new subscription starts after the latest closed bar; history is not replayed.
      const start = sub.lastBarTime ? nextBar(s.bars, sub.lastBarTime) : s.bars.length;
      lanes.push({
        sub,
        slot,
        runner:
          sub.source === 'signals'
            ? signalRunner(s.bars, signals)
            : strategy.createRunner(s.bars, config.params),
        sizing: sub.allocationPct
          ? { type: 'fixed_fraction', fraction: sub.allocationPct / 100 }
          : s.portfolio.execution.sizing,
        signalIds: new Map(signals.map((sig) => [sig.barTime.getTime(), sig.id])),
        start,
        pendingOrder: pending.find((o) => o.subscriptionId === sub.id) ?? null,
      });
    }
    return lanes;
  }

  private context(
    s: Session,
    sizing: PositionSizing,
    direction: TradeDirection = 'long',
  ): StepContext {
    const mark = (price: number) => (key: string) =>
      key === s.assetId
        ? price
        : (s.marks.get(key) ?? s.account.position(key)!.entryPrice.toNumber());
    const equity = (price: number) => s.account.equity(mark(price));
    const cash = (price: number) => s.account.freeCash(mark(price));
    return {
      execution: s.portfolio.execution,
      sizing,
      equity,
      cash,
      filter: s.filter,
      // Turning shorts off on the portfolio stops new short entries; held shorts still exit.
      direction: s.portfolio.riskRules.allowShort ? direction : 'long',
      approveEntry: (request) => {
        const verdict = checkRisk(
          s.portfolio.riskRules,
          {
            equity: request.equity,
            cash: cash(request.price.toNumber()),
            openPositions: s.account.positions.size,
            dayStartEquity: s.dayStartEquity,
          },
          { quantity: request.quantity, price: request.price, stopLoss: request.decision.stopLoss },
        );
        return verdict.action === 'reject'
          ? { reject: verdict.reason }
          : { quantity: verdict.quantity };
      },
    };
  }

  private async stepLane(s: Session, lane: Lane, t: number): Promise<void> {
    const events = stepBar(
      s.account,
      lane.slot,
      s.bars,
      t,
      lane.runner,
      this.context(s, lane.sizing, lane.sub.direction),
    );
    // stepBar always consumes the previous pending decision. Fill events come before a new decision.
    const before = lane.pendingOrder;
    for (const event of events) {
      if (event.type === 'order' && s.halted) {
        // Halted: the decision is dropped, the bar still counts as processed.
        lane.slot.pending = null;
        await this.dropStale(s, lane, before);
      } else if (event.type === 'order') {
        await this.dropStale(s, lane, before);
        lane.pendingOrder = await this.createSignalOrder(s, lane, event, t);
      } else {
        await this.applyFill(s, lane, event, t);
      }
    }
    await this.dropStale(s, lane, before);
  }

  /** A pending exit whose position was closed meanwhile is dropped by stepBar without an event. */
  private async dropStale(s: Session, lane: Lane, before: OrderEntity | null): Promise<void> {
    if (before && lane.pendingOrder === before) {
      await this.cancel(s, before, 'position_closed');
      lane.pendingOrder = null;
    }
  }

  private async createSignalOrder(
    s: Session,
    lane: Lane,
    event: Extract<StepEvent, { type: 'order' }>,
    t: number,
  ): Promise<OrderEntity> {
    const barTime = s.bars[t].openTime;
    const entry = event.order.kind === 'entry' ? event.order.decision : null;
    const position = s.account.position(s.assetId);
    // A short entry sells, covering a short buys.
    const side: OrderSide =
      event.order.kind === 'entry'
        ? event.order.side === 'short'
          ? 'SELL'
          : 'BUY'
        : closingSide(position!);
    return s.m.save(
      s.m.create(OrderEntity, {
        portfolioId: s.portfolio.id,
        assetId: s.assetId,
        side,
        type: 'market',
        quantity: entry ? null : position!.quantity.abs().toString(),
        stopLoss: entry?.stopLoss ?? null,
        takeProfit: entry?.takeProfit ?? null,
        status: 'pending',
        source: 'signal',
        barTime,
        signalId: lane.signalIds.get(barTime.getTime()) ?? null,
        subscriptionId: lane.sub.id,
        clientOrderId: `${lane.sub.id}:${ISO(barTime)}:${event.order.kind}`,
      }),
    );
  }

  private async applyFill(
    s: Session,
    lane: Lane,
    event: Exclude<StepEvent, { type: 'order' }>,
    t: number,
  ): Promise<void> {
    const bar = s.bars[t];
    if (event.type === 'entry_rejected') {
      if (lane.pendingOrder) await this.reject(s, lane.pendingOrder, event.reason);
      lane.pendingOrder = null;
      return;
    }
    if (event.type === 'entry') {
      const order =
        lane.pendingOrder ??
        (await this.recreateOrder(s, lane, event.order.side === 'short' ? 'SELL' : 'BUY', t));
      await this.fill(s, order, event.quantity, event.price, event.fee, bar.openTime);
      lane.pendingOrder = null;
      return;
    }
    // Exit: a signal exit fills its pending order, stops and take-profits get their own order.
    const exitSide: OrderSide = event.trade.side === 'short' ? 'BUY' : 'SELL';
    const order = event.order
      ? (lane.pendingOrder ?? (await this.recreateOrder(s, lane, exitSide, t)))
      : await this.levelOrder(s, lane.sub.id, event.reason, event.trade.quantity, bar, exitSide);
    if (event.order) lane.pendingOrder = null;
    await this.fill(s, order, event.trade.quantity, event.price, event.fee, bar.openTime);
    await this.recordTrade(s, event.trade, event.reason, event.barsHeld, lane.sub);
  }

  /** The pending order row is missing (deleted by hand); the fill still gets an order. */
  private recreateOrder(s: Session, lane: Lane, side: OrderSide, t: number): Promise<OrderEntity> {
    const barTime = s.bars[t - 1]?.openTime ?? s.bars[t].openTime;
    return s.m.save(
      s.m.create(OrderEntity, {
        portfolioId: s.portfolio.id,
        assetId: s.assetId,
        side,
        type: 'market',
        status: 'pending',
        source: 'signal',
        barTime,
        subscriptionId: lane.sub.id,
        clientOrderId: `${lane.sub.id}:${ISO(barTime)}:${randomUUID()}`,
      }),
    );
  }

  /** A filled SELL order for a stop-loss or take-profit exit. */
  private levelOrder(
    s: Session,
    subscriptionId: string | null,
    reason: ExitReason,
    quantity: Decimal,
    bar: Bar,
    side: OrderSide = 'SELL',
  ): Promise<OrderEntity> {
    const source = reason === 'take_profit' ? 'take_profit' : 'stop_loss';
    return s.m.save(
      s.m.create(OrderEntity, {
        portfolioId: s.portfolio.id,
        assetId: s.assetId,
        side,
        type: source === 'take_profit' ? 'limit' : 'market',
        quantity: quantity.toString(),
        status: 'pending',
        source,
        barTime: bar.openTime,
        subscriptionId,
        clientOrderId: `${subscriptionId ?? 'manual'}:${ISO(bar.openTime)}:${source}:${s.assetId}`,
      }),
    );
  }

  private async fill(
    s: Session,
    order: OrderEntity,
    quantity: Decimal,
    price: Decimal,
    fee: Decimal,
    at: Date,
  ): Promise<void> {
    order.status = transition(order.status, 'filled');
    order.quantity = quantity.toString();
    order.filledAt = at;
    await s.m.save(order);
    const note: FillNote = {
      side: order.side,
      quantity: quantity.toString(),
      price: price.toString(),
      source: order.source,
      at,
    };
    s.fills.push(note);
    this.logger.log({
      msg: fillLogText(s.portfolio.name, s.symbol, note),
      portfolioId: s.portfolio.id,
    });
    await s.m.save(
      s.m.create(FillEntity, {
        orderId: order.id,
        portfolioId: s.portfolio.id,
        assetId: s.assetId,
        side: order.side,
        quantity: quantity.toString(),
        price: price.toNumber(),
        fee: fee.toString(),
        executedAt: at,
      }),
    );
  }

  private async reject(s: Session, order: OrderEntity, reason: string): Promise<void> {
    order.status = transition(order.status, 'rejected');
    order.rejectReason = reason;
    await s.m.save(order);
    this.logger.warn({
      msg: `${s.portfolio.name}: ${order.source} ${order.side} ${s.symbol} rejected: ${reason}`,
      portfolioId: s.portfolio.id,
    });
  }

  private async cancel(s: Session, order: OrderEntity, reason: string): Promise<void> {
    order.status = transition(order.status, 'cancelled');
    order.rejectReason = reason;
    await s.m.save(order);
  }

  private recordTrade(
    s: Session,
    trade: ClosedTrade,
    reason: ExitReason,
    barsHeld: number | null,
    sub: PortfolioSubscriptionEntity | null,
  ): Promise<ClosedTradeEntity> {
    return s.m.save(
      s.m.create(ClosedTradeEntity, {
        portfolioId: s.portfolio.id,
        assetId: s.assetId,
        subscriptionId: sub?.id ?? null,
        strategyConfigId: sub?.strategyConfigId ?? null,
        side: trade.side,
        entryTime: trade.entryTime,
        entryPrice: trade.entryPrice.toNumber(),
        exitTime: trade.exitTime,
        exitPrice: trade.exitPrice.toNumber(),
        quantity: trade.quantity.toString(),
        fees: trade.fees.toString(),
        pnl: trade.pnl.toString(),
        returnPct: trade.returnPct.toDecimalPlaces(6).toNumber(),
        exitReason: reason,
        barsHeld,
      }),
    );
  }

  /** Manual limit orders fill on the first bar that trades through the limit. */
  private async fillManualLimit(
    s: Session,
    lanes: Lane[],
    order: OrderEntity,
    t: number,
  ): Promise<void> {
    const bar = s.bars[t];
    const raw = limitFillPrice(order.side, order.limitPrice!, bar);
    if (raw === null) return;
    const price = new Decimal(raw);
    const exec = s.portfolio.execution;

    if (order.side === 'SELL') {
      if (!s.account.position(s.assetId)) return this.reject(s, order, 'no_position');
      const owner = lanes.find((l) => holdsPosition(s.account, l.slot));
      const position = s.account.position(s.assetId)!;
      const quantity = position.quantity.abs();
      // SELL closes the position: a buy-to-cover for a short.
      order.side = closingSide(position);
      if (owner) {
        const event = closeSlot(
          s.account,
          owner.slot,
          s.bars,
          t,
          { rawPrice: raw, market: false, reason: 'manual' },
          exec,
        );
        if (event.type !== 'exit') return;
        await this.fill(s, order, quantity, event.price, event.fee, bar.openTime);
        await this.recordTrade(s, event.trade, 'manual', null, owner.sub);
      } else {
        const fee = exitFee(position, price, bar.openTime, exec);
        const trade = s.account.close(s.assetId, price, fee, bar.openTime);
        await this.fill(s, order, quantity, price, fee, bar.openTime);
        await this.recordTrade(s, trade, 'manual', null, null);
        s.manual = null;
      }
      return;
    }

    if (s.halted) return this.reject(s, order, 'halted');
    if (s.account.position(s.assetId)) return this.reject(s, order, 'position_exists');
    const result = this.sizeManualBuy(s, order, price);
    if ('reject' in result) return this.reject(s, order, result.reject);
    s.account.buy(s.assetId, result.quantity, price, result.fee, bar.openTime);
    await this.fill(s, order, result.quantity, price, result.fee, bar.openTime);
    // Levels are checked from the next bar on: the limit may have filled late in this bar.
    s.manual = { levels: levelsOf(order), lastBarTime: bar.openTime };
  }

  /** Stop-loss and take-profit of a position without a subscription. */
  private async checkManualLevels(s: Session, t: number): Promise<void> {
    const bar = s.bars[t];
    if (!s.manual || !s.account.position(s.assetId)) return;
    if (s.manual.lastBarTime && bar.openTime <= s.manual.lastBarTime) return;
    s.manual.lastBarTime = bar.openTime;
    // A short left behind by a removed subscription keeps its levels on the other side.
    const position = s.account.position(s.assetId)!;
    const hit = checkExitLevels(bar, s.manual.levels, position.quantity.lt(0) ? 'short' : 'long');
    if (!hit) return;

    const exec = s.portfolio.execution;
    const side = closingSide(position);
    const price = hit.market ? slippedPrice(hit.price, side, exec) : new Decimal(hit.price);
    const quantity = position.quantity.abs();
    const fee = exitFee(position, price, bar.openTime, exec);
    const trade = s.account.close(s.assetId, price, fee, bar.openTime);
    const order = await this.levelOrder(s, null, hit.reason, quantity, bar, side);
    await this.fill(s, order, quantity, price, fee, bar.openTime);
    await this.recordTrade(s, trade, hit.reason, null, null);
    s.manual = null;
  }

  /** Quantity and fee of a manual BUY after risk rules and cash, or the rejection reason. */
  private sizeManualBuy(
    s: Session,
    order: Pick<OrderEntity, 'quantity' | 'notional' | 'stopLoss'>,
    price: Decimal,
  ): { quantity: Decimal; fee: Decimal } | { reject: string } {
    const exec = s.portfolio.execution;
    const requested = order.quantity
      ? new Decimal(order.quantity)
      : new Decimal(order.notional!).div(price);
    const context = this.context(s, s.portfolio.execution.sizing);
    const cash = context.cash!(price.toNumber());
    const verdict = checkRisk(
      s.portfolio.riskRules,
      {
        equity: context.equity(price.toNumber()),
        cash,
        openPositions: s.account.positions.size,
        dayStartEquity: s.dayStartEquity,
      },
      { quantity: requested, price, stopLoss: order.stopLoss ?? undefined },
    );
    if (verdict.action === 'reject') return { reject: verdict.reason };
    const quantity = verdict.quantity;
    const fee = feeFor(quantity.mul(price), exec);
    if (quantity.mul(price).plus(fee).gt(cash)) return { reject: 'insufficient_cash' };
    return { quantity, fee };
  }

  private async saveSession(s: Session, lanes: Lane[]): Promise<void> {
    const { m, account, assetId, bars } = s;
    const open = account.position(assetId);
    const owner = lanes.find((l) => holdsPosition(account, l.slot));

    if (!open) {
      if (s.position) await m.delete(PositionEntity, { id: s.position.id });
    } else {
      const levels = owner ? owner.slot.levels : (s.manual?.levels ?? {});
      await m.save(
        Object.assign(
          s.position ?? m.create(PositionEntity, { portfolioId: s.portfolio.id, assetId }),
          {
            subscriptionId: owner?.sub.id ?? null,
            quantity: open.quantity.toString(),
            avgPrice: open.entryPrice.toString(),
            entryFee: open.entryFee.toString(),
            openedAt: open.entryTime,
            stopLoss: levels.stopLoss ?? null,
            takeProfit: levels.takeProfit ?? null,
            lastBarTime: owner ? null : (s.manual?.lastBarTime ?? bars.at(-1)!.openTime),
          },
        ),
      );
    }

    s.portfolio.cashBalance = account.cash.toString();
    await m.save(s.portfolio);

    for (const lane of lanes) {
      lane.sub.state = storeSlot(lane.slot, bars);
      lane.sub.lastBarTime = bars.at(-1)!.openTime;
      await m.save(lane.sub);
    }
  }

  // --- Manual orders --------------------------------------------------------------------------

  private async manualOrder(
    m: EntityManager,
    portfolioId: string,
    request: ManualOrderRequest,
  ): Promise<string> {
    const { assetId } = request;
    if (request.type === 'limit' && request.limitPrice === undefined) {
      throw new InvalidInputError('A limit order needs limitPrice');
    }
    if (request.side === 'BUY' && !request.quantity && !request.notional) {
      throw new InvalidInputError('A BUY order needs quantity or notional');
    }
    const latest = await this.marketData.latestBar(assetId, TIMEFRAME, { completeOnly: true });
    const s = await this.openSession(m, portfolioId, assetId, []);
    if (!s.portfolio.isActive) throw new ConflictError('Portfolio is not active');

    const order = await m.save(
      m.create(OrderEntity, {
        portfolioId,
        assetId,
        side: request.side,
        type: request.type,
        quantity: request.side === 'BUY' ? (request.quantity ?? null) : null,
        notional: request.side === 'BUY' ? (request.notional ?? null) : null,
        limitPrice: request.limitPrice ?? null,
        stopLoss: request.stopLoss ?? null,
        takeProfit: request.takeProfit ?? null,
        status: 'pending',
        source: 'manual',
        clientOrderId: `manual:${randomUUID()}`,
      }),
    );
    if (request.side === 'BUY' && s.halted) {
      await this.reject(s, order, 'halted');
      return order.id;
    }
    if (request.type === 'limit') {
      this.logger.log({
        msg: `${s.portfolio.name}: limit ${order.side} ${s.symbol} @ ${request.limitPrice} placed`,
        portfolioId,
      });
      return order.id;
    }

    const last = (await this.marketData.latestBar(assetId, '1h'))?.close;
    if (last === undefined) throw new InvalidInputError('No market data for this asset yet');
    const exec = s.portfolio.execution;
    const now = new Date();
    const position = s.account.position(assetId);

    if (request.side === 'SELL') {
      if (!position) {
        await this.reject(s, order, 'no_position');
        return order.id;
      }
      // SELL closes the position: a sale for a long, a buy-to-cover for a short.
      const side = closingSide(position);
      order.side = side;
      const price = slippedPrice(last, side, exec);
      const quantity = position.quantity.abs();
      const fee = exitFee(position, price, now, exec);
      const trade = s.account.close(assetId, price, fee, now);
      await this.fill(s, order, quantity, price, fee, now);
      const owner = s.position?.subscriptionId
        ? await m.findOneBy(PortfolioSubscriptionEntity, { id: s.position.subscriptionId })
        : null;
      await this.recordTrade(s, trade, 'manual', null, owner);
      if (owner) {
        // The strategy becomes flat and may enter again on its next entry decision.
        owner.state = { ...FLAT_SLOT };
        await m.save(owner);
        await m.update(
          OrderEntity,
          { subscriptionId: owner.id, status: 'pending' },
          { status: 'cancelled', rejectReason: 'position_closed' },
        );
      }
      await m.delete(PositionEntity, { id: s.position!.id });
    } else {
      if (s.halted || position) {
        await this.reject(s, order, s.halted ? 'halted' : 'position_exists');
        return order.id;
      }
      const price = slippedPrice(last, 'BUY', exec);
      const result = this.sizeManualBuy(s, order, price);
      if ('reject' in result) {
        await this.reject(s, order, result.reject);
        return order.id;
      }
      s.account.buy(assetId, result.quantity, price, result.fee, now);
      await this.fill(s, order, result.quantity, price, result.fee, now);
      await m.save(
        m.create(PositionEntity, {
          portfolioId,
          assetId,
          subscriptionId: null,
          quantity: result.quantity.toString(),
          avgPrice: price.toString(),
          entryFee: result.fee.toString(),
          openedAt: now,
          stopLoss: request.stopLoss ?? null,
          takeProfit: request.takeProfit ?? null,
          // Levels are checked on bars that open after the fill.
          lastBarTime: latest?.openTime ?? null,
        }),
      );
    }
    s.portfolio.cashBalance = s.account.cash.toString();
    await m.save(s.portfolio);
    return order.id;
  }
}

function toAccount(portfolio: PortfolioEntity, positions: PositionEntity[]): Account {
  return new Account(
    portfolio.cashBalance,
    positions.map((p) => [
      p.assetId,
      {
        quantity: new Decimal(p.quantity),
        entryPrice: new Decimal(p.avgPrice),
        entryFee: new Decimal(p.entryFee),
        entryTime: p.openedAt,
      },
    ]),
  );
}

function levelsOf(row: { stopLoss: number | null; takeProfit: number | null }): ExitLevels {
  const levels: ExitLevels = {};
  if (row.stopLoss !== null) levels.stopLoss = row.stopLoss;
  if (row.takeProfit !== null) levels.takeProfit = row.takeProfit;
  return levels;
}

/** Index of the first bar after `time`. */
function nextBar(bars: Bar[], time: Date): number {
  return indexAtOrBefore(bars, time) + 1;
}

/** Index of the first bar opening at or after `time`. */
function firstBarAtOrAfter(bars: Bar[], time: Date): number {
  const i = indexAtOrBefore(bars, time);
  return i >= 0 && bars[i].openTime.getTime() === time.getTime() ? i : i + 1;
}
