import { Injectable, Logger, OnApplicationShutdown } from '@nestjs/common';
import { EventEmitter2, OnEvent } from '@nestjs/event-emitter';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Not, Repository } from 'typeorm';
import { AssetsService } from '../../assets/application/assets.service';
import { NotificationService } from '../../notifications/application/notification.service';
import { type SignalNote } from '../../notifications/domain/messages';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import type { Timeframe } from '../../market-data/domain/bar';
import {
  MARKET_DATA_SYNCED,
  MarketDataSyncedEvent,
} from '../../market-data/domain/market-data.events';
import {
  ANALYSIS_COMPLETED,
  AnalysisCompletedEvent,
  SIGNALS_GENERATED,
  SignalsGeneratedEvent,
} from '../domain/analysis.events';
import { SignalEntity } from '../infrastructure/signal.entity';
import { StrategyCatalogService } from './strategy-catalog.service';

/** Signals are generated on 4h bars only. */
export const SIGNAL_TIMEFRAME: Timeframe = '4h';

export interface GenerationResult {
  assetId: string;
  inserted: number;
  /** Strategy configs whose generation failed (logged). */
  failed: number;
}

/**
 * Evaluates every active strategy config over the closed 4h history of an asset and stores
 * the signals. Idempotent: strategies are deterministic and (asset, config, timeframe, bar)
 * is unique, so re-running only inserts signals for new bars.
 */
@Injectable()
export class SignalGenerationService implements OnApplicationShutdown {
  private readonly logger = new Logger(SignalGenerationService.name);
  private readonly inFlight = new Map<string, Promise<GenerationResult>>();

  constructor(
    @InjectRepository(SignalEntity) private readonly signals: Repository<SignalEntity>,
    private readonly catalog: StrategyCatalogService,
    private readonly marketData: MarketDataQueryService,
    private readonly assets: AssetsService,
    private readonly events: EventEmitter2,
    private readonly notifications: NotificationService,
  ) {}

  @OnEvent(MARKET_DATA_SYNCED, { async: true })
  async onSynced(event: MarketDataSyncedEvent): Promise<void> {
    try {
      await this.generateForAsset(event.assetId);
    } catch (error) {
      this.logger.error({
        msg: `Signal generation for ${event.symbol} failed`,
        symbol: event.symbol,
        err: error,
      });
    }
  }

  /** `notify: false` skips the Telegram message (rebuilds re-create signals that are not news). */
  generateForAsset(assetId: string, notify = true): Promise<GenerationResult> {
    const running = this.inFlight.get(assetId);
    if (running) return running;
    const task = this.generate(assetId, notify).finally(() => this.inFlight.delete(assetId));
    this.inFlight.set(assetId, task);
    return task;
  }

  /** Deletes stored signals (optionally for one asset / strategy) and generates them again. */
  async rebuild(filter: { symbol?: string; strategy?: string }): Promise<GenerationResult[]> {
    const assets = filter.symbol
      ? [await this.assets.findBySymbol(filter.symbol)]
      : await this.assets.findAll({ isActive: true });
    const configIds = filter.strategy
      ? (await this.catalog.activeConfigs())
          .filter((c) => c.strategy.code === this.catalog.definition(filter.strategy!).code)
          .map((c) => c.config.id)
      : undefined;

    const results: GenerationResult[] = [];
    for (const asset of assets) {
      await this.whenIdle();
      await this.signals.delete({
        assetId: asset.id,
        ...(configIds ? { strategyConfigId: In(configIds) } : {}),
      });
      results.push(await this.generateForAsset(asset.id, false));
    }
    return results;
  }

  async whenIdle(): Promise<void> {
    while (this.inFlight.size > 0) {
      await Promise.allSettled([...this.inFlight.values()]);
    }
  }

  onApplicationShutdown(): Promise<void> {
    return this.whenIdle();
  }

  private async generate(assetId: string, notify: boolean): Promise<GenerationResult> {
    const bars = await this.marketData.getHistory(assetId, SIGNAL_TIMEFRAME, {
      completeOnly: true,
    });
    const configs = await this.catalog.activeConfigs();
    const insertedIds: string[] = [];
    const byStrategy: Record<string, number> = {};
    // Only signals on the latest closed bar are news; backfilled history is not notified.
    const latestBar = bars.at(-1)?.openTime.getTime();
    const fresh: SignalNote[] = [];

    let failed = 0;
    for (const { config, strategy } of configs) {
      // One broken config (bad params, a strategy bug) must not stop the others or the
      // analysis.completed event that paper trading waits for.
      try {
        // Signals from an older strategy version are replaced.
        await this.signals.delete({
          assetId,
          strategyConfigId: config.id,
          strategyVersion: Not(strategy.version),
        });

        const generated = strategy.evaluate(bars, config.params);
        if (generated.length === 0) continue;

        const result = await this.signals
          .createQueryBuilder()
          .insert()
          .values(
            generated.map((s) => ({
              assetId,
              strategyConfigId: config.id,
              timeframe: SIGNAL_TIMEFRAME,
              barTime: s.barTime,
              side: s.side,
              strength: s.strength,
              price: s.price,
              stopLoss: s.stopLoss ?? null,
              takeProfit: s.takeProfit ?? null,
              reason: s.reason,
              indicators: s.indicators,
              strategyVersion: strategy.version,
            })),
          )
          .orIgnore()
          .returning(['id', 'barTime'])
          .execute();
        const rows = result.raw as { id: string; bar_time: Date }[];
        const ids = rows.map((r) => r.id);
        const latest = rows.some((r) => new Date(r.bar_time).getTime() === latestBar)
          ? generated.find((g) => g.barTime.getTime() === latestBar)
          : undefined;
        if (latest) {
          fresh.push({
            side: latest.side,
            strategy: strategy.code,
            config: config.name,
            price: latest.price,
          });
        }
        insertedIds.push(...ids);
        if (ids.length > 0) byStrategy[`${strategy.code}/${config.name}`] = ids.length;
      } catch (error) {
        failed++;
        this.logger.error({
          msg: `Signal generation for ${strategy.code}/${config.name} failed`,
          assetId,
          config: `${strategy.code}/${config.name}`,
          err: error,
        });
      }
    }

    if (insertedIds.length > 0) {
      const { symbol } = await this.assets.findById(assetId);
      this.logger.log({
        msg: `${symbol}: ${insertedIds.length} new signals`,
        symbol,
        bars: bars.length,
        byStrategy,
      });
      this.events.emit(SIGNALS_GENERATED, new SignalsGeneratedEvent(assetId, insertedIds));
      if (notify && fresh.length > 0) {
        this.notifications.notify(
          this.notifications.texts.signalsMessage(symbol, new Date(latestBar!), fresh),
        );
      }
    }
    this.events.emit(ANALYSIS_COMPLETED, new AnalysisCompletedEvent(assetId));
    return { assetId, inserted: insertedIds.length, failed };
  }
}
