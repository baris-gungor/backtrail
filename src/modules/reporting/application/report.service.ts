import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import { InvalidInputError, NotFoundError } from '../../../common/errors/domain.error';
import { StrategyCatalogService } from '../../analysis/application/strategy-catalog.service';
import { findStrategy, STRATEGIES } from '../../analysis/domain/strategies';
import { AssetsService } from '../../assets/application/assets.service';
import { runBacktest, type BacktestTrade, type EquityPoint } from '../../backtesting/domain/engine';
import { computeMetrics, type BacktestMetrics } from '../../backtesting/domain/metrics';
import { MarketDataQueryService } from '../../market-data/application/market-data-query.service';
import type { Bar } from '../../market-data/domain/bar';
import { TradingQueryService } from '../../trading/application/trading-query.service';
import { indexAtOrBefore } from '../../trading/domain/slot-state';
import {
  correlationMatrix,
  dailyCloses,
  drawdownCurve,
  extraMetrics,
  rollingSharpe,
  type ExtraMetrics,
  type RollingPoint,
} from '../domain/performance';
import {
  DEFAULT_HORIZONS,
  distribution,
  forwardReturns,
  type Distribution,
} from '../domain/signal-quality';
import {
  bestAndWorst,
  streaks,
  tradeStats,
  type TradeRecord,
  type TradeStats,
} from '../domain/trade-record';
import { ReportQueries, type RunRow } from '../infrastructure/report.queries';

export type ReportSource = 'backtest' | 'paper';

/** Metrics a matrix cell can show. Backtest cells use run metrics, paper cells trade statistics. */
export const BACKTEST_MATRIX_METRICS = [
  'sharpe',
  'sortino',
  'calmar',
  'totalReturn',
  'cagr',
  'alpha',
  'maxDrawdown',
  'profitFactor',
  'winRate',
  'expectancy',
  'trades',
] as const;
export const PAPER_MATRIX_METRICS = [
  'totalPnl',
  'winRate',
  'profitFactor',
  'expectancy',
  'avgReturn',
  'trades',
] as const;
export const MATRIX_METRICS = [
  ...new Set([...BACKTEST_MATRIX_METRICS, ...PAPER_MATRIX_METRICS]),
] as readonly string[];
export type MatrixMetric =
  (typeof BACKTEST_MATRIX_METRICS)[number] | (typeof PAPER_MATRIX_METRICS)[number];

/** Benchmark metrics stored with every run (cost-free buy & hold of the same window). */
const BENCHMARK_METRICS = new Set(['totalReturn', 'cagr', 'maxDrawdown']);
export const BENCHMARK_ROW = 'benchmark';

export interface MatrixCell {
  value: number | null;
  trades: number;
  /** Backtest run behind the cell. */
  runId: string | null;
  lowSample: boolean;
}

export interface MatrixRow {
  key: string;
  strategyCode: string;
  configName: string;
  isBenchmark: boolean;
  /** One cell per asset, in `assets` order; null without data. */
  cells: (MatrixCell | null)[];
}

export interface MatrixReport {
  source: ReportSource;
  metric: MatrixMetric;
  segment: string;
  assets: { assetId: string; symbol: string }[];
  rows: MatrixRow[];
}

export interface StrategyAssetBreakdown {
  assetId: string;
  symbol: string;
  stats: TradeStats;
  /** Latest full backtest run metrics (backtest source). */
  metrics: BacktestMetrics | null;
  runId: string | null;
}

export interface StrategyReport {
  strategyCode: string;
  source: ReportSource;
  summary: TradeStats;
  assets: StrategyAssetBreakdown[];
  best: TradeRecord[];
  worst: TradeRecord[];
}

export interface SignalStats {
  buys: number;
  sells: number;
  horizon: number;
  buy: Distribution;
  sell: Distribution;
}

export interface AssetStrategyRow {
  key: string;
  strategyCode: string;
  configName: string;
  runId: string | null;
  metrics: BacktestMetrics | null;
  paper: TradeStats | null;
  signals: SignalStats | null;
}

export interface AssetReport {
  assetId: string;
  symbol: string;
  strategies: AssetStrategyRow[];
  /** Correlation of equity returns of the latest full runs, plus buy & hold. */
  correlation: { keys: string[]; matrix: (number | null)[][] };
}

export interface PortfolioReport {
  portfolioId: string;
  name: string;
  equity: EquityPoint[];
  drawdown: EquityPoint[];
  /** Run metrics (Phase 3) on the daily equity series. */
  metrics: BacktestMetrics;
  extra: ExtraMetrics & { maxWinStreak: number; maxLossStreak: number };
  rollingSharpe: RollingPoint[];
  openRisk: {
    /** Loss if every position with a stop were stopped at its stop price, decimal string. */
    toStops: string;
    /** Market value of positions without a stop-loss, decimal string. */
    unprotected: string;
    positions: {
      symbol: string;
      quantity: string;
      lastPrice: number;
      stopLoss: number | null;
      riskToStop: string | null;
    }[];
  };
  contributions: {
    subscriptionId: string | null;
    label: string;
    strategyCode: string | null;
    trades: number;
    realizedPnl: string;
    unrealizedPnl: string;
  }[];
}

export interface DivergenceRow {
  subscriptionId: string;
  symbol: string;
  strategyCode: string;
  configName: string;
  source: string;
  from: Date | null;
  to: Date | null;
  paper: TradeStats;
  backtest: TradeStats;
  /** Paper total PnL minus backtest total PnL, decimal string. */
  pnlDiff: string;
  /** Trades with the same entry and exit time on both sides. */
  matched: number;
  onlyPaper: Date[];
  onlyBacktest: Date[];
}

export interface SignalQualityRow {
  strategyCode: string;
  configName: string;
  side: 'BUY' | 'SELL';
  /** One distribution per horizon. */
  byHorizon: Distribution[];
}

export interface SignalQualityReport {
  horizons: number[];
  rows: SignalQualityRow[];
}

export interface BacktestExtras {
  runId: string;
  extra: ExtraMetrics & { maxWinStreak: number; maxLossStreak: number };
  rollingSharpe: RollingPoint[];
}

export interface TradesQuery {
  source?: ReportSource;
  strategy?: string;
  symbol?: string;
  portfolioId?: string;
  runId?: string;
  from?: Date;
  to?: Date;
  limit: number;
}

const ROLLING_WINDOW_DAYS = 30;
const DAY_MS = 86_400_000;

const toPoints = (curve: [number, number][] | null | undefined): EquityPoint[] =>
  (curve ?? []).map(([t, equity]) => ({ time: new Date(t), equity }));

const rowKey = (code: string, configName: string | null) => `${code}/${configName ?? 'custom'}`;

/** Periods per year of a series, measured from its time span. */
function perYear(points: EquityPoint[]): number {
  if (points.length < 2) return 0;
  const years = (points.at(-1)!.time.getTime() - points[0].time.getTime()) / (365.25 * DAY_MS);
  return years > 0 ? (points.length - 1) / years : 0;
}

@Injectable()
export class ReportService {
  constructor(
    private readonly queries: ReportQueries,
    private readonly assets: AssetsService,
    private readonly catalog: StrategyCatalogService,
    private readonly marketData: MarketDataQueryService,
    private readonly trading: TradingQueryService,
  ) {}

  async matrix(
    source: ReportSource,
    metric: MatrixMetric,
    segment = 'full',
  ): Promise<MatrixReport> {
    const allowed: readonly string[] =
      source === 'backtest' ? BACKTEST_MATRIX_METRICS : PAPER_MATRIX_METRICS;
    if (!allowed.includes(metric)) {
      throw new InvalidInputError(
        `Metric ${metric} is not available for ${source} (${allowed.join(', ')})`,
      );
    }
    const assets = await this.queries.activeAssets();
    const column = new Map(assets.map((a, i) => [a.assetId, i]));
    const rows = new Map<string, MatrixRow>();
    const row = (code: string, configName: string, isBenchmark = false): MatrixRow => {
      const key = isBenchmark ? BENCHMARK_ROW : rowKey(code, configName);
      let r = rows.get(key);
      if (!r) {
        r = { key, strategyCode: code, configName, isBenchmark, cells: assets.map(() => null) };
        rows.set(key, r);
      }
      return r;
    };
    // Every strategy's default config gets a row, even without data.
    for (const s of STRATEGIES) if (!s.isBenchmark) row(s.code, 'default');

    if (source === 'backtest') {
      const runs = await this.queries.latestRuns({ segment, includeSweeps: segment !== 'full' });
      // Newest first, so the first run per row × asset wins (several custom params collapse).
      runs.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());
      const bench = row(BENCHMARK_ROW, 'buy & hold', true);
      for (const run of runs) {
        const col = column.get(run.assetId);
        if (col === undefined) continue;
        const r = row(run.strategyCode, run.configName ?? 'custom');
        if (!r.cells[col]) {
          r.cells[col] = {
            value: (run.metrics[metric as keyof BacktestMetrics] as number | null) ?? null,
            trades: run.metrics.trades,
            runId: run.id,
            lowSample: run.metrics.lowSample,
          };
        }
        if (!bench.cells[col]) {
          bench.cells[col] = {
            value: BENCHMARK_METRICS.has(metric)
              ? run.metrics.benchmark[metric as 'totalReturn' | 'cagr' | 'maxDrawdown']
              : null,
            trades: 0,
            runId: run.id,
            lowSample: false,
          };
        }
      }
    } else {
      const trades = await this.queries.paperTrades();
      const groups = new Map<string, TradeRecord[]>();
      for (const t of trades) {
        if (!t.strategyCode || !column.has(t.assetId)) continue;
        const key = `${rowKey(t.strategyCode, t.configName)}|${t.assetId}`;
        groups.set(key, [...(groups.get(key) ?? []), t]);
      }
      for (const [key, group] of groups) {
        const t = group[0];
        const stats = tradeStats(group);
        const value =
          metric === 'totalPnl'
            ? Number(stats.totalPnl)
            : (stats[metric as keyof TradeStats] as number | null);
        row(t.strategyCode!, t.configName ?? 'custom').cells[column.get(key.split('|')[1])!] = {
          value,
          trades: stats.trades,
          runId: null,
          lowSample: stats.trades < 10,
        };
      }
    }

    const ordered = [...rows.values()].sort(
      (a, b) => Number(a.isBenchmark) - Number(b.isBenchmark) || a.key.localeCompare(b.key),
    );
    return { source, metric, segment, assets, rows: ordered };
  }

  async strategy(
    code: string,
    source: ReportSource,
    range: { from?: Date; to?: Date },
  ): Promise<StrategyReport> {
    this.catalog.definition(code);
    const trades =
      source === 'backtest'
        ? await this.queries.backtestTrades({ strategy: code, ...range })
        : await this.queries.paperTrades({ strategy: code, ...range });
    const runs =
      source === 'backtest' ? await this.queries.latestRuns({ strategy: code }) : ([] as RunRow[]);

    const byAsset = new Map<string, TradeRecord[]>();
    for (const t of trades) byAsset.set(t.assetId, [...(byAsset.get(t.assetId) ?? []), t]);
    for (const run of runs) if (!byAsset.has(run.assetId)) byAsset.set(run.assetId, []);

    const assets = [...byAsset.entries()].map(([assetId, list]) => {
      // The default config's run when there is one, else the newest.
      const run =
        runs.find((r) => r.assetId === assetId && r.configName === 'default') ??
        runs
          .filter((r) => r.assetId === assetId)
          .sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime())[0];
      return {
        assetId,
        symbol: list[0]?.symbol ?? run?.symbol ?? assetId,
        stats: tradeStats(list),
        metrics: run?.metrics ?? null,
        runId: run?.id ?? null,
      };
    });
    assets.sort((a, b) => a.symbol.localeCompare(b.symbol));
    return {
      strategyCode: code,
      source,
      summary: tradeStats(trades),
      assets,
      ...bestAndWorst(trades, 5),
    };
  }

  async asset(symbol: string, horizon = 6): Promise<AssetReport> {
    const asset = await this.assets.findBySymbol(symbol);
    const [runs, paper, signals, bars] = await Promise.all([
      this.queries.latestRuns({ assetId: asset.id, withCurves: true }),
      this.queries.paperTrades({ assetId: asset.id }),
      this.queries.signals({ assetId: asset.id }),
      this.marketData.getHistory(asset.id, '4h', { completeOnly: true }),
    ]);
    runs.sort((a, b) => b.finishedAt.getTime() - a.finishedAt.getTime());

    const rows = new Map<string, AssetStrategyRow>();
    const row = (code: string, configName: string | null): AssetStrategyRow => {
      const key = rowKey(code, configName);
      let r = rows.get(key);
      if (!r) {
        r = {
          key,
          strategyCode: code,
          configName: configName ?? 'custom',
          runId: null,
          metrics: null,
          paper: null,
          signals: null,
        };
        rows.set(key, r);
      }
      return r;
    };
    const curves: { key: string; points: EquityPoint[] }[] = [];
    for (const run of runs) {
      const r = row(run.strategyCode, run.configName);
      if (r.runId) continue;
      r.runId = run.id;
      r.metrics = run.metrics;
      if (run.equityCurve) curves.push({ key: r.key, points: toPoints(run.equityCurve) });
    }
    const withBenchmark = runs.find((r) => r.benchmarkCurve);
    if (withBenchmark) {
      curves.push({ key: 'buy & hold', points: toPoints(withBenchmark.benchmarkCurve) });
    }

    const paperGroups = new Map<string, TradeRecord[]>();
    for (const t of paper) {
      if (!t.strategyCode) continue;
      const key = rowKey(t.strategyCode, t.configName);
      paperGroups.set(key, [...(paperGroups.get(key) ?? []), t]);
    }
    for (const group of paperGroups.values()) {
      row(group[0].strategyCode!, group[0].configName).paper = tradeStats(group);
    }

    const signalGroups = new Map<string, typeof signals>();
    for (const s of signals) {
      const key = rowKey(s.strategyCode, s.configName);
      signalGroups.set(key, [...(signalGroups.get(key) ?? []), s]);
    }
    for (const group of signalGroups.values()) {
      const returns = { BUY: [] as number[], SELL: [] as number[] };
      for (const s of group) {
        const [r] = forwardReturns(bars, s, [horizon]);
        if (r !== null) returns[s.side].push(r);
      }
      row(group[0].strategyCode, group[0].configName).signals = {
        buys: group.filter((s) => s.side === 'BUY').length,
        sells: group.filter((s) => s.side === 'SELL').length,
        horizon,
        buy: distribution(returns.BUY, 'BUY'),
        sell: distribution(returns.SELL, 'SELL'),
      };
    }

    return {
      assetId: asset.id,
      symbol: asset.symbol,
      strategies: [...rows.values()].sort((a, b) => a.key.localeCompare(b.key)),
      correlation: {
        keys: curves.map((c) => c.key),
        matrix: correlationMatrix(curves.map((c) => c.points)),
      },
    };
  }

  async portfolio(portfolioId: string): Promise<PortfolioReport> {
    const detail = await this.trading.detail(portfolioId);
    const [snapshots, trades, subs] = await Promise.all([
      this.queries.snapshots(portfolioId),
      this.queries.paperTrades({ portfolioId }),
      this.queries.subscriptions(portfolioId),
    ]);
    const equity: EquityPoint[] = snapshots.map((s) => ({ time: s.at, equity: Number(s.equity) }));
    const invested = new Map(snapshots.map((s) => [s.at.getTime(), Number(s.positionsValue) > 0]));
    const daily = dailyCloses(equity);
    const ordered = [...trades].sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime());

    const metrics = computeMetrics({
      equity: daily,
      benchmark: [],
      trades: ordered.map(toBacktestTrade),
      bars: Math.max(0, daily.length - 1),
      barsInMarket: daily.slice(1).filter((p) => invested.get(p.time.getTime())).length,
      totalFees: ordered.reduce((acc, t) => acc.plus(t.fees), new Decimal(0)),
    });
    const { maxWin, maxLoss } = streaks(ordered.map((t) => Number(t.pnl)));

    let toStops = new Decimal(0);
    let unprotected = new Decimal(0);
    const positions = detail.positions.map((p) => {
      // Exposure: a short without a stop is as unprotected as a long.
      const value = new Decimal(p.quantity).mul(p.lastPrice).abs();
      if (p.stopLoss === null) {
        unprotected = unprotected.plus(value);
        return { ...pick(p), riskToStop: null };
      }
      const risk = Decimal.max(0, new Decimal(p.quantity).mul(p.lastPrice - p.stopLoss));
      toStops = toStops.plus(risk);
      return { ...pick(p), riskToStop: risk.toFixed(2) };
    });

    const contributions = new Map<string, PortfolioReport['contributions'][number]>();
    const contribution = (subscriptionId: string | null) => {
      const key = subscriptionId ?? 'manual';
      let c = contributions.get(key);
      if (!c) {
        const sub = subs.find((s) => s.id === subscriptionId);
        c = {
          subscriptionId,
          label: sub ? `${sub.symbol} · ${sub.strategyCode}/${sub.configName}` : 'manuel',
          strategyCode: sub?.strategyCode ?? null,
          trades: 0,
          realizedPnl: '0.00',
          unrealizedPnl: '0.00',
        };
        contributions.set(key, c);
      }
      return c;
    };
    for (const t of ordered) {
      const c = contribution(t.subscriptionId);
      c.trades++;
      c.realizedPnl = new Decimal(c.realizedPnl).plus(t.pnl).toFixed(2);
    }
    for (const p of detail.positions) {
      const c = contribution(p.subscriptionId);
      c.unrealizedPnl = new Decimal(c.unrealizedPnl).plus(p.unrealizedPnl).toFixed(2);
    }

    return {
      portfolioId,
      name: detail.name,
      equity,
      drawdown: drawdownCurve(equity),
      metrics,
      extra: { ...extraMetrics(daily), maxWinStreak: maxWin, maxLossStreak: maxLoss },
      rollingSharpe: rollingSharpe(daily, ROLLING_WINDOW_DAYS, perYear(daily)),
      openRisk: { toStops: toStops.toFixed(2), unprotected: unprotected.toFixed(2), positions },
      contributions: [...contributions.values()],
    };
  }

  async trades(q: TradesQuery): Promise<TradeRecord[]> {
    const assetId = q.symbol ? (await this.assets.findBySymbol(q.symbol)).id : undefined;
    const filter = {
      strategy: q.strategy,
      assetId,
      from: q.from,
      to: q.to,
      limit: q.limit,
    };
    const lists = await Promise.all([
      q.source === 'paper' || q.portfolioId
        ? []
        : this.queries.backtestTrades({ ...filter, runId: q.runId }),
      q.source === 'backtest' || q.runId
        ? []
        : this.queries.paperTrades({ ...filter, portfolioId: q.portfolioId }),
    ]);
    return lists
      .flat()
      .sort((a, b) => b.exitTime.getTime() - a.exitTime.getTime())
      .slice(0, q.limit);
  }

  /**
   * Paper trades of each subscription against a backtest of the same strategy over the same
   * bars (portfolio cash, execution and sizing, no risk rules). Differences come from risk rules,
   * shared cash, manual actions, or the `signals` source.
   */
  async divergence(portfolioId: string): Promise<DivergenceRow[]> {
    const detail = await this.trading.detail(portfolioId);
    const subs = await this.queries.subscriptions(portfolioId);
    const barsByAsset = new Map<string, Bar[]>();
    const out: DivergenceRow[] = [];

    for (const sub of subs) {
      let bars = barsByAsset.get(sub.assetId);
      if (!bars) {
        bars = await this.marketData.getHistory(sub.assetId, '4h', { completeOnly: true });
        barsByAsset.set(sub.assetId, bars);
      }
      const paper = await this.queries.paperTrades({ portfolioId, subscriptionId: sub.id });
      // Older subscriptions have no start bar; the bar open when they were created is close.
      const startBar = sub.startBarTime ?? new Date(sub.createdAt.getTime() - 4 * 3_600_000);
      const start = indexAtOrBefore(bars, startBar) + 1;
      const end = sub.lastBarTime ? indexAtOrBefore(bars, sub.lastBarTime) : -1;

      let backtest: TradeRecord[] = [];
      if (end >= start && start > 0) {
        const { config, strategy } = await this.catalog.configById(sub.strategyConfigId);
        const window = bars.slice(0, end + 1);
        const result = runBacktest({
          bars: window,
          runner: strategy.createRunner(window, config.params),
          initialCapital: Number(detail.initialCash),
          execution: detail.execution,
          sizing: sub.allocationPct
            ? { type: 'fixed_fraction', fraction: sub.allocationPct / 100 }
            : detail.execution.sizing,
          tradeFrom: start,
          direction: detail.riskRules.allowShort ? sub.direction : 'long',
        });
        backtest = result.trades
          .filter((t) => t.exitReason !== 'end_of_data')
          .map((t, i) => fromBacktestTrade(t, `${sub.id}:${i}`, sub));
      }

      const key = (t: TradeRecord) => `${t.entryTime.getTime()}|${t.exitTime.getTime()}`;
      const paperKeys = new Set(paper.map(key));
      const backtestKeys = new Set(backtest.map(key));
      const paperStats = tradeStats(paper);
      const backtestStats = tradeStats(backtest);
      out.push({
        subscriptionId: sub.id,
        symbol: sub.symbol,
        strategyCode: sub.strategyCode,
        configName: sub.configName,
        source: sub.source,
        from: bars[start]?.openTime ?? null,
        to: end >= 0 ? bars[end].openTime : null,
        paper: paperStats,
        backtest: backtestStats,
        pnlDiff: new Decimal(paperStats.totalPnl).minus(backtestStats.totalPnl).toFixed(2),
        matched: paper.filter((t) => backtestKeys.has(key(t))).length,
        onlyPaper: paper.filter((t) => !backtestKeys.has(key(t))).map((t) => t.entryTime),
        onlyBacktest: backtest.filter((t) => !paperKeys.has(key(t))).map((t) => t.entryTime),
      });
    }
    return out;
  }

  async signalQuality(
    filter: { strategy?: string; symbol?: string },
    horizons = DEFAULT_HORIZONS,
  ): Promise<SignalQualityReport> {
    if (filter.strategy && !findStrategy(filter.strategy)) {
      throw new NotFoundError(`Strategy ${filter.strategy} not found`);
    }
    const assetId = filter.symbol ? (await this.assets.findBySymbol(filter.symbol)).id : undefined;
    const signals = await this.queries.signals({ strategy: filter.strategy, assetId });

    const groups = new Map<string, { row: SignalQualityRow; values: number[][] }>();
    const barsByAsset = new Map<string, Bar[]>();
    for (const s of signals) {
      let bars = barsByAsset.get(s.assetId);
      if (!bars) {
        bars = await this.marketData.getHistory(s.assetId, '4h', { completeOnly: true });
        barsByAsset.set(s.assetId, bars);
      }
      const key = `${rowKey(s.strategyCode, s.configName)}|${s.side}`;
      let g = groups.get(key);
      if (!g) {
        g = {
          row: {
            strategyCode: s.strategyCode,
            configName: s.configName,
            side: s.side,
            byHorizon: [],
          },
          values: horizons.map(() => []),
        };
        groups.set(key, g);
      }
      forwardReturns(bars, s, horizons).forEach((r, i) => {
        if (r !== null) g.values[i].push(r);
      });
    }
    const rows = [...groups.values()].map(({ row, values }) => ({
      ...row,
      byHorizon: values.map((v) => distribution(v, row.side)),
    }));
    rows.sort(
      (a, b) =>
        a.strategyCode.localeCompare(b.strategyCode) ||
        a.configName.localeCompare(b.configName) ||
        a.side.localeCompare(b.side),
    );
    return { horizons, rows };
  }

  async backtestExtras(runId: string): Promise<BacktestExtras> {
    const run = await this.queries.run(runId);
    if (!run) throw new NotFoundError(`Successful backtest run ${runId} not found`);
    if (!run.equityCurve) {
      throw new InvalidInputError('This run has no stored equity curve (sweep train run)');
    }
    const daily = dailyCloses(toPoints(run.equityCurve));
    const trades = await this.queries.backtestTrades({ runId });
    const { maxWin, maxLoss } = streaks([...trades].reverse().map((t) => Number(t.pnl)));
    return {
      runId,
      extra: { ...extraMetrics(daily), maxWinStreak: maxWin, maxLossStreak: maxLoss },
      rollingSharpe: rollingSharpe(daily, ROLLING_WINDOW_DAYS, perYear(daily)),
    };
  }
}

function pick(p: { symbol: string; quantity: string; lastPrice: number; stopLoss: number | null }) {
  return { symbol: p.symbol, quantity: p.quantity, lastPrice: p.lastPrice, stopLoss: p.stopLoss };
}

function toBacktestTrade(t: TradeRecord): BacktestTrade {
  return {
    side: t.side,
    entryTime: t.entryTime,
    entryPrice: new Decimal(t.entryPrice),
    exitTime: t.exitTime,
    exitPrice: new Decimal(t.exitPrice),
    quantity: new Decimal(t.quantity),
    fees: new Decimal(t.fees),
    pnl: new Decimal(t.pnl),
    returnPct: new Decimal(t.returnPct),
    exitReason: t.exitReason as BacktestTrade['exitReason'],
    barsHeld: t.barsHeld ?? 0,
  };
}

function fromBacktestTrade(
  t: BacktestTrade,
  id: string,
  sub: { assetId: string; symbol: string; strategyCode: string; configName: string },
): TradeRecord {
  return {
    source: 'backtest',
    id,
    runId: null,
    portfolioId: null,
    subscriptionId: null,
    strategyCode: sub.strategyCode,
    configName: sub.configName,
    symbol: sub.symbol,
    assetId: sub.assetId,
    entryTime: t.entryTime,
    entryPrice: t.entryPrice.toNumber(),
    exitTime: t.exitTime,
    exitPrice: t.exitPrice.toNumber(),
    quantity: t.quantity.toString(),
    fees: t.fees.toString(),
    pnl: t.pnl.toString(),
    returnPct: t.returnPct.toNumber(),
    side: t.side,
    exitReason: t.exitReason,
    barsHeld: t.barsHeld,
  };
}
