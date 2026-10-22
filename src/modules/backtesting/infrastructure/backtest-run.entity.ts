import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import type { StrategyParams } from '../../analysis/domain/strategy';
import { StrategyConfigEntity } from '../../analysis/infrastructure/strategy-config.entity';
import { AssetEntity } from '../../assets/infrastructure/asset.entity';
import type { Timeframe } from '../../market-data/domain/bar';
import type {
  EarningsRule,
  ExecutionModel,
  PositionSizing,
  TradeDirection,
} from '../../trading/domain/execution';
import type { DataQualityReport } from '../domain/data-quality';
import type { BacktestMetrics } from '../domain/metrics';
import type { WalkForwardMetric, WalkForwardSummary } from '../domain/walk-forward';

export enum BacktestStatus {
  Pending = 'pending',
  Running = 'running',
  Success = 'success',
  Failed = 'failed',
}

/**
 * `run`: requested directly (matrix). `sweep`: part of a parameter sweep.
 * `walk_forward`: part of a walk-forward analysis.
 */
export type BacktestSource = 'run' | 'sweep' | 'walk_forward';
/**
 * `full`: the whole period. `train` / `test`: sweep or walk-forward segments.
 * `oos`: the joined out-of-sample result of a walk-forward analysis.
 */
export type BacktestSegment = 'full' | 'train' | 'test' | 'oos';

export interface BacktestExecution extends ExecutionModel {
  sizing: PositionSizing;
  riskFreeRate: number;
  /** Prices were roll-adjusted. Missing on runs stored before the option. */
  adjustRolls?: boolean;
  /** Earnings filter; missing when off. */
  earnings?: EarningsRule;
  /** `short` or `both`; missing means long. */
  direction?: TradeDirection;
}

export type StoredMetrics = BacktestMetrics & { dataQuality: DataQualityReport };

/** Walk-forward settings and position of a run; times are ISO strings. */
export interface WalkForwardInfo {
  /** Window index; null on the joined out-of-sample run. */
  window: number | null;
  windows: number;
  trainRatio: number;
  anchored: boolean;
  metric: WalkForwardMetric;
  /** Parameter combinations tried on each train segment. */
  combinations: number;
  trainFrom: string;
  testFrom: string;
  /** Last bar of the test segment. */
  testTo: string;
  /** Joined out-of-sample run only. */
  summary?: WalkForwardSummary;
}

@Entity('backtest_runs')
@Index(['assetId', 'strategyCode'])
@Index(['batchId'])
export class BacktestRunEntity {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  /** Runs created by the same request share a batch. */
  @Column({ type: 'uuid' })
  batchId: string;

  @Column({ type: 'varchar', length: 16 })
  source: BacktestSource;

  @Column({ type: 'varchar', length: 64 })
  strategyCode: string;

  @Column({ type: 'int' })
  strategyVersion: number;

  /** Set when the run used a stored config. */
  @Column({ type: 'uuid', nullable: true })
  strategyConfigId: string | null;

  @Column({ type: 'varchar', length: 64, nullable: true })
  configName: string | null;

  /** Full validated params. */
  @Column({ type: 'jsonb' })
  params: StrategyParams;

  @Column({ type: 'uuid' })
  assetId: string;

  @Column({ type: 'varchar', length: 8 })
  timeframe: Timeframe;

  /** Requested period; null means from the first / up to the last stored bar. */
  @Column({ type: 'timestamptz', nullable: true })
  periodFrom: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  periodTo: Date | null;

  @Column({ type: 'varchar', length: 8 })
  segment: BacktestSegment;

  /** Decimal string. */
  @Column({ type: 'numeric', precision: 18, scale: 2 })
  initialCapital: string;

  @Column({ type: 'jsonb' })
  execution: BacktestExecution;

  @Column({ type: 'varchar', length: 16 })
  status: BacktestStatus;

  @Column({ type: 'jsonb', nullable: true })
  metrics: StoredMetrics | null;

  /** Set on walk-forward runs. */
  @Column({ type: 'jsonb', nullable: true })
  walkForward: WalkForwardInfo | null;

  /** [[epochMs, equity], ...], downsampled to at most 1000 points. Not stored for sweep train runs. */
  @Column({ type: 'jsonb', nullable: true })
  equityCurve: [number, number][] | null;

  /** Buy & hold curve on the same time points. */
  @Column({ type: 'jsonb', nullable: true })
  benchmarkCurve: [number, number][] | null;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  /** FK only. */
  @ManyToOne(() => AssetEntity, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'asset_id' })
  asset?: AssetEntity;

  /** FK only. */
  @ManyToOne(() => StrategyConfigEntity, { onDelete: 'SET NULL' })
  @JoinColumn({ name: 'strategy_config_id' })
  strategyConfig?: StrategyConfigEntity;
}
