import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetsService } from '../../assets/application/assets.service';
import { Bar, Timeframe } from '../domain/bar';
import { IngestionRunEntity } from '../infrastructure/ingestion-run.entity';
import { PriceBarRepository } from '../infrastructure/price-bar.repository';

export interface BarsQuery {
  symbol: string;
  timeframe: Timeframe;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface BarSeries {
  symbol: string;
  timeframe: Timeframe;
  bars: Bar[];
}

/**
 * Read API of the market-data module. Analysis and backtesting will consume price data through this.
 */
@Injectable()
export class MarketDataQueryService {
  constructor(
    private readonly assets: AssetsService,
    private readonly bars: PriceBarRepository,
    @InjectRepository(IngestionRunEntity) private readonly runs: Repository<IngestionRunEntity>,
  ) {}

  async getBars(query: BarsQuery): Promise<BarSeries> {
    const asset = await this.assets.findBySymbol(query.symbol);
    const bars = await this.bars.findLatest(
      asset.id,
      query.timeframe,
      { from: query.from, to: query.to },
      query.limit,
    );
    return { symbol: asset.symbol, timeframe: query.timeframe, bars };
  }

  /** Full ascending history of one asset. Analysis uses `completeOnly` so open bars never produce signals. */
  getHistory(
    assetId: string,
    timeframe: Timeframe,
    options: { completeOnly?: boolean } = {},
  ): Promise<Bar[]> {
    return this.bars.findAscending(assetId, timeframe, { completeOnly: options.completeOnly });
  }

  /** The latest stored bar, or null when there is none. */
  async latestBar(
    assetId: string,
    timeframe: Timeframe,
    options: { completeOnly?: boolean } = {},
  ): Promise<Bar | null> {
    const [bar] = await this.bars.findLatest(
      assetId,
      timeframe,
      { completeOnly: options.completeOnly },
      1,
    );
    return bar ?? null;
  }

  async getIngestionRuns(assetId: string, limit: number): Promise<IngestionRunEntity[]> {
    await this.assets.findById(assetId);
    return this.runs.find({ where: { assetId }, order: { startedAt: 'DESC' }, take: limit });
  }
}
