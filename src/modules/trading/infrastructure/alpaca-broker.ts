import { randomUUID } from 'node:crypto';
import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { InjectDataSource } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, In } from 'typeorm';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
  UpstreamError,
} from '../../../common/errors/domain.error';
import { alpacaConfig } from '../../../config';
import { NotificationService } from '../../notifications/application/notification.service';
import {
  ALPACA_CLIENT,
  AlpacaApiError,
  type AlpacaClient,
} from '../../../integrations/alpaca/alpaca-client.port';
import type {
  AlpacaAccount,
  AlpacaAsset,
  AlpacaOrder,
  AlpacaOrderRequest,
  TradeUpdate,
} from '../../../integrations/alpaca/alpaca.types';
import { AnalysisQueryService } from '../../analysis/application/analysis-query.service';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import { AssetsService } from '../../assets/application/assets.service';
import { SessionType } from '../../assets/domain/asset.types';
import { AuditService } from '../../audit/application/audit.service';
import type { AuditActor } from '../../audit/infrastructure/audit-event.entity';
import { EarningsService } from '../../market-data/application/earnings.service';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import type { Bar } from '../../market-data/domain/bar';
import { PortfolioValuationService } from '../application/portfolio-valuation.service';
import type { BrokerPort, ManualOrderRequest } from '../domain/broker.port';
import {
  automaticClientOrderId,
  brokerPrice,
  orderClass,
  reconcile,
  wholeShares,
  type ProtectiveLevels,
} from '../domain/demo-broker';
import {
  closingSide,
  decide,
  earningsFilter,
  positionSize,
  slippedPrice,
  type ExitReason,
  type PendingOrder,
  type PositionSizing,
  type TradeDirection,
} from '../domain/execution';
import { transition, type OrderSide, type OrderStatus } from '../domain/order';
import { checkRisk, earningsRuleOf } from '../domain/risk';
import { signalRunner } from '../domain/signal-runner';
import { FLAT_SLOT, indexAtOrBefore, loadSlot, storeSlot } from '../domain/slot-state';
import { fillLogText } from '../domain/trade-log';
import { BrokerAccountEntity } from './broker-account.entity';
import { ClosedTradeEntity } from './closed-trade.entity';
import { FillEntity } from './fill.entity';
import { OrderEntity } from './order.entity';
import { PortfolioSubscriptionEntity } from './portfolio-subscription.entity';
import { PortfolioEntity } from './portfolio.entity';
import { PositionEntity } from './position.entity';
import { ReconciliationRunEntity } from './reconciliation-run.entity';
import { SerialQueue } from './serial-queue';
import { TRADING_STATE_ID, TradingStateEntity } from './trading-state.entity';

const TIMEFRAME = '4h';
const MODE = 'alpaca_paper';
/** Order sync for updates missed while the stream was down. */
const ORDER_SYNC_MS = 60_000;
/** Closing right after cancelling bracket legs can fail until the broker releases the shares. */
const SELL_RETRIES = 5;
/**
 * A pending order without a broker id this old was never confirmed by the broker (the submit
 * timed out, or the process stopped before sending). Order sync then asks the broker by its
 * client order id. Longer than any submit with retries, so it never races a running submit.
 */
const UNCONFIRMED_AFTER_MS = 5 * 60_000;

const EXIT_REASONS: Record<string, ExitReason> = {
  signal: 'signal',
  manual: 'manual',
  stop_loss: 'stop_loss',
  take_profit: 'take_profit',
};

const TERMINAL: Record<string, OrderStatus> = {
  canceled: 'cancelled',
  expired: 'expired',
  rejected: 'rejected',
  done_for_day: 'expired',
};

export interface BrokerAccountView {
  enabled: boolean;
  environment: 'paper';
  account: { id: string; status: string; cash: string; equity: string; buyingPower: string } | null;
  error: string | null;
}

/**
 * `BrokerPort` for `alpaca_paper` portfolios: orders go to an Alpaca paper (demo) account and fills
 * come back over `trade_updates`. Strategy decisions use the same `decide()` as simulated paper
 * trading. Stop-loss and take-profit live at the broker as bracket / OTO legs.
 * Live trading is not possible: the configuration only accepts the paper endpoints.
 */
@Injectable()
export class AlpacaBroker implements BrokerPort, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(AlpacaBroker.name);
  private readonly queue = new SerialQueue();
  private readonly timers: NodeJS.Timeout[] = [];
  private unsubscribe?: () => void;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(ALPACA_CLIENT) private readonly client: AlpacaClient,
    @Inject(alpacaConfig.KEY) private readonly config: ConfigType<typeof alpacaConfig>,
    private readonly marketData: MarketDataQueryService,
    private readonly catalog: StrategyCatalogService,
    private readonly analysis: AnalysisQueryService,
    private readonly valuation: PortfolioValuationService,
    private readonly assets: AssetsService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationService,
    private readonly earnings: EarningsService,
  ) {}

  get enabled(): boolean {
    return this.client.enabled;
  }

  onApplicationBootstrap(): void {
    if (!this.client.enabled) {
      this.logger.log({
        msg: 'Alpaca demo broker off: ALPACA_KEY_ID / ALPACA_SECRET_KEY are empty',
      });
      return;
    }
    this.logger.log({
      msg: 'Alpaca demo broker on (paper account)',
      reconcileMinutes: this.config.reconcileMinutes,
    });
    this.unsubscribe = this.client.onTradeUpdate((u) =>
      this.background(`Trade update ${u.event} for ${u.order.client_order_id}`, () =>
        this.onTradeUpdate(u),
      ),
    );
    if (this.config.reconcileMinutes > 0) {
      this.timers.push(
        setInterval(() => this.background('Order sync', () => this.syncAll()), ORDER_SYNC_MS),
        setInterval(
          () => this.background('Reconciliation', () => this.reconcileAll()),
          this.config.reconcileMinutes * 60_000,
        ),
      );
      for (const t of this.timers) t.unref();
    }
  }

  async onApplicationShutdown(): Promise<void> {
    this.unsubscribe?.();
    for (const t of this.timers) clearInterval(t);
    await this.whenIdle();
  }

  whenIdle(): Promise<void> {
    return this.queue.idle();
  }

  /**
   * Runs work nobody awaits (stream callbacks, timers). Its errors are logged here; without this
   * they would be swallowed, since the queue only tracks the promise.
   */
  private background(label: string, work: () => Promise<void>): void {
    void this.queue.track(
      work().catch((error: unknown) => this.logger.error({ msg: `${label} failed`, err: error })),
    );
  }

  // --- Account ----------------------------------------------------------------------------------

  async status(): Promise<BrokerAccountView> {
    const base = { enabled: this.client.enabled, environment: 'paper' as const };
    if (!this.client.enabled)
      return { ...base, account: null, error: 'API keys are not configured' };
    try {
      const a = await this.client.getAccount();
      return { ...base, account: accountView(a), error: null };
    } catch (error) {
      return { ...base, account: null, error: errorText(error) };
    }
  }

  /**
   * Checks that the demo account can back a new portfolio: keys set, no open positions, not linked
   * yet. Returns the account and its cash, which becomes the portfolio's initial cash.
   */
  async prepareLink(): Promise<AlpacaAccount> {
    if (!this.client.enabled) {
      throw new InvalidInputError(
        'Alpaca API keys are not configured (ALPACA_KEY_ID / ALPACA_SECRET_KEY)',
      );
    }
    const account = await this.client.getAccount();
    const linked = await this.dataSource.manager.findOneBy(BrokerAccountEntity, {
      accountRef: account.id,
    });
    if (linked) throw new ConflictError('This Alpaca account already backs a portfolio');
    if ((await this.client.getPositions()).length > 0) {
      throw new InvalidInputError(
        'The Alpaca account has open positions; close them first so the portfolio starts in sync',
      );
    }
    return account;
  }

  async link(portfolioId: string, account: AlpacaAccount): Promise<void> {
    await this.dataSource.manager.save(
      this.dataSource.manager.create(BrokerAccountEntity, {
        portfolioId,
        broker: 'alpaca',
        environment: 'paper',
        accountRef: account.id,
      }),
    );
  }

  /** Only US equities and ETFs that Alpaca can trade. */
  async assertTradable(assetId: string, direction: TradeDirection = 'long'): Promise<void> {
    const asset = await this.assets.findById(assetId);
    if (asset.sessionType !== SessionType.UsEquity) {
      throw new InvalidInputError(
        `${asset.symbol} is not a US equity or ETF; Alpaca cannot trade it (use an ETF such as GLD)`,
      );
    }
    const remote = await this.client.getAsset(asset.symbol);
    if (!remote?.tradable) throw new InvalidInputError(`${asset.symbol} is not tradable on Alpaca`);
    if (direction !== 'long' && !isShortable(remote)) {
      throw new InvalidInputError(
        `${asset.symbol} cannot be sold short on Alpaca (not easy to borrow)`,
      );
    }
  }

  // --- Bar processing ---------------------------------------------------------------------------

  processAsset(assetId: string, portfolioId?: string): Promise<void> {
    return this.queue.track(this.processAssetNow(assetId, portfolioId));
  }

  private async processAssetNow(assetId: string, portfolioId?: string): Promise<void> {
    if (!this.client.enabled) return;
    const m = this.dataSource.manager;
    const subs = await m.findBy(PortfolioSubscriptionEntity, {
      assetId,
      isActive: true,
      ...(portfolioId ? { portfolioId } : {}),
    });
    if (subs.length === 0) return;
    const portfolios = await m.findBy(PortfolioEntity, {
      id: In([...new Set(subs.map((s) => s.portfolioId))]),
      isActive: true,
      mode: MODE,
    });
    if (portfolios.length === 0) return;
    const bars = await this.marketData.getHistory(assetId, TIMEFRAME, { completeOnly: true });
    if (bars.length === 0) return;

    for (const p of portfolios) {
      try {
        await this.queue.run(p.id, () => this.decideFor(p.id, assetId, bars));
      } catch (error) {
        this.logger.error({ msg: 'Demo-broker processing failed', portfolioId: p.id, err: error });
        if (portfolioId) throw error;
      }
    }
  }

  /** Asks each subscription's strategy about the new closed bars and sends the resulting orders. */
  private async decideFor(portfolioId: string, assetId: string, bars: Bar[]): Promise<void> {
    const m = this.dataSource.manager;
    const portfolio = await m.findOneByOrFail(PortfolioEntity, { id: portfolioId });
    const halted = await this.isHalted(m, portfolio);
    const asset = await this.assets.findById(assetId);
    const subs = await m.find(PortfolioSubscriptionEntity, {
      where: { portfolioId, assetId, isActive: true },
      order: { createdAt: 'ASC' },
    });
    const last = bars.length - 1;

    for (const sub of subs) {
      const start = sub.lastBarTime ? indexAtOrBefore(bars, sub.lastBarTime) + 1 : bars.length;
      sub.lastBarTime = bars[last].openTime;
      if (start > last) {
        await m.save(sub);
        continue;
      }
      const position = await m.findOneBy(PositionEntity, { portfolioId, assetId });
      const slot = loadSlot(assetId, sub.state, bars);
      if (slot.entrySignalIndex >= 0 && position?.subscriptionId !== sub.id) {
        Object.assign(slot, { entrySignalIndex: -1, entryBarIndex: -1, levels: {} });
      }
      const pending = await m.findOneBy(OrderEntity, {
        subscriptionId: sub.id,
        status: 'pending',
        source: 'signal',
      });

      const { config, strategy } = await this.catalog.configById(sub.strategyConfigId);
      const runner =
        sub.source === 'signals'
          ? signalRunner(bars, await this.analysis.storedSignals(assetId, sub.strategyConfigId))
          : strategy.createRunner(bars, config.params);

      // An exit on any unprocessed bar still applies; an entry only on the latest bar, so a late
      // sync (app was down) does not chase old signals.
      const rule = earningsRuleOf(portfolio.riskRules);
      const filter = rule
        ? earningsFilter(
            bars,
            await this.earnings.reports(assetId),
            rule,
            (await this.assets.findById(assetId)).sessionType,
          )
        : undefined;
      let decision: PendingOrder | null = null;
      for (let t = start; t <= last && !decision; t++) {
        const d = decide(
          slot,
          runner,
          t,
          filter,
          portfolio.riskRules.allowShort ? sub.direction : 'long',
        );
        if (d && (d.kind === 'exit' || t === last)) decision = d;
      }

      if (decision && !pending && !halted) {
        const signals = await this.analysis.storedSignals(assetId, sub.strategyConfigId);
        const signalTime = bars[decision.signalIndex].openTime.getTime();
        const signalId = signals.find((s) => s.barTime.getTime() === signalTime)?.id ?? null;
        if (decision.kind === 'entry') {
          if (position) {
            await this.recordRejected(
              m,
              portfolio,
              sub,
              decision,
              bars,
              'position_exists',
              signalId,
            );
          } else if (
            await this.submitEntry(portfolio, sub, decision, bars, asset.symbol, signalId)
          ) {
            slot.pending = decision;
          }
        } else if (
          position &&
          (await this.submitExit(portfolio, sub, decision, bars, asset.symbol, position, signalId))
        ) {
          slot.pending = decision;
        }
      }
      sub.state = storeSlot(slot, bars);
      await m.save(sub);
    }
  }

  private async submitEntry(
    portfolio: PortfolioEntity,
    sub: PortfolioSubscriptionEntity,
    decision: PendingOrder & { kind: 'entry' },
    bars: Bar[],
    symbol: string,
    signalId: string | null,
  ): Promise<boolean> {
    const m = this.dataSource.manager;
    const barTime = bars[decision.signalIndex].openTime;
    const clientOrderId = automaticClientOrderId(sub.id, barTime, 'entry');
    if (await m.existsBy(OrderEntity, { clientOrderId })) return false;

    const short = decision.side === 'short';
    const account = await this.client.getAccount();
    const equity = new Decimal(account.equity);
    // Short proceeds sit in the broker's cash; they never back another position.
    const cash = new Decimal(account.cash).minus(await this.shortLiability(portfolio.id));
    const exec = portfolio.execution;
    const price = slippedPrice(bars.at(-1)!.close, short ? 'SELL' : 'BUY', exec);
    const sizing: PositionSizing = sub.allocationPct
      ? { type: 'fixed_fraction', fraction: sub.allocationPct / 100 }
      : exec.sizing;
    const levels = {
      stopLoss: decision.decision.stopLoss,
      takeProfit: decision.decision.takeProfit,
    };
    const sized = positionSize({
      sizing,
      equity,
      cash,
      price,
      stopLoss: levels.stopLoss,
      model: exec,
      side: decision.side,
    });
    const verdict = checkRisk(
      portfolio.riskRules,
      {
        equity,
        cash,
        openPositions: await m.countBy(PositionEntity, { portfolioId: portfolio.id }),
        dayStartEquity: await this.valuation.dayStartEquity(portfolio.id),
      },
      { quantity: sized, price, stopLoss: levels.stopLoss },
    );
    const quantity = verdict.action === 'reject' ? new Decimal(0) : wholeShares(verdict.quantity);
    // Borrow availability changes; it is checked again before each short entry.
    const borrowable = !short || isShortable(await this.client.getAsset(symbol));

    const order = m.create(OrderEntity, {
      portfolioId: portfolio.id,
      assetId: sub.assetId,
      side: short ? 'SELL' : 'BUY',
      type: 'market',
      quantity: quantity.toString(),
      stopLoss: levels.stopLoss ?? null,
      takeProfit: levels.takeProfit ?? null,
      status: 'pending',
      source: 'signal',
      barTime,
      signalId,
      subscriptionId: sub.id,
      clientOrderId,
    });
    if (verdict.action === 'reject' || quantity.lte(0) || !borrowable) {
      order.status = 'rejected';
      order.rejectReason =
        verdict.action === 'reject'
          ? verdict.reason
          : !borrowable
            ? 'not_shortable'
            : 'less_than_one_share';
      await m.save(order);
      this.logger.warn({
        msg: `${portfolio.name}: signal ${order.side} ${symbol} rejected: ${order.rejectReason}`,
        portfolioId: portfolio.id,
      });
      return false;
    }
    await m.save(order);
    return this.send(
      order,
      entryRequest(symbol, short ? 'sell' : 'buy', quantity, levels, clientOrderId),
    );
  }

  /** What buying back the portfolio's shorts would cost at the latest closes (0 without shorts). */
  private async shortLiability(portfolioId: string): Promise<Decimal> {
    const shorts = (await this.dataSource.manager.findBy(PositionEntity, { portfolioId })).filter(
      (p) => new Decimal(p.quantity).isNeg(),
    );
    if (shorts.length === 0) return new Decimal(0);
    const marks = await this.valuation.latestCloses(
      shorts.map((p) => p.assetId),
      TIMEFRAME,
    );
    return shorts.reduce(
      (sum, p) => sum.plus(new Decimal(p.quantity).abs().mul(marks.get(p.assetId) ?? p.avgPrice)),
      new Decimal(0),
    );
  }

  private async submitExit(
    portfolio: PortfolioEntity,
    sub: PortfolioSubscriptionEntity,
    decision: PendingOrder,
    bars: Bar[],
    symbol: string,
    position: PositionEntity,
    signalId: string | null,
  ): Promise<boolean> {
    const m = this.dataSource.manager;
    const barTime = bars[decision.signalIndex].openTime;
    const clientOrderId = automaticClientOrderId(sub.id, barTime, 'exit');
    if (await m.existsBy(OrderEntity, { clientOrderId })) return false;
    await this.cancelLegs(portfolio.id, sub.assetId, 'strategy_exit');
    const side = closingSide({ quantity: new Decimal(position.quantity) });
    const quantity = new Decimal(position.quantity).abs().toString();
    const order = await m.save(
      m.create(OrderEntity, {
        portfolioId: portfolio.id,
        assetId: sub.assetId,
        side,
        type: 'market',
        quantity,
        status: 'pending',
        source: 'signal',
        barTime,
        signalId,
        subscriptionId: sub.id,
        clientOrderId,
      }),
    );
    return this.send(order, closeRequest(symbol, side, quantity, clientOrderId), true);
  }

  private async recordRejected(
    m: EntityManager,
    portfolio: PortfolioEntity,
    sub: PortfolioSubscriptionEntity,
    decision: PendingOrder,
    bars: Bar[],
    reason: string,
    signalId: string | null,
  ): Promise<void> {
    const barTime = bars[decision.signalIndex].openTime;
    const clientOrderId = automaticClientOrderId(sub.id, barTime, decision.kind);
    if (await m.existsBy(OrderEntity, { clientOrderId })) return;
    await m.save(
      m.create(OrderEntity, {
        portfolioId: portfolio.id,
        assetId: sub.assetId,
        side: orderSideOf(decision),
        type: 'market',
        status: 'rejected',
        rejectReason: reason,
        source: 'signal',
        barTime,
        signalId,
        subscriptionId: sub.id,
        clientOrderId,
      }),
    );
    this.logger.warn({
      msg: `${portfolio.name}: signal ${orderSideOf(decision)} rejected: ${reason}`,
      portfolioId: portfolio.id,
      assetId: sub.assetId,
    });
  }

  /**
   * Submits the order and stores the broker ids, including bracket / OTO legs as their own pending
   * orders. A resubmission with a known client order id adopts the existing broker order.
   */
  private async send(
    order: OrderEntity,
    request: AlpacaOrderRequest,
    closing = request.side === 'sell',
  ): Promise<boolean> {
    const m = this.dataSource.manager;
    let remote: AlpacaOrder | null = null;
    // A closing order can fail until the broker releases the shares of cancelled legs.
    const retries = closing ? SELL_RETRIES : 1;
    for (let attempt = 1; attempt <= retries; attempt++) {
      try {
        remote = await this.client.submitOrder(request);
        break;
      } catch (error) {
        const duplicate = error instanceof AlpacaApiError && /client_order_id/i.test(error.message);
        const uncertain = error instanceof AlpacaApiError && error.uncertain;
        if (duplicate || uncertain) {
          // The broker may have the order although the submit failed: look it up by its id.
          let existing: AlpacaOrder | null;
          try {
            existing = await this.client.getOrderByClientId(request.client_order_id);
          } catch (lookupError) {
            // Still unknown. Keep it pending; order sync resolves it later.
            this.logger.warn({
              msg: 'Order outcome unknown, order sync will resolve it',
              clientOrderId: order.clientOrderId,
              err: error,
              lookupError: errorText(lookupError),
            });
            return true;
          }
          if (existing) {
            remote = existing;
            break;
          }
        }
        const retry =
          attempt < retries &&
          error instanceof AlpacaApiError &&
          /insufficient|held/i.test(error.message);
        if (retry) {
          await new Promise((resolve) => setTimeout(resolve, 1_000));
          continue;
        }
        order.status = transition(order.status, 'rejected');
        order.rejectReason = `broker: ${errorText(error)}`.slice(0, 500);
        await m.save(order);
        this.logger.warn({
          msg: 'Alpaca rejected an order',
          clientOrderId: order.clientOrderId,
          err: error,
        });
        return false;
      }
    }
    await this.adopt(order, remote!);
    const amount = request.qty ?? `$${request.notional}`;
    const limit = request.limit_price ? ` @ ${request.limit_price}` : '';
    const levels = [
      request.stop_loss && `SL ${request.stop_loss.stop_price}`,
      request.take_profit && `TP ${request.take_profit.limit_price}`,
    ].filter(Boolean);
    this.logger.log({
      msg: `Alpaca order sent: ${order.source} ${request.side} ${amount} ${request.symbol} ${request.type}${limit}${levels.length ? ` (${levels.join(', ')})` : ''}`,
      portfolioId: order.portfolioId,
      clientOrderId: order.clientOrderId,
    });
    return true;
  }

  /** Stores the broker's ids for an order, with its bracket / OTO legs as their own orders. */
  private async adopt(order: OrderEntity, remote: AlpacaOrder): Promise<void> {
    const m = this.dataSource.manager;
    order.brokerOrderId = remote.id;
    await m.save(order);
    for (const leg of remote.legs ?? []) {
      const takeProfit = leg.type === 'limit';
      await m.save(
        m.create(OrderEntity, {
          portfolioId: order.portfolioId,
          assetId: order.assetId,
          // Legs close the entry: sells for a long, buys for a short.
          side: order.side === 'BUY' ? 'SELL' : 'BUY',
          type: takeProfit ? 'limit' : 'market',
          quantity: order.quantity,
          limitPrice: takeProfit ? Number(leg.limit_price) : null,
          stopLoss: takeProfit ? null : Number(leg.stop_price),
          status: 'pending',
          source: takeProfit ? 'take_profit' : 'stop_loss',
          barTime: order.barTime,
          subscriptionId: order.subscriptionId,
          brokerOrderId: leg.id,
          clientOrderId:
            leg.client_order_id || `${order.clientOrderId}:${takeProfit ? 'tp' : 'sl'}`,
        }),
      );
    }
  }

  /** Cancels the open stop-loss / take-profit legs of a position (before selling it). */
  private async cancelLegs(portfolioId: string, assetId: string, reason: string): Promise<void> {
    const m = this.dataSource.manager;
    const legs = await m.findBy(OrderEntity, {
      portfolioId,
      assetId,
      status: 'pending',
      source: In(['stop_loss', 'take_profit']),
    });
    for (const leg of legs) {
      if (leg.brokerOrderId) await this.cancelRemote(leg.brokerOrderId);
      leg.status = 'cancelled';
      leg.rejectReason = reason;
      await m.save(leg);
    }
  }

  private async cancelRemote(brokerOrderId: string): Promise<void> {
    try {
      await this.client.cancelOrder(brokerOrderId);
    } catch (error) {
      // Already filled or cancelled at the broker: its trade update settles the order.
      if (!(error instanceof AlpacaApiError && [404, 422].includes(error.status))) throw error;
    }
  }

  // --- Trade updates ----------------------------------------------------------------------------

  private async onTradeUpdate(update: TradeUpdate): Promise<void> {
    const m = this.dataSource.manager;
    const order =
      (await m.findOneBy(OrderEntity, { brokerOrderId: update.order.id })) ??
      (await m.findOneBy(OrderEntity, { clientOrderId: update.order.client_order_id }));
    if (!order) {
      // Not placed by this app; reconciliation reports the effect on positions and cash.
      this.logger.warn({
        msg: 'Trade update for an unknown order',
        brokerOrderId: update.order.id,
      });
      return;
    }
    await this.queue.run(order.portfolioId, async () => {
      const applied = await this.dataSource.transaction((tx) => this.apply(tx, order.id, update));
      if (applied) {
        await this.notifyFill(order, update);
        await this.valuation.trySnapshot(order.portfolioId);
        await this.reconcile(order.portfolioId);
      }
    });
  }

  private async notifyFill(order: OrderEntity, update: TradeUpdate): Promise<void> {
    if (!this.notifications.enabled) return;
    try {
      const portfolio = await this.dataSource.manager.findOneByOrFail(PortfolioEntity, {
        id: order.portfolioId,
      });
      const { symbol } = await this.assets.findById(order.assetId);
      this.notifications.notify(
        this.notifications.texts.fillsMessage(portfolio.name, symbol, [
          {
            side: order.side,
            quantity: update.order.filled_qty,
            price: update.order.filled_avg_price ?? 0,
            source: order.source,
            at: new Date(update.order.filled_at ?? update.timestamp ?? Date.now()),
          },
        ]),
      );
    } catch (error) {
      this.logger.warn({ msg: 'Fill notification failed', orderId: order.id, err: error });
    }
  }

  /** Applies one order update; returns true when it changed positions or cash. */
  private async apply(m: EntityManager, orderId: string, update: TradeUpdate): Promise<boolean> {
    const order = await m.findOne(OrderEntity, {
      where: { id: orderId },
      lock: { mode: 'pessimistic_write' },
    });
    // Updates are idempotent: a settled order is not changed again.
    if (!order || order.status !== 'pending') return false;
    order.brokerOrderId ??= update.order.id;
    const filled = new Decimal(update.order.filled_qty || 0);
    const price = update.order.filled_avg_price;
    const at = new Date(update.order.filled_at ?? update.timestamp ?? Date.now());

    if (update.event === 'fill' || (TERMINAL[update.event] && filled.gt(0))) {
      await this.applyFill(m, order, filled, new Decimal(price!), at);
      return true;
    }
    const status = TERMINAL[update.event];
    if (!status) return false;
    order.status = transition(order.status, status);
    order.rejectReason = order.rejectReason ?? `broker: ${update.event}`;
    await m.save(order);
    const level = status === 'rejected' ? 'warn' : 'log';
    this.logger[level]({
      msg: `Alpaca order ${status}: ${order.source} ${order.side} (${update.event})`,
      portfolioId: order.portfolioId,
      clientOrderId: order.clientOrderId,
    });
    if (order.subscriptionId && order.source === 'signal') {
      await this.clearPending(m, order.subscriptionId);
    }
    return false;
  }

  private async applyFill(
    m: EntityManager,
    order: OrderEntity,
    quantity: Decimal,
    price: Decimal,
    at: Date,
  ): Promise<void> {
    const portfolio = await m.findOne(PortfolioEntity, {
      where: { id: order.portfolioId },
      lock: { mode: 'pessimistic_write' },
    });
    const position = await m.findOneBy(PositionEntity, {
      portfolioId: order.portfolioId,
      assetId: order.assetId,
    });
    // Alpaca charges no commission; regulatory fees are left to reconciliation's cash tolerance.
    const fee = new Decimal(0);
    // Signed: a buy adds shares (covers a short), a sell removes them (opens a short).
    const delta = order.side === 'BUY' ? quantity : quantity.neg();
    const cash = new Decimal(portfolio!.cashBalance).minus(delta.mul(price));
    const held = position ? new Decimal(position.quantity) : new Decimal(0);

    if (held.isZero() || held.isNeg() === delta.isNeg()) {
      // Opens or adds to a position (long on a buy, short on a sell).
      const total = held.plus(delta);
      const merged = position
        ? Object.assign(position, {
            avgPrice: held.mul(position.avgPrice).plus(delta.mul(price)).div(total).toString(),
            quantity: total.toString(),
          })
        : m.create(PositionEntity, {
            portfolioId: order.portfolioId,
            assetId: order.assetId,
            subscriptionId: order.source === 'signal' ? order.subscriptionId : null,
            quantity: delta.toString(),
            avgPrice: price.toString(),
            entryFee: fee.toString(),
            stopLoss: order.stopLoss,
            takeProfit: order.takeProfit,
            openedAt: at,
            lastBarTime: null,
          });
      await m.save(merged);
      if (order.subscriptionId && order.source === 'signal') {
        const sub = await m.findOneByOrFail(PortfolioSubscriptionEntity, {
          id: order.subscriptionId,
        });
        sub.state = {
          pending: null,
          entrySignalTime: order.barTime?.toISOString() ?? at.toISOString(),
          entryBarTime: at.toISOString(),
          levels: {
            ...(order.stopLoss !== null ? { stopLoss: order.stopLoss } : {}),
            ...(order.takeProfit !== null ? { takeProfit: order.takeProfit } : {}),
          },
          ...(delta.isNeg() ? { side: 'short' as const } : {}),
        };
        await m.save(sub);
      }
    } else {
      // Reduces or closes the position: a sell of a long, a buy-to-cover of a short.
      const size = held.abs();
      const closed = Decimal.min(quantity, size);
      const signed = held.isNeg() ? closed.neg() : closed;
      const entryFee = new Decimal(position!.entryFee).mul(closed).div(size);
      const pnl = signed.mul(price.minus(position!.avgPrice)).minus(entryFee).minus(fee);
      const cost = closed.mul(position!.avgPrice).plus(entryFee);
      const owner = position!.subscriptionId
        ? await m.findOneBy(PortfolioSubscriptionEntity, { id: position!.subscriptionId })
        : null;
      await m.save(
        m.create(ClosedTradeEntity, {
          portfolioId: order.portfolioId,
          assetId: order.assetId,
          subscriptionId: owner?.id ?? null,
          strategyConfigId: owner?.strategyConfigId ?? null,
          side: held.isNeg() ? 'short' : 'long',
          entryTime: position!.openedAt,
          entryPrice: Number(position!.avgPrice),
          exitTime: at,
          exitPrice: price.toNumber(),
          quantity: closed.toString(),
          fees: entryFee.plus(fee).toString(),
          pnl: pnl.toString(),
          returnPct: cost.gt(0) ? pnl.div(cost).toDecimalPlaces(6).toNumber() : 0,
          exitReason: EXIT_REASONS[order.source] ?? 'manual',
          barsHeld: null,
        }),
      );
      if (closed.eq(size)) {
        await m.delete(PositionEntity, { id: position!.id });
        if (owner) {
          owner.state = { ...FLAT_SLOT };
          await m.save(owner);
        }
      } else {
        position!.quantity = held.minus(signed).toString();
        position!.entryFee = new Decimal(position!.entryFee).minus(entryFee).toString();
        await m.save(position!);
      }
    }

    portfolio!.cashBalance = cash.toString();
    await m.save(portfolio!);
    order.status = transition(order.status, 'filled');
    order.quantity = quantity.toString();
    order.filledAt = at;
    await m.save(order);
    await m.save(
      m.create(FillEntity, {
        orderId: order.id,
        portfolioId: order.portfolioId,
        assetId: order.assetId,
        side: order.side,
        quantity: quantity.toString(),
        price: price.toNumber(),
        fee: fee.toString(),
        executedAt: at,
      }),
    );
    const symbol = await this.assets.findById(order.assetId).then(
      (a) => a.symbol,
      () => order.assetId,
    );
    this.logger.log({
      msg: fillLogText(portfolio!.name, symbol, {
        side: order.side,
        quantity: quantity.toString(),
        price: price.toString(),
        source: order.source,
      }),
      portfolioId: order.portfolioId,
      clientOrderId: order.clientOrderId,
    });
  }

  private async clearPending(m: EntityManager, subscriptionId: string): Promise<void> {
    const sub = await m.findOneBy(PortfolioSubscriptionEntity, { id: subscriptionId });
    if (sub?.state.pending) {
      sub.state = { ...sub.state, pending: null };
      await m.save(sub);
    }
  }

  /** Polls pending orders, for updates missed while the stream was down. */
  async syncOrders(portfolioId: string): Promise<void> {
    const pending = await this.dataSource.manager.findBy(OrderEntity, {
      portfolioId,
      status: 'pending',
    });
    const cutoff = Date.now() - UNCONFIRMED_AFTER_MS;
    for (const order of pending) {
      if (!order.brokerOrderId && order.createdAt.getTime() > cutoff) continue;
      const remote = await this.client.getOrderByClientId(order.clientOrderId);
      if (!order.brokerOrderId) {
        await this.queue.run(portfolioId, () => this.resolveUnconfirmed(order.id, remote));
        if (!remote) continue;
      }
      if (!remote) continue;
      const event =
        remote.status === 'filled'
          ? 'fill'
          : remote.status === 'canceled'
            ? 'canceled'
            : remote.status;
      if (event === 'fill' || TERMINAL[event]) await this.onTradeUpdate({ event, order: remote });
    }
  }

  /** An order the broker never confirmed: adopt it if the broker has it, otherwise reject it. */
  private async resolveUnconfirmed(orderId: string, remote: AlpacaOrder | null): Promise<void> {
    const m = this.dataSource.manager;
    const order = await m.findOneBy(OrderEntity, { id: orderId });
    if (!order || order.status !== 'pending' || order.brokerOrderId) return;
    if (remote) {
      await this.adopt(order, remote);
      this.logger.warn({
        msg: 'Adopted an order confirmed late by the broker',
        clientOrderId: order.clientOrderId,
      });
      return;
    }
    order.status = transition(order.status, 'rejected');
    order.rejectReason = 'broker: order never reached the broker';
    await m.save(order);
    if (order.subscriptionId) await this.clearPending(m, order.subscriptionId);
    this.logger.warn({ msg: 'Unconfirmed order rejected', clientOrderId: order.clientOrderId });
  }

  private async syncAll(): Promise<void> {
    for (const p of await this.dataSource.manager.findBy(PortfolioEntity, { mode: MODE })) {
      await this.syncOrders(p.id).catch((error: unknown) =>
        this.logger.error({ msg: 'Order sync failed', portfolioId: p.id, err: error }),
      );
    }
  }

  // --- Reconciliation ---------------------------------------------------------------------------

  /**
   * Compares broker positions and cash with the database. A difference halts the portfolio; the
   * database is never corrected automatically.
   */
  async reconcile(portfolioId: string): Promise<ReconciliationRunEntity> {
    const m = this.dataSource.manager;
    const portfolio = await m.findOneBy(PortfolioEntity, { id: portfolioId });
    if (!portfolio) throw new NotFoundError(`Portfolio ${portfolioId} not found`);
    if (portfolio.mode !== MODE)
      throw new InvalidInputError('Only demo-broker portfolios reconcile');

    try {
      const [account, remote, rows] = await Promise.all([
        this.client.getAccount(),
        this.client.getPositions(),
        m.findBy(PositionEntity, { portfolioId }),
      ]);
      const holdings = await Promise.all(
        rows.map(async (p) => ({
          symbol: (await this.assets.findById(p.assetId)).symbol,
          quantity: p.quantity,
        })),
      );
      const diffs = reconcile(
        {
          holdings: remote.map((p) => ({ symbol: p.symbol, quantity: p.qty })),
          cash: account.cash,
        },
        { holdings, cash: portfolio.cashBalance },
      );
      const run = await m.save(
        m.create(ReconciliationRunEntity, {
          portfolioId,
          status: diffs.length ? 'diff' : 'ok',
          diffs,
          brokerCash: account.cash,
          brokerEquity: account.equity,
          error: null,
        }),
      );
      if (diffs.length && !portfolio.haltedAt) {
        // The halt is the system's decision, whoever started the reconciliation.
        await this.haltPortfolio(portfolio, 'reconciliation difference', 'system', { diffs });
      }
      return run;
    } catch (error) {
      return m.save(
        m.create(ReconciliationRunEntity, {
          portfolioId,
          status: 'error',
          diffs: [],
          brokerCash: null,
          brokerEquity: null,
          error: errorText(error),
        }),
      );
    }
  }

  /** Manual reconciliation, in the portfolio's queue. */
  reconcileNow(portfolioId: string): Promise<ReconciliationRunEntity> {
    return this.queue.track(this.queue.run(portfolioId, () => this.reconcile(portfolioId)));
  }

  private async reconcileAll(): Promise<void> {
    for (const p of await this.dataSource.manager.findBy(PortfolioEntity, {
      mode: MODE,
      isActive: true,
    })) {
      try {
        await this.queue.run(p.id, () => this.reconcile(p.id));
      } catch (error) {
        this.logger.error({ msg: 'Reconciliation failed', portfolioId: p.id, err: error });
      }
    }
  }

  private async haltPortfolio(
    portfolio: PortfolioEntity,
    reason: string,
    actor: AuditActor,
    details: object,
  ): Promise<void> {
    portfolio.haltedAt = new Date();
    portfolio.haltReason = reason;
    await this.dataSource.manager.save(portfolio);
    let cancelError: string | undefined;
    try {
      await this.cancelAutomaticNow(portfolio.id);
    } catch (error) {
      cancelError = errorText(error);
    }
    await this.audit.record({
      actor,
      action: 'portfolio.halt',
      entityType: 'portfolio',
      entityId: portfolio.id,
      before: { haltedAt: null },
      after: {
        haltedAt: portfolio.haltedAt,
        haltReason: reason,
        ...details,
        ...(cancelError ? { cancelError } : {}),
      },
    });
    this.notifications.notify(
      this.notifications.texts.haltMessage({ portfolio: portfolio.name, reason, actor }),
    );
    this.logger.warn({
      msg: `Portfolio ${portfolio.name} halted`,
      reason,
      ...details,
      cancelError,
    });
  }

  // --- Manual orders and control ----------------------------------------------------------------

  placeOrder(portfolioId: string, request: ManualOrderRequest): Promise<string> {
    return this.queue.track(
      this.queue.run(portfolioId, () => this.manualOrder(portfolioId, request)),
    );
  }

  private async manualOrder(portfolioId: string, request: ManualOrderRequest): Promise<string> {
    const m = this.dataSource.manager;
    const portfolio = await m.findOneBy(PortfolioEntity, { id: portfolioId });
    if (!portfolio) throw new NotFoundError(`Portfolio ${portfolioId} not found`);
    if (request.type === 'limit' && request.limitPrice === undefined) {
      throw new InvalidInputError('A limit order needs limitPrice');
    }
    const asset = await this.assets.findById(request.assetId);
    const position = await m.findOneBy(PositionEntity, { portfolioId, assetId: asset.id });
    const order = m.create(OrderEntity, {
      portfolioId,
      assetId: asset.id,
      side: request.side,
      type: request.type,
      quantity:
        request.side === 'BUY'
          ? (request.quantity ?? null)
          : position
            ? new Decimal(position.quantity).abs().toString()
            : null,
      notional: request.side === 'BUY' ? (request.notional ?? null) : null,
      limitPrice: request.limitPrice ?? null,
      stopLoss: request.stopLoss ?? null,
      takeProfit: request.takeProfit ?? null,
      status: 'pending',
      source: 'manual',
      clientOrderId: `manual:${randomUUID()}`,
    });
    const reject = async (reason: string) => {
      order.status = 'rejected';
      order.rejectReason = reason;
      this.logger.warn({
        msg: `${portfolio.name}: manual ${order.side} ${asset.symbol} rejected: ${reason}`,
        portfolioId,
      });
      return (await m.save(order)).id;
    };

    if (request.side === 'SELL') {
      if (!position) return reject('no_position');
      await this.cancelLegs(portfolioId, asset.id, 'manual_close');
      // SELL closes the position: a buy-to-cover for a short.
      order.side = closingSide({ quantity: new Decimal(position.quantity) });
      await m.save(order);
      const close: AlpacaOrderRequest = {
        ...closeRequest(asset.symbol, order.side, order.quantity!, order.clientOrderId),
        ...(request.type === 'limit'
          ? { type: 'limit', limit_price: brokerPrice(request.limitPrice!) }
          : {}),
      };
      await this.send(order, close, true);
      return order.id;
    }

    if (await this.isHalted(m, portfolio)) return reject('halted');
    if (position) return reject('position_exists');
    if (!request.quantity && !request.notional) {
      throw new InvalidInputError('A BUY order needs quantity or notional');
    }
    const levels = { stopLoss: request.stopLoss, takeProfit: request.takeProfit };
    const withLevels = orderClass(levels) !== 'simple';
    if (withLevels && (!request.quantity || !new Decimal(request.quantity).isInteger())) {
      throw new InvalidInputError(
        'Stop-loss / take-profit at the broker need a whole-share quantity',
      );
    }
    if (request.type === 'limit' && request.notional) {
      throw new InvalidInputError(
        'Alpaca accepts notional only for market orders; give a quantity',
      );
    }

    const last = (await this.marketData.latestBar(asset.id, '1h'))?.close;
    const account = await this.client.getAccount();
    const equity = new Decimal(account.equity);
    const price = new Decimal(request.limitPrice ?? last ?? 0);
    if (price.lte(0)) throw new InvalidInputError('No market data for this asset yet');
    const requested = request.quantity
      ? new Decimal(request.quantity)
      : new Decimal(request.notional!).div(price);
    const verdict = checkRisk(
      portfolio.riskRules,
      {
        equity,
        cash: new Decimal(account.cash),
        openPositions: await m.countBy(PositionEntity, { portfolioId }),
        dayStartEquity: await this.valuation.dayStartEquity(portfolioId),
      },
      { quantity: requested, price, stopLoss: request.stopLoss },
    );
    if (verdict.action === 'reject') return reject(verdict.reason);
    if (verdict.action === 'resize')
      return reject(`exceeds risk limits (max ${verdict.quantity.toFixed(4)})`);

    await m.save(order);
    const buy: AlpacaOrderRequest = {
      symbol: asset.symbol,
      side: 'buy',
      type: request.type,
      time_in_force: 'day',
      client_order_id: order.clientOrderId,
      ...(request.quantity ? { qty: request.quantity } : { notional: request.notional }),
      ...(request.type === 'limit' ? { limit_price: brokerPrice(request.limitPrice!) } : {}),
      ...(withLevels ? protectiveLegs(levels) : {}),
    };
    await this.send(order, buy);
    return order.id;
  }

  cancelOrder(portfolioId: string, orderId: string): Promise<void> {
    return this.queue.run(portfolioId, async () => {
      const m = this.dataSource.manager;
      const order = await m.findOneBy(OrderEntity, { id: orderId, portfolioId });
      if (!order) throw new NotFoundError(`Order ${orderId} not found`);
      if (order.status !== 'pending') {
        throw new ConflictError(`Order ${orderId} is ${order.status}, not pending`);
      }
      if (order.brokerOrderId) await this.cancelRemote(order.brokerOrderId);
      order.status = transition(order.status, 'cancelled');
      await m.save(order);
      this.logger.log({ msg: 'Order cancelled', portfolioId, orderId });
      if (order.subscriptionId && order.source === 'signal') {
        await this.clearPending(m, order.subscriptionId);
      }
    });
  }

  cancelAutomatic(portfolioId: string): Promise<void> {
    return this.queue.run(portfolioId, () => this.cancelAutomaticNow(portfolioId));
  }

  private async cancelAutomaticNow(portfolioId: string): Promise<void> {
    const m = this.dataSource.manager;
    const orders = await m.findBy(OrderEntity, {
      portfolioId,
      status: 'pending',
      source: 'signal',
    });
    const failed: string[] = [];
    for (const order of orders) {
      try {
        if (order.brokerOrderId) await this.cancelRemote(order.brokerOrderId);
      } catch (error) {
        // Still open at the broker: keep it pending (its trade update settles it) and go on, so
        // one unreachable order does not leave the others running.
        failed.push(order.clientOrderId);
        this.logger.error({
          msg: 'Cancelling an order on halt failed',
          orderId: order.id,
          err: error,
        });
        continue;
      }
      order.status = 'cancelled';
      order.rejectReason = 'halted';
      await m.save(order);
      if (order.subscriptionId) await this.clearPending(m, order.subscriptionId);
    }
    if (failed.length) {
      throw new UpstreamError(
        `Could not cancel ${failed.length} order(s) at Alpaca: ${failed.join(', ')}`,
      );
    }
  }

  deactivateSubscription(portfolioId: string, subscriptionId: string): Promise<void> {
    return this.queue.run(portfolioId, async () => {
      const m = this.dataSource.manager;
      const sub = await m.findOneBy(PortfolioSubscriptionEntity, {
        id: subscriptionId,
        portfolioId,
      });
      if (!sub) throw new NotFoundError(`Subscription ${subscriptionId} not found`);
      const pending = await m.findBy(OrderEntity, {
        subscriptionId,
        status: 'pending',
        source: 'signal',
      });
      for (const order of pending) {
        if (order.brokerOrderId) await this.cancelRemote(order.brokerOrderId);
        order.status = 'cancelled';
        order.rejectReason = 'subscription_removed';
        await m.save(order);
      }
      sub.isActive = false;
      sub.state = { ...sub.state, pending: null };
      await m.save(sub);
      // The position and its broker-side stop / take-profit stay.
      await m.update(PositionEntity, { portfolioId, subscriptionId }, { subscriptionId: null });
    });
  }

  private async isHalted(m: EntityManager, portfolio: PortfolioEntity): Promise<boolean> {
    if (portfolio.haltedAt) return true;
    return (await m.findOneBy(TradingStateEntity, { id: TRADING_STATE_ID }))?.halted ?? false;
  }
}

function entryRequest(
  symbol: string,
  side: 'buy' | 'sell',
  quantity: Decimal,
  levels: ProtectiveLevels,
  clientOrderId: string,
): AlpacaOrderRequest {
  return {
    symbol,
    side,
    type: 'market',
    time_in_force: 'day',
    qty: quantity.toString(),
    client_order_id: clientOrderId,
    ...protectiveLegs(levels, side === 'sell' ? 'short' : 'long'),
  };
}

/** Bracket / OTO legs. Rounding never tightens a level: for a short the stop rounds up. */
function protectiveLegs(
  levels: ProtectiveLevels,
  side: 'long' | 'short' = 'long',
): Partial<AlpacaOrderRequest> {
  const cls = orderClass(levels);
  if (cls === 'simple') return {};
  const short = side === 'short';
  return {
    order_class: cls,
    ...(levels.takeProfit !== undefined
      ? { take_profit: { limit_price: brokerPrice(levels.takeProfit, short ? 'down' : 'up') } }
      : {}),
    ...(levels.stopLoss !== undefined
      ? { stop_loss: { stop_price: brokerPrice(levels.stopLoss, short ? 'up' : 'down') } }
      : {}),
  };
}

/** Market order that closes a position: a sell for a long, a buy-to-cover for a short. */
function closeRequest(
  symbol: string,
  side: OrderSide,
  quantity: string,
  clientOrderId: string,
): AlpacaOrderRequest {
  return {
    symbol,
    side: side === 'BUY' ? 'buy' : 'sell',
    type: 'market',
    time_in_force: 'day',
    qty: quantity,
    client_order_id: clientOrderId,
  };
}

function accountView(a: AlpacaAccount) {
  return {
    id: a.id,
    status: a.status,
    cash: a.cash,
    equity: a.equity,
    buyingPower: a.buying_power,
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Paper shorts need a shortable, easy-to-borrow asset. */
const isShortable = (asset: AlpacaAsset | null): boolean =>
  Boolean(asset?.shortable && asset.easy_to_borrow);

/** Side of the order a decision would send. */
const orderSideOf = (decision: PendingOrder): OrderSide =>
  decision.kind === 'entry' ? (decision.side === 'short' ? 'SELL' : 'BUY') : 'SELL';
