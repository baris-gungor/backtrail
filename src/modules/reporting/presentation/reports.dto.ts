import {
  ApiExtraModels,
  ApiProperty,
  ApiPropertyOptional,
  getSchemaPath,
  OmitType,
} from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsDate,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';
import { BacktestMetricsDto } from '../../backtesting/presentation/backtests.dto';
import {
  MATRIX_METRICS,
  type MatrixMetric,
  type ReportSource,
} from '../application/report.service';

const SOURCES: ReportSource[] = ['backtest', 'paper'];

// Requests

export class MatrixQueryDto {
  @IsOptional()
  @IsIn(SOURCES)
  @ApiPropertyOptional({ default: 'backtest', enum: SOURCES })
  source: ReportSource = 'backtest';

  /** Backtest: run metrics. Paper: totalPnl, winRate, profitFactor, expectancy, avgReturn, trades. */
  @IsOptional()
  @IsIn(MATRIX_METRICS)
  @ApiPropertyOptional({ default: 'sharpe', enum: MATRIX_METRICS })
  metric: MatrixMetric = 'sharpe';

  /** Backtest only. train / test include sweep runs. */
  @IsOptional()
  @IsIn(['full', 'train', 'test'])
  @ApiPropertyOptional({ default: 'full', enum: ['full', 'train', 'test'] })
  segment: string = 'full';
}

export class SourceRangeQueryDto {
  @IsOptional()
  @IsIn(SOURCES)
  @ApiPropertyOptional({ default: 'backtest', enum: SOURCES })
  source: ReportSource = 'backtest';

  /** Trades exiting at or after */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}

export class AssetReportQueryDto {
  /** Signal statistics horizon in 4h bars */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  @ApiPropertyOptional({ default: 6 })
  horizon: number = 6;
}

export class TradesQueryDto {
  /** Default: both */
  @IsOptional()
  @IsIn(SOURCES)
  @ApiPropertyOptional({ enum: SOURCES })
  source?: ReportSource;

  /** Strategy code */
  @IsOptional()
  @IsString()
  strategy?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  /** Paper trades of one portfolio */
  @IsOptional()
  @IsUUID()
  portfolioId?: string;

  /** Trades of one backtest run (default: the latest full runs) */
  @IsOptional()
  @IsUUID()
  runId?: string;

  /** Exit time from */
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10_000)
  @ApiPropertyOptional({ default: 500 })
  limit: number = 500;

  @IsOptional()
  @IsIn(['json', 'csv'])
  @ApiPropertyOptional({ default: 'json', enum: ['json', 'csv'] })
  format: 'json' | 'csv' = 'json';
}

export class DivergenceQueryDto {
  @IsUUID()
  portfolioId: string;
}

export class SignalQualityQueryDto {
  /** Strategy code */
  @IsOptional()
  @IsString()
  strategy?: string;

  @IsOptional()
  @IsString()
  symbol?: string;

  /** Comma-separated horizons in 4h bars. Default 1,3,6,12 */
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').map(Number) : value,
  )
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(200, { each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(8)
  @ApiPropertyOptional({ type: String, example: '1,3,6,12' })
  horizons?: number[];
}

// Responses

/** Run metrics (Phase 3) without the data quality report. */
export class PerformanceMetricsDto extends OmitType(BacktestMetricsDto, ['dataQuality'] as const) {}

export class MatrixCellDto {
  value: number | null;
  trades: number;
  runId: string | null;
  lowSample: boolean;
}

export class MatrixAssetDto {
  assetId: string;
  symbol: string;
}

@ApiExtraModels(MatrixCellDto)
export class MatrixRowDto {
  /** code/config, or `benchmark` */
  key: string;
  strategyCode: string;
  configName: string;
  /** Cost-free buy & hold of each run's window */
  isBenchmark: boolean;
  /** One per asset, in `assets` order; null without data */
  @ApiProperty({
    type: 'array',
    items: { nullable: true, allOf: [{ $ref: getSchemaPath(MatrixCellDto) }] },
  })
  cells: (MatrixCellDto | null)[];
}

export class MatrixReportDto {
  source: string;
  metric: string;
  segment: string;
  assets: MatrixAssetDto[];
  rows: MatrixRowDto[];
}

export class TradeStatsDto {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Decimal string */
  totalPnl: string;
  avgReturn: number | null;
  profitFactor: number | null;
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  avgHoldingHours: number | null;
}

export class TradeRecordDto {
  source: string;
  id: string;
  runId: string | null;
  portfolioId: string | null;
  subscriptionId: string | null;
  strategyCode: string | null;
  configName: string | null;
  symbol: string;
  assetId: string;
  entryTime: Date;
  entryPrice: number;
  exitTime: Date;
  exitPrice: number;
  quantity: string;
  fees: string;
  pnl: string;
  returnPct: number;
  exitReason: string;
  barsHeld: number | null;
}

export class StrategyAssetBreakdownDto {
  assetId: string;
  symbol: string;
  stats: TradeStatsDto;
  metrics: PerformanceMetricsDto | null;
  runId: string | null;
}

export class StrategyReportDto {
  strategyCode: string;
  source: string;
  summary: TradeStatsDto;
  assets: StrategyAssetBreakdownDto[];
  best: TradeRecordDto[];
  worst: TradeRecordDto[];
}

export class DistributionDto {
  count: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Up after BUY, down after SELL */
  hitRate: number | null;
}

export class SignalStatsDto {
  buys: number;
  sells: number;
  horizon: number;
  buy: DistributionDto;
  sell: DistributionDto;
}

export class AssetStrategyRowDto {
  key: string;
  strategyCode: string;
  configName: string;
  runId: string | null;
  metrics: PerformanceMetricsDto | null;
  paper: TradeStatsDto | null;
  signals: SignalStatsDto | null;
}

export class CorrelationDto {
  keys: string[];
  @ApiProperty({
    type: 'array',
    items: { type: 'array', items: { type: 'number', nullable: true } },
  })
  matrix: (number | null)[][];
}

export class AssetReportDto {
  assetId: string;
  symbol: string;
  strategies: AssetStrategyRowDto[];
  /** Equity return correlation of the latest full runs and buy & hold */
  correlation: CorrelationDto;
}

export class EquityPointReportDto {
  time: Date;
  equity: number;
}

export class RollingPointDto {
  time: Date;
  value: number | null;
}

export class PeriodReturnDto {
  /** 2026-03 or 2026 */
  period: string;
  return: number;
}

export class UnderwaterPeriodDto {
  days: number;
  from: Date | null;
  to: Date | null;
  recovered: boolean;
}

export class ExtraMetricsDto {
  /** RMS drawdown, fraction */
  ulcerIndex: number;
  longestDrawdown: UnderwaterPeriodDto;
  maxDrawdown: number;
  monthly: PeriodReturnDto[];
  yearly: PeriodReturnDto[];
  maxWinStreak: number;
  maxLossStreak: number;
}

export class OpenRiskPositionDto {
  symbol: string;
  quantity: string;
  lastPrice: number;
  stopLoss: number | null;
  /** Loss down to the stop, decimal string; null without a stop */
  riskToStop: string | null;
}

export class OpenRiskDto {
  toStops: string;
  unprotected: string;
  positions: OpenRiskPositionDto[];
}

export class ContributionDto {
  subscriptionId: string | null;
  label: string;
  strategyCode: string | null;
  trades: number;
  realizedPnl: string;
  unrealizedPnl: string;
}

export class PortfolioReportDto {
  portfolioId: string;
  name: string;
  /** Snapshots */
  equity: EquityPointReportDto[];
  /** Drawdown from the running peak (0..1) in `equity` */
  drawdown: EquityPointReportDto[];
  /** Phase 3 run metrics on the daily equity series */
  metrics: PerformanceMetricsDto;
  extra: ExtraMetricsDto;
  /** 30-day rolling Sharpe on daily equity */
  rollingSharpe: RollingPointDto[];
  openRisk: OpenRiskDto;
  contributions: ContributionDto[];
}

export class DivergenceRowDto {
  subscriptionId: string;
  symbol: string;
  strategyCode: string;
  configName: string;
  source: string;
  from: Date | null;
  to: Date | null;
  paper: TradeStatsDto;
  backtest: TradeStatsDto;
  /** Paper minus backtest total PnL, decimal string */
  pnlDiff: string;
  matched: number;
  /** Entry times of trades only on one side */
  onlyPaper: Date[];
  onlyBacktest: Date[];
}

export class SignalQualityRowDto {
  strategyCode: string;
  configName: string;
  side: string;
  /** One per horizon */
  byHorizon: DistributionDto[];
}

export class SignalQualityReportDto {
  horizons: number[];
  rows: SignalQualityRowDto[];
}

export class BacktestExtrasDto {
  runId: string;
  extra: ExtraMetricsDto;
  rollingSharpe: RollingPointDto[];
}
