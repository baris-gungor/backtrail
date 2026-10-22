import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { Repository } from 'typeorm';
import {
  ConflictError,
  InvalidInputError,
  NotFoundError,
} from '../../../common/errors/domain.error';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import { AssetsService } from '../../assets/application/assets.service';
import { AuditService } from '../../audit/application/audit.service';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import {
  DEFAULT_EXECUTION,
  toSizing,
  type SizingRequest,
  type TradeDirection,
} from '../domain/execution';
import { DEFAULT_RISK_RULES, type RiskRules } from '../domain/risk';
import { FLAT_SLOT } from '../domain/slot-state';
import { OrderEntity } from '../infrastructure/order.entity';
import {
  PortfolioSubscriptionEntity,
  type SubscriptionSource,
} from '../infrastructure/portfolio-subscription.entity';
import { AlpacaBroker } from '../infrastructure/alpaca-broker';
import {
  PortfolioEntity,
  type PortfolioExecution,
  type PortfolioMode,
} from '../infrastructure/portfolio.entity';
import { PositionEntity } from '../infrastructure/position.entity';
import { BrokerRouter } from './broker-router.service';
import { PortfolioValuationService } from './portfolio-valuation.service';

export interface ExecutionRequest {
  feeBps?: number;
  slippageBps?: number;
  minFee?: number;
  borrowPct?: number;
  sizing?: SizingRequest;
}

export interface CreatePortfolioRequest {
  name: string;
  /** Default `paper`. `alpaca_paper` takes its cash from the demo account. */
  mode?: PortfolioMode;
  /** Required for `paper`; ignored for `alpaca_paper`. */
  initialCash?: number;
  riskRules?: Partial<RiskRules>;
  execution?: ExecutionRequest;
}

export interface UpdatePortfolioRequest {
  riskRules?: Partial<RiskRules>;
  isActive?: boolean;
}

export interface SubscriptionRequest {
  strategyConfigId: string;
  symbol: string;
  source?: SubscriptionSource;
  allocationPct?: number;
  /** Default long. Shorts need `riskRules.allowShort` and a strategy with short rules. */
  direction?: TradeDirection;
}

/** Field by field: a DTO may carry optional keys set to undefined. */
function mergeRules(base: RiskRules, input: Partial<RiskRules> = {}): RiskRules {
  return {
    maxPositionPct: input.maxPositionPct ?? base.maxPositionPct,
    maxOpenPositions: input.maxOpenPositions ?? base.maxOpenPositions,
    maxDailyLossPct: input.maxDailyLossPct ?? base.maxDailyLossPct,
    requireStopLoss: input.requireStopLoss ?? base.requireStopLoss,
    cashBufferPct: input.cashBufferPct ?? base.cashBufferPct,
    earningsExit: input.earningsExit ?? base.earningsExit ?? false,
    earningsBlockDays: input.earningsBlockDays ?? base.earningsBlockDays ?? 0,
    allowShort: input.allowShort ?? base.allowShort ?? false,
  };
}

function toExecution(input: ExecutionRequest = {}): PortfolioExecution {
  return {
    feeBps: input.feeBps ?? DEFAULT_EXECUTION.feeBps,
    slippageBps: input.slippageBps ?? DEFAULT_EXECUTION.slippageBps,
    minFee: input.minFee ?? DEFAULT_EXECUTION.minFee,
    ...(input.borrowPct ? { borrowPct: input.borrowPct } : {}),
    sizing: toSizing(input.sizing),
  };
}

/** Portfolio and subscription management. Order flow lives in the broker. */
@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(PortfolioEntity) private readonly portfolios: Repository<PortfolioEntity>,
    @InjectRepository(PortfolioSubscriptionEntity)
    private readonly subscriptions: Repository<PortfolioSubscriptionEntity>,
    @InjectRepository(PositionEntity) private readonly positions: Repository<PositionEntity>,
    @InjectRepository(OrderEntity) private readonly orders: Repository<OrderEntity>,
    private readonly assets: AssetsService,
    private readonly catalog: StrategyCatalogService,
    private readonly marketData: MarketDataQueryService,
    private readonly valuation: PortfolioValuationService,
    private readonly brokers: BrokerRouter,
    private readonly alpaca: AlpacaBroker,
    private readonly audit: AuditService,
  ) {}

  async create(request: CreatePortfolioRequest): Promise<PortfolioEntity> {
    if (await this.portfolios.existsBy({ name: request.name })) {
      throw new ConflictError(`Portfolio ${request.name} already exists`);
    }
    const mode = request.mode ?? 'paper';
    const account = mode === 'alpaca_paper' ? await this.alpaca.prepareLink() : null;
    if (!account && request.initialCash === undefined) {
      throw new InvalidInputError('initialCash is required for a simulated portfolio');
    }
    const cash = new Decimal(account ? account.cash : request.initialCash!).toString();
    const execution = toExecution(request.execution);
    // The demo broker charges no commission; slippage still pads the sizing estimate.
    if (account) execution.feeBps = 0;
    const portfolio = await this.portfolios.save(
      this.portfolios.create({
        name: request.name,
        mode,
        initialCash: cash,
        cashBalance: cash,
        riskRules: mergeRules(DEFAULT_RISK_RULES, request.riskRules),
        execution,
        isActive: true,
      }),
    );
    if (account) {
      try {
        await this.alpaca.link(portfolio.id, account);
      } catch (error) {
        // Without its broker account the demo portfolio cannot trade; do not leave it behind.
        await this.portfolios.delete({ id: portfolio.id });
        throw error;
      }
    }
    await this.valuation.trySnapshot(portfolio.id);
    await this.audit.record({
      action: 'portfolio.create',
      entityType: 'portfolio',
      entityId: portfolio.id,
      after: { ...portfolio, brokerAccount: account?.id ?? null },
    });
    return portfolio;
  }

  async get(id: string): Promise<PortfolioEntity> {
    const portfolio = await this.portfolios.findOneBy({ id });
    if (!portfolio) throw new NotFoundError(`Portfolio ${id} not found`);
    return portfolio;
  }

  list(): Promise<PortfolioEntity[]> {
    return this.portfolios.find({ order: { createdAt: 'ASC' } });
  }

  async update(id: string, request: UpdatePortfolioRequest): Promise<PortfolioEntity> {
    const portfolio = await this.get(id);
    const before = { riskRules: portfolio.riskRules, isActive: portfolio.isActive };
    if (request.riskRules) portfolio.riskRules = mergeRules(portfolio.riskRules, request.riskRules);
    if (request.isActive !== undefined) portfolio.isActive = request.isActive;
    const saved = await this.portfolios.save(portfolio);
    await this.audit.record({
      action: 'portfolio.update',
      entityType: 'portfolio',
      entityId: id,
      before,
      after: { riskRules: saved.riskRules, isActive: saved.isActive },
    });
    return saved;
  }

  async remove(id: string): Promise<void> {
    const portfolio = await this.get(id);
    await (await this.brokers.forPortfolio(id)).whenIdle();
    await this.portfolios.delete({ id });
    await this.audit.record({
      action: 'portfolio.delete',
      entityType: 'portfolio',
      entityId: id,
      before: portfolio,
    });
  }

  async subscribe(
    portfolioId: string,
    request: SubscriptionRequest,
  ): Promise<PortfolioSubscriptionEntity> {
    const portfolio = await this.get(portfolioId);
    const asset = await this.assets.findBySymbol(request.symbol);
    const { config, strategy } = await this.catalog.configById(request.strategyConfigId);
    const source = request.source ?? 'strategy';
    if (source === 'signals' && !config.isActive) {
      throw new InvalidInputError(
        'Signals are generated only for active configs; activate the config or use source=strategy',
      );
    }
    const direction = request.direction ?? 'long';
    if (direction !== 'long') {
      if (!portfolio.riskRules.allowShort) {
        throw new InvalidInputError('Shorts are off for this portfolio; set riskRules.allowShort');
      }
      if (!strategy.canShort) throw new InvalidInputError(`${strategy.code} has no short rules`);
      // Stored signals are long-only (BUY/SELL), so shorts follow the strategy rules.
      if (source === 'signals') throw new InvalidInputError('Shorts need source=strategy');
    }
    if (portfolio.mode === 'alpaca_paper') await this.alpaca.assertTradable(asset.id, direction);

    const existing = await this.subscriptions.findOneBy({
      portfolioId,
      strategyConfigId: config.id,
      assetId: asset.id,
    });
    if (existing?.isActive) {
      throw new ConflictError('This strategy config already trades this asset in the portfolio');
    }
    // Trading starts after the latest closed bar; history is not replayed.
    const latest = await this.marketData.latestBar(asset.id, '4h', { completeOnly: true });
    const saved = await this.subscriptions.save(
      Object.assign(existing ?? this.subscriptions.create(), {
        portfolioId,
        strategyConfigId: config.id,
        assetId: asset.id,
        source,
        allocationPct: request.allocationPct ?? null,
        direction,
        isActive: true,
        startBarTime: latest?.openTime ?? null,
        lastBarTime: latest?.openTime ?? null,
        state: { ...FLAT_SLOT },
      }),
    );
    await this.audit.record({
      action: 'subscription.create',
      entityType: 'subscription',
      entityId: saved.id,
      after: {
        portfolioId,
        symbol: asset.symbol,
        strategyConfigId: config.id,
        source,
        direction,
      },
    });
    return saved;
  }

  /**
   * Processes the stored closed bars of every asset the portfolio trades, holds or has a pending
   * order in, without waiting for the next sync.
   */
  async process(portfolioId: string): Promise<void> {
    const portfolio = await this.get(portfolioId);
    const broker = this.brokers.forMode(portfolio.mode);
    const assetIds = new Set([
      ...(await this.subscriptions.findBy({ portfolioId, isActive: true })).map((s) => s.assetId),
      ...(await this.positions.findBy({ portfolioId })).map((p) => p.assetId),
      ...(await this.orders.findBy({ portfolioId, status: 'pending' })).map((o) => o.assetId),
    ]);
    for (const assetId of assetIds) await broker.processAsset(assetId, portfolioId);
  }
}
