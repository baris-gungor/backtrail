import Decimal from 'decimal.js';
import request from 'supertest';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { STRATEGIES } from '../src/modules/analysis/domain/strategies';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import type { EquityPoint } from '../src/modules/backtesting/domain/engine';
import { returnMetrics } from '../src/modules/backtesting/domain/metrics';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import { dailyCloses } from '../src/modules/reporting/domain/performance';
import { createTestApp, TestContext } from './setup/create-test-app';

const HOUR = 3600_000;

const fourHour: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
  openTime: new Date(t * 1000),
  open,
  high,
  low,
  close,
  volume,
  isComplete: true,
}));

const hourlyOf = (bars: Bar[]): RawBar[] =>
  bars.flatMap((bar) =>
    [0, 1, 2, 3].map((k) => ({
      openTime: new Date(bar.openTime.getTime() + k * HOUR),
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume / 4,
    })),
  );

interface Cell {
  value: number | null;
  trades: number;
  runId: string | null;
}
interface Matrix {
  assets: { symbol: string }[];
  rows: { key: string; isBenchmark: boolean; cells: (Cell | null)[] }[];
}
interface Stats {
  trades: number;
  totalPnl: string;
  winRate: number | null;
}

const STRATEGY_COUNT = STRATEGIES.filter((s) => !s.isBenchmark).length;

describe('Reports (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  const register = async (symbol: string, bars: RawBar[]): Promise<string> => {
    ctx.resolver.known.set(symbol, {
      symbol,
      name: `${symbol} future`,
      assetClass: AssetClass.Future,
      exchange: 'COMEX',
      currency: 'USD',
      sessionType: SessionType.Continuous,
      provider: 'fake',
    });
    ctx.provider.bars.set(symbol, bars);
    const res = await api().post('/api/assets').send({ symbol }).expect(201);
    await ctx.idle();
    return (res.body as { id: string }).id;
  };

  beforeAll(async () => {
    ctx = await createTestApp();
    await ctx.reset();
    for (const symbol of ['GOLD', 'GOLD2']) await register(symbol, hourlyOf(fourHour));
    await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD', 'GOLD2'] })
      .expect(201);
    await ctx.idle();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('builds the strategy × asset matrix with a buy & hold row', async () => {
    const matrix = (
      await api().get('/api/reports/matrix').query({ metric: 'totalReturn' }).expect(200)
    ).body as Matrix;
    expect(matrix.assets.map((a) => a.symbol)).toEqual(['GOLD', 'GOLD2']);
    expect(matrix.rows).toHaveLength(STRATEGY_COUNT + 1);
    const bench = matrix.rows.at(-1)!;
    expect(bench).toMatchObject({ key: 'benchmark', isBenchmark: true });
    for (const row of matrix.rows) {
      expect(row.cells.every((c) => c !== null && c.value !== null)).toBe(true);
    }

    // Cells carry the run's metric; the benchmark cell the run's buy & hold.
    const cell = matrix.rows[0].cells[0]!;
    const run = (await api().get(`/api/backtests/${cell.runId}`).expect(200)).body as {
      metrics: { totalReturn: number; benchmark: { totalReturn: number } };
    };
    expect(cell.value).toBe(run.metrics.totalReturn);
    expect(bench.cells[0]!.value).toBeCloseTo(run.metrics.benchmark.totalReturn, 12);

    // Buy & hold has no Sharpe; paper cells only have trade statistics.
    const sharpe = (await api().get('/api/reports/matrix').query({ metric: 'sharpe' }).expect(200))
      .body as Matrix;
    expect(sharpe.rows.at(-1)!.cells.every((c) => c!.value === null)).toBe(true);
    await api().get('/api/reports/matrix').query({ source: 'paper', metric: 'sharpe' }).expect(422);
    const paper = (
      await api()
        .get('/api/reports/matrix')
        .query({ source: 'paper', metric: 'totalPnl' })
        .expect(200)
    ).body as Matrix;
    expect(paper.rows).toHaveLength(STRATEGY_COUNT);
  });

  it('reports one strategy over all assets', async () => {
    const report = (await api().get('/api/reports/strategies/trend_ema_adx').expect(200)).body as {
      summary: Stats;
      assets: { symbol: string; stats: Stats; metrics: { trades: number } }[];
      best: { returnPct: number }[];
      worst: { returnPct: number }[];
    };
    expect(report.assets.map((a) => a.symbol)).toEqual(['GOLD', 'GOLD2']);
    for (const a of report.assets) expect(a.stats.trades).toBe(a.metrics.trades);
    expect(report.summary.trades).toBe(
      report.assets[0].stats.trades + report.assets[1].stats.trades,
    );
    expect(new Decimal(report.summary.totalPnl).toFixed(2)).toBe(
      new Decimal(report.assets[0].stats.totalPnl).plus(report.assets[1].stats.totalPnl).toFixed(2),
    );
    expect(report.best[0].returnPct).toBeGreaterThanOrEqual(report.worst[0].returnPct);
    await api().get('/api/reports/strategies/nope').expect(404);
  });

  it('reports every strategy on an asset with signal stats and correlation', async () => {
    const report = (await api().get('/api/reports/assets/GOLD').expect(200)).body as {
      strategies: {
        runId: string | null;
        signals: { buys: number; buy: { count: number } } | null;
      }[];
      correlation: { keys: string[]; matrix: (number | null)[][] };
    };
    expect(report.strategies).toHaveLength(STRATEGY_COUNT);
    expect(report.strategies.every((s) => s.runId !== null)).toBe(true);
    const withSignals = report.strategies.filter((s) => s.signals);
    expect(withSignals.length).toBe(STRATEGY_COUNT);
    for (const s of withSignals) expect(s.signals!.buy.count).toBeLessThanOrEqual(s.signals!.buys);
    expect(report.correlation.keys).toHaveLength(STRATEGY_COUNT + 1);
    expect(report.correlation.matrix.map((r, i) => r[i])).toEqual(
      report.correlation.keys.map(() => 1),
    );
  });

  it('exports the trade journal as CSV consistent with the JSON filters', async () => {
    const query = { source: 'backtest', symbol: 'GOLD', strategy: 'trend_ema_adx' };
    const json = (await api().get('/api/reports/trades').query(query).expect(200)).body as {
      symbol: string;
      strategyCode: string;
      pnl: string;
    }[];
    expect(json.length).toBeGreaterThan(0);
    expect(json.every((t) => t.symbol === 'GOLD' && t.strategyCode === 'trend_ema_adx')).toBe(true);

    const csv = await api()
      .get('/api/reports/trades')
      .query({ ...query, format: 'csv' })
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    const lines = csv.text.trimEnd().split('\r\n');
    expect(lines[0].split(',').slice(0, 4)).toEqual(['source', 'strategy', 'config', 'symbol']);
    expect(lines).toHaveLength(json.length + 1);
    expect(lines[1].split(',')[10]).toBe(json[0].pnl);
  });

  it('measures forward returns after stored signals', async () => {
    const report = (await api().get('/api/reports/signals').query({ symbol: 'GOLD' }).expect(200))
      .body as {
      horizons: number[];
      rows: {
        strategyCode: string;
        side: string;
        byHorizon: { count: number; hitRate: number }[];
      }[];
    };
    expect(report.horizons).toEqual([1, 3, 6, 12]);
    const buys = report.rows.filter((r) => r.side === 'BUY');
    expect(buys).toHaveLength(STRATEGY_COUNT);
    for (const r of buys) {
      expect(r.byHorizon[0].count).toBeGreaterThan(0);
      expect(r.byHorizon[0].hitRate).toBeGreaterThanOrEqual(0);
      expect(r.byHorizon[0].hitRate).toBeLessThanOrEqual(1);
      // Longer horizons can only lose signals near the end of the data.
      expect(r.byHorizon[3].count).toBeLessThanOrEqual(r.byHorizon[0].count);
    }
    const custom = (
      await api()
        .get('/api/reports/signals')
        .query({ horizons: '2,4', strategy: 'trend_ema_adx' })
        .expect(200)
    ).body as { horizons: number[]; rows: { strategyCode: string }[] };
    expect(custom.horizons).toEqual([2, 4]);
    expect(custom.rows.every((r) => r.strategyCode === 'trend_ema_adx')).toBe(true);
  });

  it('adds monthly returns, ulcer index and streaks to a backtest run', async () => {
    const matrix = (await api().get('/api/reports/matrix').expect(200)).body as Matrix;
    const runId = matrix.rows[0].cells[0]!.runId!;
    const extras = (await api().get(`/api/reports/backtests/${runId}`).expect(200)).body as {
      extra: { monthly: { period: string }[]; yearly: unknown[]; ulcerIndex: number };
      rollingSharpe: unknown[];
    };
    expect(extras.extra.monthly.length).toBeGreaterThanOrEqual(12);
    expect(extras.extra.yearly.length).toBeGreaterThanOrEqual(1);
    expect(extras.extra.ulcerIndex).toBeGreaterThanOrEqual(0);
    expect(extras.rollingSharpe.length).toBeGreaterThan(30);
  });

  it('reports a paper portfolio and finds no divergence from its backtest', async () => {
    const start = 400;
    const assetId = await register('PAPER', hourlyOf(fourHour.slice(0, start)));
    const portfolio = (
      await api()
        .post('/api/portfolios')
        .send({
          name: 'report',
          initialCash: 10_000,
          riskRules: { requireStopLoss: false, maxPositionPct: 100, maxDailyLossPct: 100 },
        })
        .expect(201)
    ).body as { id: string };
    const strategies = (await api().get('/api/analysis/strategies').expect(200)).body as {
      code: string;
      configs: { id: string; name: string }[];
    }[];
    const configId = strategies
      .find((s) => s.code === 'trend_ema_adx')!
      .configs.find((c) => c.name === 'default')!.id;
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: configId, symbol: 'PAPER' })
      .expect(201);
    for (const end of [800, fourHour.length]) {
      ctx.provider.bars.set('PAPER', hourlyOf(fourHour.slice(0, end)));
      await api().post(`/api/market-data/sync/${assetId}`).expect(201);
      await ctx.idle();
    }

    const divergence = (
      await api().get('/api/reports/divergence').query({ portfolioId: portfolio.id }).expect(200)
    ).body as {
      paper: Stats;
      backtest: Stats;
      pnlDiff: string;
      matched: number;
      onlyPaper: string[];
      onlyBacktest: string[];
    }[];
    expect(divergence).toHaveLength(1);
    const [row] = divergence;
    expect(row.paper.trades).toBeGreaterThan(0);
    expect(row).toMatchObject({ matched: row.paper.trades, onlyPaper: [], onlyBacktest: [] });
    expect(row.pnlDiff).toBe('0.00');
    expect(row.backtest.trades).toBe(row.paper.trades);

    const report = (await api().get(`/api/reports/portfolios/${portfolio.id}`).expect(200))
      .body as {
      metrics: { totalReturn: number; maxDrawdown: number; trades: number };
      contributions: { trades: number; realizedPnl: string }[];
    };
    // Same daily series as the snapshots endpoint, same Phase 3 metrics.
    const snapshots = (await api().get(`/api/portfolios/${portfolio.id}/equity`).expect(200))
      .body as { at: string; equity: string }[];
    const daily = dailyCloses(
      snapshots.map((s): EquityPoint => ({ time: new Date(s.at), equity: Number(s.equity) })),
    );
    const expected = returnMetrics(daily);
    expect(report.metrics.totalReturn).toBeCloseTo(expected.totalReturn, 12);
    expect(report.metrics.maxDrawdown).toBeCloseTo(expected.maxDrawdown, 12);
    expect(report.metrics.trades).toBe(row.paper.trades);
    expect(report.contributions[0].trades).toBe(row.paper.trades);
    expect(report.contributions[0].realizedPnl).toBe(row.paper.totalPnl);

    // The journal filters by portfolio.
    const journal = (
      await api().get('/api/reports/trades').query({ portfolioId: portfolio.id }).expect(200)
    ).body as { source: string }[];
    expect(journal).toHaveLength(row.paper.trades);
    expect(journal.every((t) => t.source === 'paper')).toBe(true);
  });
});
