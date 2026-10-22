import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsDate,
  IsIn,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';
import type { SignalSide } from '../domain/strategy';
import type { MomentumState, TrendState, VolatilityState } from '../domain/summary';
import { StrategyConfigEntity } from '../infrastructure/strategy-config.entity';

// Requests

export class CreateStrategyConfigDto {
  /** Unique per strategy, e.g. "fast-ema" */
  @IsString()
  @Matches(/^[a-z0-9_-]{1,64}$/, { message: 'name must be 1-64 chars of a-z, 0-9, _ or -' })
  name: string;

  /** Strategy params; missing keys get defaults. See GET /analysis/strategies for the schema. */
  @IsObject()
  params: Record<string, unknown>;
}

export class UpdateStrategyConfigDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Not allowed on the "default" config. Existing signals of the config are deleted. */
  @IsOptional()
  @IsObject()
  params?: Record<string, unknown>;
}

export class ListSignalsQuery {
  @IsOptional()
  @IsString()
  symbol?: string;

  /** Strategy code, e.g. trend_ema_adx */
  @IsOptional()
  @IsString()
  strategy?: string;

  @IsOptional()
  @IsIn(['BUY', 'SELL'])
  side?: SignalSide;

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
  @Max(1000)
  @ApiPropertyOptional({ default: 100 })
  limit: number = 100;
}

export class RebuildSignalsDto {
  /** Only this asset; default: all active assets */
  @IsOptional()
  @IsString()
  symbol?: string;

  /** Only this strategy code; default: all */
  @IsOptional()
  @IsString()
  strategy?: string;
}

export class IndicatorsQuery {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  @ApiPropertyOptional({ default: 200 })
  limit: number = 200;
}

// Responses

export class StrategyDto {
  code: string;
  name: string;
  version: number;
  description: string;
  isBenchmark: boolean;
  /** Has short rules; only these strategies accept direction short / both */
  canShort: boolean;
  defaultParams: Record<string, unknown>;
  /** Joi description of the params */
  paramsSchema: Record<string, unknown>;
  configs: StrategyConfigEntity[];
}

export class SignalDto {
  id: string;
  symbol: string;
  strategy: string;
  configName: string;
  timeframe: string;
  /** openTime of the closed bar that produced the signal; execution is at the next bar's open */
  barTime: Date;
  side: SignalSide;
  strength: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  reason: string;
  indicators: Record<string, number>;
  strategyVersion: number;
}

export class GenerationResultDto {
  assetId: string;
  inserted: number;
  /** Strategy configs whose generation failed; details are in the server log. */
  failed: number;
}

export class TrendSummaryDto {
  state: TrendState;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  /** EMA periods sorted by value, e.g. "20>50>200" */
  emaAlignment: string | null;
  adx: number | null;
  priceVsEma200Pct: number | null;
}

export class MomentumSummaryDto {
  state: MomentumState;
  rsi: number | null;
  macdHistogram: number | null;
}

export class VolatilitySummaryDto {
  state: VolatilityState;
  atr: number | null;
  atrPct: number | null;
  bollingerBandwidth: number | null;
  bandwidthPercentile: number | null;
}

export class LastSignalDto {
  side: SignalSide;
  barTime: Date;
  strength: number;
  price: number;
  stopLoss: number | null;
  reason: string;
}

export class StrategyStateDto {
  code: string;
  configId: string;
  configName: string;
  position: 'long' | 'flat';
  lastSignal: LastSignalDto | null;
}

export class ConsensusDto {
  long: number;
  flat: number;
  /** Strength-weighted share of strategies currently long, 0..1. Informational only. */
  score: number;
}

export class AssetSummaryDto {
  symbol: string;
  /** openTime of the latest closed 4h bar */
  asOf: Date;
  price: number;
  trend: TrendSummaryDto;
  momentum: MomentumSummaryDto;
  volatility: VolatilitySummaryDto;
  strategies: StrategyStateDto[];
  consensus: ConsensusDto;
}

export class IndicatorPointDto {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr14: number | null;
  adx14: number | null;
  supertrend: number | null;
  /** 1 = up, -1 = down */
  supertrendDirection: number | null;
}

export class IndicatorSeriesDto {
  symbol: string;
  timeframe: string;
  points: IndicatorPointDto[];
}
