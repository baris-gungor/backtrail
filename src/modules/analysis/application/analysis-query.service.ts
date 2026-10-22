import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AssetsService } from '../../assets/application/assets.service';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import { IndicatorPoint, indicatorPanel } from '../domain/indicator-panel';
import type { SignalSide } from '../domain/strategy';
import { AssetSummary, StrategyState, summarize } from '../domain/summary';
import { SignalEntity } from '../infrastructure/signal.entity';
import { SIGNAL_TIMEFRAME } from './signal-generation.service';
import { StrategyCatalogService } from './strategy-catalog.service';

export interface SignalQuery {
  symbol?: string;
  strategy?: string;
  side?: SignalSide;
  from?: Date;
  to?: Date;
  limit: number;
}

export interface SignalView {
  id: string;
  symbol: string;
  strategy: string;
  configName: string;
  timeframe: string;
  barTime: Date;
  side: SignalSide;
  strength: number;
  price: number;
  stopLoss: number | null;
  takeProfit: number | null;
  reason: string;
  indicators: Record<string, number>;
  strategyVersion: number;
}

export interface AssetSummaryView extends AssetSummary {
  symbol: string;
}

export interface IndicatorSeriesView {
  symbol: string;
  timeframe: string;
  points: IndicatorPoint[];
}

@Injectable()
export class AnalysisQueryService {
  constructor(
    @InjectRepository(SignalEntity) private readonly signals: Repository<SignalEntity>,
    private readonly catalog: StrategyCatalogService,
    private readonly assets: AssetsService,
    private readonly marketData: MarketDataQueryService,
  ) {}

  /** Stored signals of one asset and config, ascending by bar time. */
  storedSignals(assetId: string, strategyConfigId: string): Promise<SignalEntity[]> {
    return this.signals.find({
      where: { assetId, strategyConfigId, timeframe: SIGNAL_TIMEFRAME },
      order: { barTime: 'ASC' },
    });
  }

  /** Newest first. */
  async listSignals(q: SignalQuery): Promise<SignalView[]> {
    const qb = this.signals
      .createQueryBuilder('s')
      .innerJoinAndSelect('s.strategyConfig', 'c')
      .innerJoinAndSelect('c.strategy', 'st')
      .orderBy('s.barTime', 'DESC')
      .take(q.limit);

    if (q.symbol) {
      const asset = await this.assets.findBySymbol(q.symbol);
      qb.andWhere('s.assetId = :assetId', { assetId: asset.id });
    }
    if (q.strategy) qb.andWhere('st.code = :code', { code: q.strategy });
    if (q.side) qb.andWhere('s.side = :side', { side: q.side });
    if (q.from) qb.andWhere('s.barTime >= :from', { from: q.from });
    if (q.to) qb.andWhere('s.barTime <= :to', { to: q.to });

    const [rows, symbols] = await Promise.all([qb.getMany(), this.symbolsById()]);
    return rows.map((s) => toView(s, symbols.get(s.assetId) ?? s.assetId));
  }

  async indicators(symbol: string, limit: number): Promise<IndicatorSeriesView> {
    const asset = await this.assets.findBySymbol(symbol);
    const bars = await this.marketData.getHistory(asset.id, SIGNAL_TIMEFRAME, {
      completeOnly: true,
    });
    return {
      symbol: asset.symbol,
      timeframe: SIGNAL_TIMEFRAME,
      points: indicatorPanel(bars, limit),
    };
  }

  /** Returns null when the asset has no closed bars yet. */
  async summary(symbol: string): Promise<AssetSummaryView | null> {
    const asset = await this.assets.findBySymbol(symbol);
    const [bars, states] = await Promise.all([
      this.marketData.getHistory(asset.id, SIGNAL_TIMEFRAME, { completeOnly: true }),
      this.strategyStates(asset.id),
    ]);
    const summary = summarize(bars, states);
    return summary && { symbol: asset.symbol, ...summary };
  }

  /** Current position (from the last signal) of every active non-benchmark strategy config. */
  private async strategyStates(assetId: string): Promise<StrategyState[]> {
    const configs = (await this.catalog.activeConfigs()).filter((c) => !c.strategy.isBenchmark);
    const latest = await this.signals
      .createQueryBuilder('s')
      .distinctOn(['s.strategyConfigId'])
      .where('s.assetId = :assetId', { assetId })
      .andWhere('s.timeframe = :tf', { tf: SIGNAL_TIMEFRAME })
      .orderBy('s.strategyConfigId')
      .addOrderBy('s.barTime', 'DESC')
      .getMany();
    const byConfig = new Map(latest.map((s) => [s.strategyConfigId, s]));

    return configs.map(({ config, strategy }) => {
      const last = byConfig.get(config.id);
      return {
        code: strategy.code,
        configId: config.id,
        configName: config.name,
        position: last?.side === 'BUY' ? 'long' : 'flat',
        lastSignal: last
          ? {
              side: last.side,
              barTime: last.barTime,
              strength: last.strength,
              price: last.price,
              stopLoss: last.stopLoss,
              reason: last.reason,
            }
          : null,
      };
    });
  }

  private async symbolsById(): Promise<Map<string, string>> {
    const all = await this.assets.findAll();
    return new Map(all.map((a) => [a.id, a.symbol]));
  }
}

function toView(s: SignalEntity, symbol: string): SignalView {
  return {
    id: s.id,
    symbol,
    strategy: s.strategyConfig!.strategy!.code,
    configName: s.strategyConfig!.name,
    timeframe: s.timeframe,
    barTime: s.barTime,
    side: s.side,
    strength: s.strength,
    price: s.price,
    stopLoss: s.stopLoss,
    takeProfit: s.takeProfit,
    reason: s.reason,
    indicators: s.indicators,
    strategyVersion: s.strategyVersion,
  };
}
