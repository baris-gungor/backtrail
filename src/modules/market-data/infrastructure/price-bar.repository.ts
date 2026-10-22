import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, FindOptionsWhere, LessThanOrEqual, MoreThanOrEqual, Repository } from 'typeorm';
import { Bar, Timeframe } from '../domain/bar';
import { PriceBarEntity } from './price-bar.entity';

const UPSERT_CHUNK = 500;

export interface BarRange {
  from?: Date;
  to?: Date;
  completeOnly?: boolean;
}

@Injectable()
export class PriceBarRepository {
  constructor(
    @InjectRepository(PriceBarEntity) private readonly bars: Repository<PriceBarEntity>,
  ) {}

  async upsert(assetId: string, timeframe: Timeframe, bars: Bar[]): Promise<number> {
    for (let i = 0; i < bars.length; i += UPSERT_CHUNK) {
      const rows = bars.slice(i, i + UPSERT_CHUNK).map((bar) => ({ ...bar, assetId, timeframe }));
      await this.bars.upsert(rows, {
        conflictPaths: ['assetId', 'timeframe', 'openTime'],
        skipUpdateIfNoValuesChanged: true,
      });
    }
    return bars.length;
  }

  async latestOpenTime(assetId: string, timeframe: Timeframe): Promise<Date | null> {
    const latest = await this.bars.findOne({
      select: { openTime: true },
      where: { assetId, timeframe },
      order: { openTime: 'DESC' },
    });
    return latest?.openTime ?? null;
  }

  async earliestOpenTime(assetId: string, timeframe: Timeframe): Promise<Date | null> {
    const earliest = await this.bars.findOne({
      select: { openTime: true },
      where: { assetId, timeframe },
      order: { openTime: 'ASC' },
    });
    return earliest?.openTime ?? null;
  }

  async findAscending(assetId: string, timeframe: Timeframe, range: BarRange): Promise<Bar[]> {
    const rows = await this.bars.find({
      where: this.where(assetId, timeframe, range),
      order: { openTime: 'ASC' },
    });
    return rows.map(toBar);
  }

  /** Most recent `limit` bars within the range, returned in ascending order. */
  async findLatest(
    assetId: string,
    timeframe: Timeframe,
    range: BarRange,
    limit: number,
  ): Promise<Bar[]> {
    const rows = await this.bars.find({
      where: this.where(assetId, timeframe, range),
      order: { openTime: 'DESC' },
      take: limit,
    });
    return rows.reverse().map(toBar);
  }

  private where(
    assetId: string,
    timeframe: Timeframe,
    { from, to, completeOnly }: BarRange,
  ): FindOptionsWhere<PriceBarEntity> {
    // TypeORM 1.x rejects undefined values in `where`, so set openTime only when bounded.
    const where: FindOptionsWhere<PriceBarEntity> = { assetId, timeframe };
    if (from && to) where.openTime = Between(from, to);
    else if (from) where.openTime = MoreThanOrEqual(from);
    else if (to) where.openTime = LessThanOrEqual(to);
    if (completeOnly) where.isComplete = true;
    return where;
  }
}

function toBar(row: PriceBarEntity): Bar {
  return {
    openTime: row.openTime,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    isComplete: row.isComplete,
  };
}
