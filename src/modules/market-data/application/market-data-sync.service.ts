import { Inject, Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { LessThanOrEqual, Repository } from 'typeorm';
import { marketDataConfig } from '../../../config';
import { UpstreamError } from '../../../common/errors/domain.error';
import { AssetsService } from '../../assets/application/assets.service';
import { aggregateToFourHour, normalizeHourlyBars } from '../domain/aggregation';
import { MARKET_DATA_PROVIDER, type MarketDataProvider } from '../domain/market-data-provider.port';
import { MARKET_DATA_SYNCED, MarketDataSyncedEvent } from '../domain/market-data.events';
import { fourHourBucket } from '../domain/session';
import { IngestionRunEntity, IngestionStatus } from '../infrastructure/ingestion-run.entity';
import { PriceBarRepository } from '../infrastructure/price-bar.repository';
import { EarningsService } from './earnings.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const BACKFILL_SLACK_DAYS = 5;

export interface SyncAllResult {
  total: number;
  succeeded: number;
  failed: number;
}

/**
 * Fetches 1h bars from the provider, stores them, and rebuilds the affected 4h bars.
 * The first sync, or the first after `historyDays` was raised, backfills `historyDays`; later
 * syncs continue from the latest stored 1h bar.
 */
@Injectable()
export class MarketDataSyncService implements OnApplicationShutdown {
  private readonly logger = new Logger(MarketDataSyncService.name);
  /** One sync per asset at a time; concurrent callers share the running promise. */
  private readonly inFlight = new Map<string, Promise<IngestionRunEntity>>();

  constructor(
    private readonly assets: AssetsService,
    private readonly bars: PriceBarRepository,
    @InjectRepository(IngestionRunEntity) private readonly runs: Repository<IngestionRunEntity>,
    @Inject(MARKET_DATA_PROVIDER) private readonly provider: MarketDataProvider,
    @Inject(marketDataConfig.KEY) private readonly config: ConfigType<typeof marketDataConfig>,
    private readonly events: EventEmitter2,
    private readonly earnings: EarningsService,
  ) {}

  syncAsset(assetId: string): Promise<IngestionRunEntity> {
    const running = this.inFlight.get(assetId);
    if (running) return running;

    const task = this.runSync(assetId).finally(() => this.inFlight.delete(assetId));
    this.inFlight.set(assetId, task);
    return task;
  }

  /** Resolves when no sync is running. */
  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  /** Lets running syncs finish their DB writes before the connection closes. */
  onApplicationShutdown(): Promise<void> {
    return this.whenIdle();
  }

  /** Syncs all active assets one after another. One failure does not stop the rest. */
  async syncAll(): Promise<SyncAllResult> {
    const assets = await this.assets.findAll({ isActive: true });
    let succeeded = 0;
    for (const asset of assets) {
      try {
        const run = await this.syncAsset(asset.id);
        if (run.status === IngestionStatus.Success) succeeded++;
      } catch (error) {
        // The provider errors are recorded on the run; this is the DB or a deleted asset.
        this.logger.error({ msg: `${asset.symbol} sync failed`, symbol: asset.symbol, err: error });
      }
    }
    const result = { total: assets.length, succeeded, failed: assets.length - succeeded };
    this.logger.log({ msg: 'Sync of active assets finished', ...result });
    return result;
  }

  /**
   * Continues from the latest stored 1h bar, so a previously incomplete bar gets its final values.
   * Starts at `now - historyDays` instead when there are no bars yet, or when the configured depth
   * was raised and no successful run has covered it.
   */
  private async syncStart(assetId: string, now: Date): Promise<Date> {
    const target = new Date(now.getTime() - this.config.historyDays * DAY_MS);
    const latest = await this.bars.latestOpenTime(assetId, '1h');
    if (!latest) return target;

    const earliest = await this.bars.earliestOpenTime(assetId, '1h');
    // Weekends and holidays leave a few days without bars at the start of the range.
    if (earliest && earliest.getTime() <= target.getTime() + BACKFILL_SLACK_DAYS * DAY_MS) {
      return latest;
    }
    // A run that already asked for this depth means the provider has no older data.
    const covered = await this.runs.exists({
      where: {
        assetId,
        status: IngestionStatus.Success,
        rangeFrom: LessThanOrEqual(new Date(target.getTime() + DAY_MS)),
      },
    });
    return covered ? latest : target;
  }

  private async runSync(assetId: string): Promise<IngestionRunEntity> {
    const asset = await this.assets.findById(assetId);
    const now = new Date();
    const from = await this.syncStart(asset.id, now);

    const run = await this.runs.save(
      this.runs.create({
        assetId: asset.id,
        provider: this.provider.name,
        status: IngestionStatus.Running,
        rangeFrom: from,
        rangeTo: now,
        startedAt: now,
      }),
    );

    try {
      const raw = await this.provider.fetchHourlyBars(asset.symbol, from, now);
      const hourly = normalizeHourlyBars(raw, asset.sessionType, now);
      run.hourlyBarsUpserted = await this.bars.upsert(asset.id, '1h', hourly);

      if (hourly.length > 0) {
        // Rebuild every 4h bucket touched by the new 1h bars from stored 1h data.
        const bucketStart = fourHourBucket(hourly[0].openTime, asset.sessionType).start;
        const stored = await this.bars.findAscending(asset.id, '1h', { from: bucketStart });
        const fourHour = aggregateToFourHour(stored, asset.sessionType, now);
        run.fourHourBarsUpserted = await this.bars.upsert(asset.id, '4h', fourHour);
      }

      run.status = IngestionStatus.Success;
      await this.assets.markSynced(asset.id, now);
      this.logger.debug({
        msg: `${asset.symbol} synced`,
        symbol: asset.symbol,
        from: from.toISOString(),
        bars1h: run.hourlyBarsUpserted,
        bars4h: run.fourHourBarsUpserted,
        ms: Date.now() - now.getTime(),
      });
    } catch (error) {
      run.status = IngestionStatus.Failed;
      run.error = error instanceof Error ? error.message : String(error);
      // Provider outages are expected now and then: one line with the cause, no stack trace.
      this.logger.error(
        error instanceof UpstreamError
          ? {
              msg: `${asset.symbol} sync failed: ${run.error}`,
              symbol: asset.symbol,
              cause: String(error.cause),
            }
          : { msg: `${asset.symbol} sync failed`, symbol: asset.symbol, err: error },
      );
    }

    run.finishedAt = new Date();
    const saved = await this.runs.save(run);
    if (saved.status === IngestionStatus.Success) {
      // Before the event: paper trading reacts to it and reads the earnings filter's reports.
      await this.earnings.refreshIfStale(asset);
      this.events.emit(MARKET_DATA_SYNCED, new MarketDataSyncedEvent(asset.id, asset.symbol));
    }
    return saved;
  }
}
