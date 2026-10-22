import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsNumber,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
  ValidateNested,
} from 'class-validator';
import type { PositionSide, PositionSizing, TradeDirection } from '../../trading/domain/execution';
import type { ExitReason } from '../domain/engine';
import type { ParamRange } from '../domain/sweep';
import { WALK_FORWARD_METRICS, type WalkForwardMetric } from '../domain/walk-forward';
import { LEADERBOARD_METRICS, type LeaderboardMetric } from '../application/backtest-query.service';
import type {
  BacktestSegment,
  BacktestSource,
  BacktestStatus,
} from '../infrastructure/backtest-run.entity';

// Requests

export class StrategySelectionDto {
  /** Strategy code, e.g. trend_ema_adx */
  @IsString()
  code: string;

  /** Stored config name, e.g. default. Its params are the base for `params`. */
  @IsOptional()
  @IsString()
  config?: string;

  /** Params; missing keys come from the config or the defaults. */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class ExecutionInputDto {
  /** Default 5 (0.05%) */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  feeBps?: number;

  /** Default 5 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1000)
  slippageBps?: number;

  /** Default 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  minFee?: number;

  /** Annual borrow cost of short positions, percent of entry notional. Default 0 */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(100)
  borrowPct?: number;
}

export class SizingDto {
  @IsIn(['all_in', 'fixed_fraction', 'risk_per_trade'])
  type: PositionSizing['type'];

  /** fixed_fraction: share of equity, (0, 1]. Default 1. */
  @IsOptional()
  @IsNumber()
  @Min(0.001)
  @Max(1)
  fraction?: number;

  /** risk_per_trade: % of equity risked to the stop. Default 1. */
  @IsOptional()
  @IsNumber()
  @Min(0.01)
  @Max(100)
  riskPct?: number;
}

export class EarningsRuleDto {
  /** Close a held position before each report (decided two bars before the report bar). */
  @IsBoolean()
  exitBefore: boolean;

  /** No new entries this many calendar days before a report. 0: only the last two bars. */
  @IsInt()
  @Min(0)
  @Max(30)
  blockEntryDays: number;
}

export class RunSettingsDto {
  /** Trading starts at the first bar on or after this time; earlier bars warm up indicators. */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  /** Default 10 000 */
  @IsOptional()
  @IsNumber()
  @Min(100)
  @Max(1_000_000_000)
  initialCapital?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ExecutionInputDto)
  execution?: ExecutionInputDto;

  /** Default fixed_fraction 1.0 */
  @IsOptional()
  @ValidateNested()
  @Type(() => SizingDto)
  sizing?: SizingDto;

  /** Annual risk-free rate for Sharpe and Sortino, e.g. 0.04. Default 0. */
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(1)
  riskFreeRate?: number;

  /**
   * Ratio back-adjust futures roll jumps (jumps over 3 ATR within 8 h of the previous bar) before
   * running. Trade prices are then adjusted prices. Default false.
   */
  @IsOptional()
  @IsBoolean()
  adjustRolls?: boolean;

  /** Earnings filter for equities (SEC/Yahoo report dates). Default off. */
  @IsOptional()
  @ValidateNested()
  @Type(() => EarningsRuleDto)
  earnings?: EarningsRuleDto;

  /** Entries to take: long (default), short or both. Shorts need a strategy with short rules. */
  @IsOptional()
  @IsIn(['long', 'short', 'both'])
  @ApiPropertyOptional({ enum: ['long', 'short', 'both'] })
  direction?: TradeDirection;
}

export class CreateBacktestDto extends RunSettingsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })
  symbols: string[];

  /** Default: every active stored config */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => StrategySelectionDto)
  strategies?: StrategySelectionDto[];
}

export class SweepDto extends RunSettingsDto {
  @IsString()
  symbol: string;

  @ValidateNested()
  @Type(() => StrategySelectionDto)
  strategy: StrategySelectionDto;

  /** Per param `{ min, max, step }` or a value list, e.g. `{ "fast": { "min": 10, "max": 30, "step": 5 } }`. At most 500 combinations. */
  @IsObject()
  paramGrid: Record<string, ParamRange>;

  /** Share of bars used for the train segment. Default 0.7. */
  @IsOptional()
  @IsNumber()
  @Min(0.1)
  @Max(0.95)
  trainRatio?: number;

  /** Best train results (by Sharpe) run on the test segment. Default 5. */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  top?: number;
}

export class WalkForwardDto extends RunSettingsDto {
  @IsString()
  symbol: string;

  @ValidateNested()
  @Type(() => StrategySelectionDto)
  strategy: StrategySelectionDto;

  /** Same format as the sweep grid. Combinations × windows: at most 2000. */
  @IsObject()
  paramGrid: Record<string, ParamRange>;

  /** Test segments. Default 5. */
  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(20)
  windows?: number;

  /** Train share of each train + test window. Default 0.7. */
  @IsOptional()
  @IsNumber()
  @Min(0.3)
  @Max(0.95)
  trainRatio?: number;

  /** Expanding train segments from the first bar instead of rolling ones. Default false. */
  @IsOptional()
  @IsBoolean()
  anchored?: boolean;

  /** Selects each window's params on its train segment. Default sharpe. */
  @IsOptional()
  @IsIn(WALK_FORWARD_METRICS)
  @ApiPropertyOptional({ enum: WALK_FORWARD_METRICS, default: 'sharpe' })
  metric?: WalkForwardMetric;
}

export class LeaderboardQueryDto {
  @IsOptional()
  @IsString()
  symbol?: string;

  /** Strategy code */
  @IsOptional()
  @IsString()
  strategy?: string;

  @IsOptional()
  @IsIn(LEADERBOARD_METRICS)
  @ApiPropertyOptional({ default: 'sharpe', enum: LEADERBOARD_METRICS })
  metric: LeaderboardMetric = 'sharpe';

  @IsOptional()
  /** `oos`: joined walk-forward results (included without `includeSweeps`). */
  @IsIn(['full', 'train', 'test', 'oos'])
  @ApiPropertyOptional({ default: 'full', enum: ['full', 'train', 'test', 'oos'] })
  segment: BacktestSegment = 'full';

  /** Include parameter-sweep runs. Default false. */
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  includeSweeps?: boolean;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  @ApiPropertyOptional({ default: 100 })
  limit: number = 100;
}

// Responses

export class SubmitResultDto {
  batchId: string;
  runs: number;
}

export class ReturnMetricsDto {
  totalReturn: number;
  cagr: number | null;
  maxDrawdown: number;
}

export class DataQualityDto {
  /** Bars opening more than 3 ATR from the previous close (futures rolls, data errors) */
  jumps: number;
  jumpTimes: string[];
  /** Holes longer than 4 days between bars */
  gaps: number;
  maxGapDays: number;
  /** Roll jumps removed by roll adjustment in the traded window; only on adjusted runs */
  rollAdjustments?: number;
}

export class BacktestMetricsDto extends ReturnMetricsDto {
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownBars: number;
  maxDrawdownDays: number;
  calmar: number | null;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  payoff: number | null;
  expectancy: number | null;
  exposure: number;
  avgHoldingBars: number | null;
  avgHoldingHours: number | null;
  totalFees: number;
  barsPerYear: number | null;
  /** Fewer than 10 trades: statistically weak */
  lowSample: boolean;
  /** Buy & hold over the same window, without costs */
  benchmark: ReturnMetricsDto;
  /** CAGR minus benchmark CAGR */
  alpha: number | null;
  dataQuality: DataQualityDto;
}

export class SizingViewDto {
  type: PositionSizing['type'];
  fraction?: number;
  riskPct?: number;
}

export class ExecutionViewDto {
  feeBps: number;
  slippageBps: number;
  minFee: number;
  sizing: SizingViewDto;
  riskFreeRate: number;
  /** Roll-adjusted prices (missing on older runs) */
  adjustRolls?: boolean;
  /** Earnings filter, when used */
  earnings?: EarningsRuleDto;
  /** Annual short borrow cost in percent, when set */
  borrowPct?: number;
  /** short or both; missing means long */
  @ApiPropertyOptional({ enum: ['short', 'both'] })
  direction?: TradeDirection;
}

export class WalkForwardSummaryDto {
  /** Out-of-sample CAGR / mean in-sample CAGR; null when in-sample CAGR is not positive */
  efficiency: number | null;
  meanTrainCagr: number | null;
  /** Share of test segments with a positive return */
  profitableWindows: number;
  /** Different parameter sets selected across windows (1 = stable) */
  distinctParams: number;
}

export class WalkForwardInfoDto {
  /** Window index; null on the joined out-of-sample run */
  window: number | null;
  windows: number;
  trainRatio: number;
  anchored: boolean;
  @ApiProperty({ enum: WALK_FORWARD_METRICS })
  metric: WalkForwardMetric;
  combinations: number;
  trainFrom: string;
  testFrom: string;
  testTo: string;
  /** Joined out-of-sample run only */
  summary?: WalkForwardSummaryDto;
}

export class BacktestRunDto {
  id: string;
  batchId: string;
  source: BacktestSource;
  symbol: string;
  assetId: string;
  strategyCode: string;
  strategyVersion: number;
  strategyConfigId: string | null;
  configName: string | null;
  params: Record<string, unknown>;
  timeframe: string;
  periodFrom: Date | null;
  periodTo: Date | null;
  segment: BacktestSegment;
  /** Decimal string */
  initialCapital: string;
  execution: ExecutionViewDto;
  status: BacktestStatus;
  metrics: BacktestMetricsDto | null;
  /** Walk-forward runs only */
  walkForward: WalkForwardInfoDto | null;
  error: string | null;
  createdAt: Date;
  startedAt: Date | null;
  finishedAt: Date | null;
}

// The CLI plugin cannot describe a nullable nested array.
const CURVE_SCHEMA = {
  type: 'array',
  items: { type: 'array', items: { type: 'number' } },
  nullable: true,
} as const;

export class BacktestRunDetailDto extends BacktestRunDto {
  /** [[epochMs, equity], ...] at most 1000 points; null for sweep train runs */
  @ApiProperty(CURVE_SCHEMA)
  equityCurve: number[][] | null;

  /** Buy & hold on the same time points */
  @ApiProperty(CURVE_SCHEMA)
  benchmarkCurve: number[][] | null;
}

export class BatchDto {
  batchId: string;
  total: number;
  pending: number;
  running: number;
  success: number;
  failed: number;
  runs: BacktestRunDto[];
}

export class BacktestTradeDto {
  id: string;
  runId: string;
  entryTime: Date;
  entryPrice: number;
  exitTime: Date;
  exitPrice: number;
  /** Decimal string */
  quantity: string;
  /** Decimal string, entry + exit */
  fees: string;
  /** Decimal string, net of fees */
  pnl: string;
  returnPct: number;
  @ApiProperty({ enum: ['long', 'short'] })
  side: PositionSide;
  @ApiProperty({
    enum: ['signal', 'stop_loss', 'take_profit', 'end_of_data', 'manual', 'earnings'],
  })
  exitReason: ExitReason;
  barsHeld: number;
}

export class MonteCarloQueryDto {
  /** Resamples. Default 1000. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(10_000)
  @ApiPropertyOptional({ default: 1000 })
  samples: number = 1000;

  /** Random seed; the same seed gives the same result. Default 1. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @ApiPropertyOptional({ default: 1 })
  seed: number = 1;
}

export class PercentilesDto {
  p5: number;
  p50: number;
  p95: number;
}

export class MonteCarloActualDto {
  totalReturn: number;
  /** Measured on equity after each trade, like the simulated drawdowns */
  maxDrawdown: number;
}

export class MonteCarloDto {
  samples: number;
  trades: number;
  actual: MonteCarloActualDto;
  /** Bootstrap (trades drawn with replacement) */
  totalReturn: PercentilesDto;
  maxDrawdown: PercentilesDto;
  /** Share of bootstrap samples ending below the starting capital */
  lossProbability: number;
  /** Same trades in random order */
  shuffledMaxDrawdown: PercentilesDto;
}
