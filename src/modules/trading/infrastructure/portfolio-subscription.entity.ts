import { Column, Entity, JoinColumn, ManyToOne, Unique } from 'typeorm';
import { BaseEntity } from '../../../common/base.entity';
import { numericToNumber } from '../../../database/transformers/numeric.transformer';
import { StrategyConfigEntity } from '../../analysis/infrastructure/strategy-config.entity';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import type { TradeDirection } from '../domain/execution';
import type { HealthResult } from '../domain/health';
import type { StoredSlot } from '../domain/slot-state';
import { PortfolioEntity } from './portfolio.entity';

/**
 * `strategy`: the strategy rules are driven bar by bar, exactly as in a backtest.
 * `signals`: stored signals (the `signals` table) become orders.
 */
export type SubscriptionSource = 'strategy' | 'signals';

/** Health result as stored; `checkedAt` is ISO, `runId` the backtest it was compared with. */
export type StoredHealth = HealthResult & { checkedAt: string; runId: string | null };

/** Automatic trading of one strategy config on one asset inside a portfolio. */
@Entity('portfolio_subscriptions')
@Unique(['portfolioId', 'strategyConfigId', 'assetId'])
export class PortfolioSubscriptionEntity extends BaseEntity {
  @Column({ type: 'uuid' })
  portfolioId: string;

  @Column({ type: 'uuid' })
  strategyConfigId: string;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'varchar', length: 8, default: 'strategy' })
  source: SubscriptionSource;

  /** Overrides the portfolio sizing with a fixed fraction of equity (percent). */
  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    nullable: true,
    transformer: numericToNumber,
  })
  allocationPct: number | null;

  /** Entries the strategy may take; shorts also need `riskRules.allowShort`. */
  @Column({ type: 'varchar', length: 5, default: 'long' })
  direction: TradeDirection;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  /** The latest closed 4h bar when the subscription was (re)activated; trading starts after it. */
  @Column({ type: 'timestamptz', nullable: true })
  startBarTime: Date | null;

  /** Open time of the last processed 4h bar. Bars up to it are never traded again. */
  @Column({ type: 'timestamptz', nullable: true })
  lastBarTime: Date | null;

  /** Execution state between syncs (pending decision, entry, protective levels). */
  @Column({ type: 'jsonb' })
  state: StoredSlot;

  /** Last health check against the backtest; null until the first check. */
  @Column({ type: 'jsonb', nullable: true })
  health: StoredHealth | null;

  /** FK only. */
  @ManyToOne(() => PortfolioEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'portfolio_id' })
  portfolio?: PortfolioEntity;

  @ManyToOne(() => StrategyConfigEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'strategy_config_id' })
  strategyConfig?: StrategyConfigEntity;

  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;
}
