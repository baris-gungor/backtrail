import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { OnEvent } from '@nestjs/event-emitter';
import { marketDataConfig } from '../../../config';
import { AssetsService } from '../../assets/application/assets.service';
import { ASSET_CREATED, AssetCreatedEvent } from '../../assets/domain/asset.events';
import { isSyncDue } from '../domain/sync-schedule';
import { MarketDataSyncService } from './market-data-sync.service';

/**
 * Automatic sync triggers:
 * - once on application start (all active assets, in the background)
 * - when a new asset is registered (initial backfill)
 * - on a schedule, a few minutes after each asset's 1h bars close (`isSyncDue`). Syncs are
 *   incremental: they continue from the latest stored bar.
 */
@Injectable()
export class MarketDataSyncTriggers implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(MarketDataSyncTriggers.name);
  private timer?: NodeJS.Timeout;
  private stopped = false;

  constructor(
    private readonly sync: MarketDataSyncService,
    private readonly assets: AssetsService,
    @Inject(marketDataConfig.KEY) private readonly config: ConfigType<typeof marketDataConfig>,
  ) {}

  onApplicationBootstrap(): void {
    if (this.config.syncSchedule) {
      this.logger.log({
        msg: 'Scheduled sync on',
        delayMinutes: this.config.syncDelayMinutes,
      });
      this.scheduleNextMinute();
    }
    if (!this.config.syncOnStartup) return;
    this.logger.log('Startup sync started');
    // Not awaited: the app must start serving while the sync runs.
    this.sync
      .syncAll()
      .catch((error: unknown) => this.logger.error({ msg: 'Startup sync failed', err: error }));
  }

  onApplicationShutdown(): void {
    this.stopped = true;
    clearTimeout(this.timer);
  }

  /** Syncs the assets whose bars closed `syncDelayMinutes` ago, one after another. */
  async runSchedule(now: Date): Promise<void> {
    const assets = await this.assets.findAll({ isActive: true });
    const due = assets.filter((a) => isSyncDue(a.sessionType, now, this.config.syncDelayMinutes));
    if (due.length === 0) return;
    this.logger.debug({ msg: 'Scheduled sync started', symbols: due.map((a) => a.symbol) });
    for (const asset of due) {
      try {
        await this.sync.syncAsset(asset.id);
      } catch (error) {
        this.logger.error({
          msg: `Scheduled sync of ${asset.symbol} failed`,
          symbol: asset.symbol,
          err: error,
        });
      }
    }
  }

  /** Checks once a minute, a second after the minute starts. */
  private scheduleNextMinute(): void {
    if (this.stopped) return;
    const delay = 60_000 - (Date.now() % 60_000) + 1_000;
    this.timer = setTimeout(() => {
      this.runSchedule(new Date())
        .catch((error: unknown) => this.logger.error({ msg: 'Scheduled sync failed', err: error }))
        .finally(() => this.scheduleNextMinute());
    }, delay);
  }

  @OnEvent(ASSET_CREATED, { async: true })
  async onAssetCreated(event: AssetCreatedEvent): Promise<void> {
    try {
      await this.sync.syncAsset(event.assetId);
    } catch (error) {
      this.logger.error({
        msg: `Backfill for ${event.symbol} failed`,
        symbol: event.symbol,
        err: error,
      });
    }
  }
}
