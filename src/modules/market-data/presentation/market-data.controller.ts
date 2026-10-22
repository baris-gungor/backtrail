import { ApiTags } from '@nestjs/swagger';
import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { AssetsService } from '../../assets/application/assets.service';
import { EarningsService } from '../application/earnings.service';
import { MarketDataQueryService } from '../application/market-data-query.service';
import { MarketDataSyncService } from '../application/market-data-sync.service';
import { IngestionRunEntity } from '../infrastructure/ingestion-run.entity';
import {
  BarSeriesDto,
  EarningsDto,
  GetBarsQuery,
  GetEarningsQuery,
  GetIngestionRunsQuery,
  SyncAcceptedDto,
} from './market-data.dto';

@ApiTags('market-data')
@Controller('market-data')
export class MarketDataController {
  private readonly logger = new Logger(MarketDataController.name);

  constructor(
    private readonly sync: MarketDataSyncService,
    private readonly query: MarketDataQueryService,
    private readonly earnings: EarningsService,
    private readonly assets: AssetsService,
  ) {}

  /** Starts a background sync of all active assets. Track progress through ingestion runs. */
  @Post('sync')
  @HttpCode(HttpStatus.ACCEPTED)
  syncAll(): SyncAcceptedDto {
    this.sync
      .syncAll()
      .catch((error: unknown) =>
        this.logger.error({ msg: 'Sync of active assets failed', err: error }),
      );
    return { status: 'accepted' };
  }

  /** Syncs one asset and waits for the result. */
  @Post('sync/:assetId')
  syncAsset(@Param('assetId', ParseUUIDPipe) assetId: string): Promise<IngestionRunEntity> {
    return this.sync.syncAsset(assetId);
  }

  @Get('bars')
  getBars(@Query() q: GetBarsQuery): Promise<BarSeriesDto> {
    return this.query.getBars(q);
  }

  /** Earnings reports of an equity (used by the earnings filter). */
  @Get('earnings')
  async getEarnings(@Query() q: GetEarningsQuery): Promise<EarningsDto> {
    const asset = await this.assets.findBySymbol(q.symbol);
    const reports = await this.earnings.reports(asset.id);
    const now = Date.now();
    return {
      symbol: asset.symbol,
      applies: EarningsService.applies(asset),
      reports,
      next: reports.find((r) => r.getTime() > now) ?? null,
    };
  }

  @Get('ingestion-runs')
  getIngestionRuns(@Query() q: GetIngestionRunsQuery): Promise<IngestionRunEntity[]> {
    return this.query.getIngestionRuns(q.assetId, q.limit);
  }
}
