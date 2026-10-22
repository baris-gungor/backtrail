import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { LessThan, MoreThanOrEqual, Repository } from 'typeorm';
import { MarkPriceService, type MarkPrice } from '../../market-data/application/mark-price.service';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import type { Timeframe } from '../../market-data/domain/bar';
import { PerformanceSnapshotEntity } from '../infrastructure/performance-snapshot.entity';
import { PortfolioEntity } from '../infrastructure/portfolio.entity';
import { PositionEntity } from '../infrastructure/position.entity';

export interface Valuation {
  cash: Decimal;
  positionsValue: Decimal;
  equity: Decimal;
  /** Mark per asset of the open positions: a near-live quote or the latest 1h close (entry price when there is neither). */
  prices: Map<string, number>;
  /** Where each mark came from and when; absent for assets that fell back to the entry price. */
  marks: Map<string, MarkPrice>;
}

const startOfUtcDay = (at: Date) =>
  new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()));

/** Marks portfolios to market and stores performance snapshots. */
@Injectable()
export class PortfolioValuationService {
  private readonly logger = new Logger(PortfolioValuationService.name);

  constructor(
    @InjectRepository(PortfolioEntity) private readonly portfolios: Repository<PortfolioEntity>,
    @InjectRepository(PositionEntity) private readonly positions: Repository<PositionEntity>,
    @InjectRepository(PerformanceSnapshotEntity)
    private readonly snapshots: Repository<PerformanceSnapshotEntity>,
    private readonly marketData: MarketDataQueryService,
    private readonly markPrices: MarkPriceService,
  ) {}

  /** Latest close per asset: any 1h bar for current marks, closed 4h bars for trading decisions. */
  async latestCloses(
    assetIds: Iterable<string>,
    timeframe: Timeframe,
  ): Promise<Map<string, number>> {
    const closes = new Map<string, number>();
    for (const assetId of new Set(assetIds)) {
      const bar = await this.marketData.latestBar(assetId, timeframe, {
        completeOnly: timeframe === '4h',
      });
      if (bar) closes.set(assetId, bar.close);
    }
    return closes;
  }

  async value(portfolio: PortfolioEntity, positions: PositionEntity[]): Promise<Valuation> {
    const marks = await this.markPrices.markPrices(positions.map((p) => p.assetId));
    const prices = new Map([...marks].map(([assetId, mark]) => [assetId, mark.price]));
    let positionsValue = new Decimal(0);
    for (const p of positions) {
      const price = prices.get(p.assetId) ?? Number(p.avgPrice);
      prices.set(p.assetId, price);
      positionsValue = positionsValue.plus(new Decimal(p.quantity).mul(price));
    }
    const cash = new Decimal(portfolio.cashBalance);
    return { cash, positionsValue, equity: cash.plus(positionsValue), prices, marks };
  }

  /**
   * Like `snapshot`, for callers whose main work already succeeded (a fill, an order, a new
   * portfolio): a failed snapshot is logged and the next one fills the gap.
   */
  async trySnapshot(portfolioId: string): Promise<void> {
    try {
      await this.snapshot(portfolioId);
    } catch (error) {
      this.logger.warn({ msg: 'Portfolio snapshot failed', portfolioId, err: error });
    }
  }

  /** Stores the current mark-to-market state. */
  async snapshot(portfolioId: string, at = new Date()): Promise<PerformanceSnapshotEntity> {
    const portfolio = await this.portfolios.findOneByOrFail({ id: portfolioId });
    const positions = await this.positions.findBy({ portfolioId });
    const { cash, positionsValue, equity } = await this.value(portfolio, positions);

    const peakRow = await this.snapshots
      .createQueryBuilder('s')
      .select('MAX(s.equity)', 'peak')
      .where('s.portfolioId = :portfolioId', { portfolioId })
      .getRawOne<{ peak: string | null }>();
    const peak = Decimal.max(peakRow?.peak ?? 0, portfolio.initialCash, equity);
    const drawdown = peak.gt(0) ? new Decimal(1).minus(equity.div(peak)).toNumber() : 0;

    return this.snapshots.save(
      this.snapshots.create({
        portfolioId,
        at,
        equity: equity.toString(),
        cash: cash.toString(),
        positionsValue: positionsValue.toString(),
        drawdown: Math.round(drawdown * 1e6) / 1e6,
      }),
    );
  }

  /**
   * Equity at the start of the UTC day of `at`: the last snapshot before midnight, or the day's first
   * snapshot for a portfolio created that day; null without snapshots.
   */
  async dayStartEquity(portfolioId: string, at = new Date()): Promise<Decimal | null> {
    const midnight = startOfUtcDay(at);
    const row =
      (await this.snapshots.findOne({
        where: { portfolioId, at: LessThan(midnight) },
        order: { at: 'DESC' },
      })) ??
      (await this.snapshots.findOne({
        where: { portfolioId, at: MoreThanOrEqual(midnight) },
        order: { at: 'ASC' },
      }));
    return row ? new Decimal(row.equity) : null;
  }
}
