import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsOptional, IsString, Length, Matches, ValidateIf } from 'class-validator';
import { AssetClass } from '../domain/asset.types';

export class CreateAssetDto {
  /** Provider symbol, e.g. AAPL, SPY, GC=F, CL=F */
  @IsString()
  @Length(1, 32)
  @Matches(/^[A-Za-z0-9.^=-]+$/, { message: 'symbol contains invalid characters' })
  symbol: string;
}

export class UpdateAssetDto {
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  /** Futures symbol this asset (an ETF) stands in for, e.g. GC=F for GLD; null removes the link. */
  @IsOptional()
  @ValidateIf((_o, v) => v !== null)
  @IsString()
  @ApiPropertyOptional({ type: String, nullable: true })
  proxyFor?: string | null;
}

export class ListAssetsQuery {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    value === 'true' ? true : value === 'false' ? false : value,
  )
  @IsBoolean()
  isActive?: boolean;
}

export class SearchAssetsQuery {
  /** Name or ticker fragment, e.g. "apple", "AAPL", "gold" */
  @IsString()
  @Length(1, 64)
  q: string;
}

export class AssetSuggestionDto {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  /** Exchange display name, e.g. NasdaqGS */
  exchange: string | null;
  /** Already registered for tracking */
  tracked: boolean;
}

export class CommodityProxyDto {
  /** Futures symbol, e.g. GC=F */
  futures: string;
  /** ETF that tracks it, e.g. GLD */
  etf: string;
  /** Turkish commodity name */
  name: string;
}
