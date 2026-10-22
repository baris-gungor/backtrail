import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsDate, IsIn, IsInt, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';
import type { Timeframe } from '../domain/bar';

const TIMEFRAMES: Timeframe[] = ['1h', '4h'];

export class GetBarsQuery {
  @IsString()
  symbol: string;

  @IsOptional()
  @IsIn(TIMEFRAMES)
  timeframe: Timeframe = '4h';

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
  @Max(5000)
  @ApiPropertyOptional({ default: 500 })
  limit: number = 500;
}

export class GetIngestionRunsQuery {
  @IsUUID()
  assetId: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  @ApiPropertyOptional({ default: 20 })
  limit: number = 20;
}

export class GetEarningsQuery {
  /** e.g. AAPL */
  @IsString()
  symbol: string;
}

// Responses

export class EarningsDto {
  symbol: string;
  /** False for ETFs, futures and indexes: they have no earnings reports */
  applies: boolean;
  /** Report times (SEC 8-K item 2.02 acceptance, upcoming from Yahoo), oldest first */
  reports: Date[];
  /** Next upcoming report, if known */
  next: Date | null;
}

export class BarDto {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  /** False while the bar period has not ended; refreshed on the next sync */
  isComplete: boolean;
}

export class BarSeriesDto {
  symbol: string;
  timeframe: Timeframe;
  /** Ascending by openTime */
  bars: BarDto[];
}

export class SyncAcceptedDto {
  status: 'accepted';
}
