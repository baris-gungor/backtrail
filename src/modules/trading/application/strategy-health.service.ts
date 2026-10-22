import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import type { ConfigType } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { appConfig } from '../../../config';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import { AssetsService } from '../../assets/application/assets.service';
import { BacktestQueryService } from '../../backtesting/application/backtest-query.service';
import { NotificationService } from '../../notifications/application/notification.service';
import { assessHealth, type HealthResult } from '../domain/health';
import { ClosedTradeEntity } from '../infrastructure/closed-trade.entity';
import {
  PortfolioSubscriptionEntity,
  type StoredHealth,
} from '../infrastructure/portfolio-subscription.entity';
import { PortfolioEntity } from '../infrastructure/portfolio.entity';

/** Checks run hourly; trades close at most every 4h bar, so more often finds nothing new. */
const CHECK_INTERVAL_MS = 60 * 60 * 1000;

export interface SubscriptionHealthView {
  subscriptionId: string;
  health: StoredHealth;
}

/**
 * Strategy health: compares each active subscription's closed trades with the
 * latest full-period backtest of the same asset and config. The result is stored on the
 * subscription; a change to or from `warning` is sent as a notification once.
 */
@Injectable()
export class StrategyHealthService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(StrategyHealthService.name);
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(
    @InjectRepository(PortfolioSubscriptionEntity)
    private readonly subscriptions: Repository<PortfolioSubscriptionEntity>,
    @InjectRepository(ClosedTradeEntity) private readonly trades: Repository<ClosedTradeEntity>,
    @InjectRepository(PortfolioEntity) private readonly portfolios: Repository<PortfolioEntity>,
    private readonly backtests: BacktestQueryService,
    private readonly catalog: StrategyCatalogService,
    private readonly assets: AssetsService,
    private readonly notifications: NotificationService,
    @Inject(appConfig.KEY) private readonly app: ConfigType<typeof appConfig>,
  ) {}

  onApplicationBootstrap(): void {
    // Tests call `check` themselves.
    if (this.app.env === 'test') return;
    this.timer = setInterval(() => {
      this.running ??= this.check()
        .then(() => undefined)
        .catch((error: unknown) => this.logger.error({ msg: 'Health check failed', err: error }))
        .finally(() => (this.running = undefined));
    }, CHECK_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    clearInterval(this.timer);
    await this.running;
  }

  /** Checks active subscriptions (all, or one portfolio's), stores the results, notifies changes. */
  async check(portfolioId?: string): Promise<SubscriptionHealthView[]> {
    const subs = await this.subscriptions.findBy({
      isActive: true,
      ...(portfolioId ? { portfolioId } : {}),
    });
    const now = new Date();
    const views: SubscriptionHealthView[] = [];
    for (const sub of subs) {
      // One subscription failing (a missing config, a DB hiccup) must not stop the others.
      try {
        const health = await this.assess(sub, now);
        const previous = sub.health?.level;
        sub.health = health;
        await this.subscriptions.update({ id: sub.id }, { health });
        await this.notifyChange(sub, previous, health);
        views.push({ subscriptionId: sub.id, health });
      } catch (error) {
        this.logger.error({
          msg: 'Health check of a subscription failed',
          subId: sub.id,
          err: error,
        });
      }
    }
    return views;
  }

  private async assess(sub: PortfolioSubscriptionEntity, now: Date): Promise<StoredHealth> {
    const expected = await this.backtests.healthExpectation(
      sub.assetId,
      sub.strategyConfigId,
      sub.direction,
    );
    const trades = await this.trades.find({
      select: { returnPct: true, exitTime: true },
      where: { subscriptionId: sub.id },
      order: { exitTime: 'ASC' },
    });
    const result: HealthResult = assessHealth(
      {
        returns: trades.map((t) => t.returnPct),
        since: sub.startBarTime ?? sub.createdAt,
        lastExit: trades.at(-1)?.exitTime ?? null,
        now,
      },
      expected,
    );
    return { ...result, checkedAt: now.toISOString(), runId: expected?.runId ?? null };
  }

  /** Into warning, or out of a warning: one message per change. */
  private async notifyChange(
    sub: PortfolioSubscriptionEntity,
    previous: string | undefined,
    health: StoredHealth,
  ): Promise<void> {
    const enters = health.level === 'warning' && previous !== 'warning';
    const leaves = previous === 'warning' && health.level !== 'warning';
    if (!this.notifications.enabled || !(enters || leaves)) return;
    const portfolio = await this.portfolios.findOneBy({ id: sub.portfolioId });
    const { symbol } = await this.assets.findById(sub.assetId);
    const { config, strategy } = await this.catalog.configById(sub.strategyConfigId);
    this.notifications.notify(
      this.notifications.texts.healthMessage({
        portfolio: portfolio?.name ?? '?',
        symbol,
        strategy: strategy.code,
        config: config.name,
        level: health.level,
        findings: health.checks.filter((c) => c.level === 'warning').map((c) => c.message),
      }),
    );
  }
}
