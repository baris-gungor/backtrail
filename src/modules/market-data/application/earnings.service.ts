import { Inject, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { MoreThan, Repository } from 'typeorm';
import { AssetClass } from '../../assets/domain/asset.types';
import type { AssetEntity } from '../../assets/infrastructure/asset.entity';
import { EARNINGS_PROVIDER, type EarningsProvider } from '../domain/earnings-provider.port';
import { EarningsEventEntity } from '../infrastructure/earnings-event.entity';

/** Reports change rarely; one refresh per asset per day is enough. */
const REFRESH_MS = 24 * 60 * 60 * 1000;

/** Earnings report times of equities. Other modules read them through here. */
@Injectable()
export class EarningsService {
  private readonly logger = new Logger(EarningsService.name);
  /** Last refresh per asset in this process; a restart refreshes once more. */
  private readonly refreshed = new Map<string, number>();

  constructor(
    @InjectRepository(EarningsEventEntity)
    private readonly events: Repository<EarningsEventEntity>,
    @Inject(EARNINGS_PROVIDER) private readonly provider: EarningsProvider,
  ) {}

  /** Only companies report earnings; ETFs, futures and indexes have none. */
  static applies(asset: Pick<AssetEntity, 'assetClass'>): boolean {
    return asset.assetClass === AssetClass.Equity;
  }

  /**
   * Fetches and stores the asset's reports unless done in the last day. Never throws: earnings are
   * an addition to market data, a failed refresh is logged and the stored reports are kept.
   */
  async refreshIfStale(asset: AssetEntity, now = Date.now()): Promise<void> {
    if (!EarningsService.applies(asset)) return;
    const last = this.refreshed.get(asset.id);
    if (last !== undefined && now - last < REFRESH_MS) return;
    try {
      const reports = await this.provider.fetchReports(asset.symbol);
      // An upcoming date can move; it is replaced, filed reports are kept.
      await this.events.delete({ assetId: asset.id, reportedAt: MoreThan(new Date(now)) });
      if (reports.length) {
        await this.events
          .createQueryBuilder()
          .insert()
          .values(reports.map((r) => ({ assetId: asset.id, ...r })))
          .orIgnore()
          .execute();
      }
      this.refreshed.set(asset.id, now);
      this.logger.debug({
        msg: `${asset.symbol}: ${reports.length} earnings reports`,
        symbol: asset.symbol,
      });
    } catch (error) {
      this.logger.warn({
        msg: `Earnings refresh for ${asset.symbol} failed`,
        symbol: asset.symbol,
        err: error,
      });
    }
  }

  /** Stored report times, oldest first. */
  async reports(assetId: string): Promise<Date[]> {
    const rows = await this.events.find({
      select: { reportedAt: true },
      where: { assetId },
      order: { reportedAt: 'ASC' },
    });
    return rows.map((r) => r.reportedAt);
  }
}
