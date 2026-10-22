import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { Between, FindOptionsWhere, MoreThanOrEqual, LessThanOrEqual, Repository } from 'typeorm';
import { NotFoundError } from '../../../common/errors/domain.error';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import { AssetsService } from '../../assets/application/assets.service';
import type { TradeDirection } from '../domain/execution';
import type { OrderStatus } from '../domain/order';
import type { RiskRules } from '../domain/risk';
import { ClosedTradeEntity } from '../infrastructure/closed-trade.entity';
import { FillEntity } from '../infrastructure/fill.entity';
import { OrderEntity } from '../infrastructure/order.entity';
import { PerformanceSnapshotEntity } from '../infrastructure/performance-snapshot.entity';
import {
  PortfolioSubscriptionEntity,
  type StoredHealth,
  type SubscriptionSource,
} from '../infrastructure/portfolio-subscription.entity';
import { PortfolioEntity, type PortfolioExecution } from '../infrastructure/portfolio.entity';
import { PositionEntity } from '../infrastructure/position.entity';
import { PortfolioService } from './portfolio.service';
import { PortfolioValuationService } from './portfolio-valuation.service';
import { AlpacaBroker, type BrokerAccountView } from '../infrastructure/alpaca-broker';
import { ReconciliationRunEntity } from '../infrastructure/reconciliation-run.entity';

export type BrokerSummaryView = BrokerAccountView & {
  mode: string;
  reconciliations: ReconciliationRunEntity[];
};

/** Money fields are decimal strings; prices are numbers. */
export interface PortfolioSummaryView {
  id: string;
  name: string;
  mode: string;
  baseCurrency: string;
  isActive: boolean;
  haltedAt: Date | null;
  haltReason: string | null;
  initialCash: string;
  cash: string;
  positionsValue: string;
  equity: string;
  /** equity / initialCash − 1. */
  totalReturn: number;
  /** Equity change since the start of the UTC day; null without an earlier snapshot. */
  dayPnl: string | null;
  realizedPnl: string;
  openPositions: number;
  riskRules: RiskRules;
  execution: PortfolioExecution;
  createdAt: Date;
}

export interface PositionView {
  assetId: string;
  symbol: string;
  quantity: string;
  avgPrice: string;
  /** Near-live quote, or the latest 1h close when no fresher quote exists. */
  lastPrice: number;
  /** When `lastPrice` was observed; null when the position has no market data (entry price shown). */
  priceAsOf: Date | null;
  priceSource: 'quote' | 'bar' | null;
  marketValue: string;
  /** Before the exit fee. */
  unrealizedPnl: string;
  stopLoss: number | null;
  takeProfit: number | null;
  openedAt: Date;
  subscriptionId: string | null;
}

export interface SubscriptionView {
  id: string;
  symbol: string;
  strategyConfigId: string;
  strategyCode: string;
  configName: string;
  source: SubscriptionSource;
  allocationPct: number | null;
  direction: TradeDirection;
  isActive: boolean;
  lastBarTime: Date | null;
  createdAt: Date;
  /** Last strategy health check; null until checked. */
  health: StoredHealth | null;
}

export interface PortfolioDetailView extends PortfolioSummaryView {
  positions: PositionView[];
  subscriptions: SubscriptionView[];
}

export type OrderView = OrderEntity & { symbol: string };
export type FillView = FillEntity & { symbol: string };
export type TradeView = ClosedTradeEntity & { symbol: string };

export interface EquityPointView {
  at: Date;
  equity: string;
  cash: string;
  drawdown: number;
}

@Injectable()
export class TradingQueryService {
  constructor(
    @InjectRepository(PositionEntity) private readonly positions: Repository<PositionEntity>,
    @InjectRepository(PortfolioSubscriptionEntity)
    private readonly subscriptions: Repository<PortfolioSubscriptionEntity>,
    @InjectRepository(OrderEntity) private readonly orders: Repository<OrderEntity>,
    @InjectRepository(FillEntity) private readonly fills: Repository<FillEntity>,
    @InjectRepository(ClosedTradeEntity) private readonly trades: Repository<ClosedTradeEntity>,
    @InjectRepository(PerformanceSnapshotEntity)
    private readonly snapshots: Repository<PerformanceSnapshotEntity>,
    private readonly portfolioService: PortfolioService,
    private readonly valuation: PortfolioValuationService,
    private readonly assets: AssetsService,
    private readonly catalog: StrategyCatalogService,
    @InjectRepository(ReconciliationRunEntity)
    private readonly reconciliations: Repository<ReconciliationRunEntity>,
    private readonly alpaca: AlpacaBroker,
  ) {}

  async list(): Promise<PortfolioSummaryView[]> {
    const portfolios = await this.portfolioService.list();
    return Promise.all(portfolios.map((p) => this.summary(p).then((s) => s.view)));
  }

  async detail(id: string): Promise<PortfolioDetailView> {
    const portfolio = await this.portfolioService.get(id);
    const { view, positions, prices, marks } = await this.summary(portfolio);
    const symbols = await this.symbols();
    const configs = await this.configNames();
    const subs = await this.subscriptions.find({
      where: { portfolioId: id },
      order: { createdAt: 'ASC' },
    });

    return {
      ...view,
      positions: positions.map((p) => {
        const quantity = new Decimal(p.quantity);
        const lastPrice = prices.get(p.assetId)!;
        const marketValue = quantity.mul(lastPrice);
        return {
          assetId: p.assetId,
          symbol: symbols.get(p.assetId) ?? p.assetId,
          quantity: p.quantity,
          avgPrice: p.avgPrice,
          lastPrice,
          priceAsOf: marks.get(p.assetId)?.asOf ?? null,
          priceSource: marks.get(p.assetId)?.source ?? null,
          marketValue: marketValue.toFixed(2),
          unrealizedPnl: marketValue.minus(quantity.mul(p.avgPrice)).minus(p.entryFee).toFixed(2),
          stopLoss: p.stopLoss,
          takeProfit: p.takeProfit,
          openedAt: p.openedAt,
          subscriptionId: p.subscriptionId,
        };
      }),
      subscriptions: subs.map((s) => ({
        id: s.id,
        symbol: symbols.get(s.assetId) ?? s.assetId,
        strategyConfigId: s.strategyConfigId,
        strategyCode: configs.get(s.strategyConfigId)?.code ?? '?',
        configName: configs.get(s.strategyConfigId)?.name ?? '?',
        source: s.source,
        allocationPct: s.allocationPct,
        direction: s.direction,
        isActive: s.isActive,
        lastBarTime: s.lastBarTime,
        createdAt: s.createdAt,
        health: s.health,
      })),
    };
  }

  /** Demo-broker account and recent reconciliation runs. */
  async brokerSummary(portfolioId: string): Promise<BrokerSummaryView> {
    const portfolio = await this.portfolioService.get(portfolioId);
    const reconciliations = await this.reconciliations.find({
      where: { portfolioId },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    const status =
      portfolio.mode === 'alpaca_paper'
        ? await this.alpaca.status()
        : {
            enabled: false,
            environment: 'paper' as const,
            account: null,
            error: 'simulated portfolio',
          };
    return { ...status, mode: portfolio.mode, reconciliations };
  }

  async listOrders(portfolioId: string, status?: OrderStatus, limit = 200): Promise<OrderView[]> {
    await this.portfolioService.get(portfolioId);
    const where: FindOptionsWhere<OrderEntity> = { portfolioId };
    if (status) where.status = status;
    const rows = await this.orders.find({ where, order: { createdAt: 'DESC' }, take: limit });
    return this.withSymbols(rows);
  }

  async getOrder(portfolioId: string, orderId: string): Promise<OrderView> {
    const order = await this.orders.findOneBy({ id: orderId, portfolioId });
    if (!order) throw new NotFoundError(`Order ${orderId} not found`);
    const [view] = await this.withSymbols([order]);
    return view;
  }

  async listFills(portfolioId: string, limit = 200): Promise<FillView[]> {
    await this.portfolioService.get(portfolioId);
    const rows = await this.fills.find({
      where: { portfolioId },
      order: { executedAt: 'DESC' },
      take: limit,
    });
    return this.withSymbols(rows);
  }

  async listTrades(portfolioId: string, limit = 200): Promise<TradeView[]> {
    await this.portfolioService.get(portfolioId);
    const rows = await this.trades.find({
      where: { portfolioId },
      order: { exitTime: 'DESC' },
      take: limit,
    });
    return this.withSymbols(rows);
  }

  async equity(portfolioId: string, from?: Date, to?: Date): Promise<EquityPointView[]> {
    await this.portfolioService.get(portfolioId);
    const where: FindOptionsWhere<PerformanceSnapshotEntity> = { portfolioId };
    if (from && to) where.at = Between(from, to);
    else if (from) where.at = MoreThanOrEqual(from);
    else if (to) where.at = LessThanOrEqual(to);
    const rows = await this.snapshots.find({ where, order: { at: 'ASC' } });
    return rows.map(({ at, equity, cash, drawdown }) => ({ at, equity, cash, drawdown }));
  }

  private async summary(portfolio: PortfolioEntity) {
    const positions = await this.positions.find({
      where: { portfolioId: portfolio.id },
      order: { openedAt: 'ASC' },
    });
    const { cash, positionsValue, equity, prices, marks } = await this.valuation.value(
      portfolio,
      positions,
    );
    const dayStart = await this.valuation.dayStartEquity(portfolio.id);
    const realized = await this.trades
      .createQueryBuilder('t')
      .select('COALESCE(SUM(t.pnl), 0)', 'total')
      .where('t.portfolioId = :id', { id: portfolio.id })
      .getRawOne<{ total: string }>();
    const view: PortfolioSummaryView = {
      id: portfolio.id,
      name: portfolio.name,
      mode: portfolio.mode,
      haltedAt: portfolio.haltedAt,
      haltReason: portfolio.haltReason,
      baseCurrency: portfolio.baseCurrency,
      isActive: portfolio.isActive,
      initialCash: portfolio.initialCash,
      cash: cash.toFixed(2),
      positionsValue: positionsValue.toFixed(2),
      equity: equity.toFixed(2),
      totalReturn: equity.div(portfolio.initialCash).minus(1).toNumber(),
      dayPnl: dayStart ? equity.minus(dayStart).toFixed(2) : null,
      realizedPnl: new Decimal(realized?.total ?? 0).toFixed(2),
      openPositions: positions.length,
      riskRules: portfolio.riskRules,
      execution: portfolio.execution,
      createdAt: portfolio.createdAt,
    };
    return { view, positions, prices, marks };
  }

  private async withSymbols<T extends { assetId: string }>(
    rows: T[],
  ): Promise<(T & { symbol: string })[]> {
    const symbols = await this.symbols();
    return rows.map((row) => ({ ...row, symbol: symbols.get(row.assetId) ?? row.assetId }));
  }

  private async symbols(): Promise<Map<string, string>> {
    const assets = await this.assets.findAll({});
    return new Map(assets.map((a) => [a.id, a.symbol]));
  }

  private async configNames(): Promise<Map<string, { code: string; name: string }>> {
    const strategies = await this.catalog.list();
    return new Map(
      strategies.flatMap((s) => s.configs.map((c) => [c.id, { code: s.code, name: c.name }])),
    );
  }
}
