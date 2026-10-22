import request from 'supertest';
import { findStrategy } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { runBacktest } from '../src/modules/backtesting/domain/engine';
import { walkForwardWindows } from '../src/modules/backtesting/domain/walk-forward';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import { DEFAULT_EXECUTION, DEFAULT_SIZING } from '../src/modules/trading/domain/execution';
import { createTestApp, TestContext } from './setup/create-test-app';

interface RunBody {
  id: string;
  symbol: string;
  strategyCode: string;
  configName: string | null;
  params: Record<string, unknown>;
  segment: string;
  source: string;
  status: string;
  error: string | null;
  metrics: { trades: number; sharpe: number | null; totalReturn: number } | null;
  equityCurve?: number[][] | null;
  initialCapital: string;
  walkForward: {
    window: number | null;
    summary?: { efficiency: number | null; profitableWindows: number; distinctParams: number };
  } | null;
}

interface BatchBody {
  batchId: string;
  total: number;
  success: number;
  failed: number;
  runs: RunBody[];
}

interface TradeBody {
  entryTime: string;
  pnl: string;
  exitReason: string;
}

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

/** Four identical 1h bars per 4h bar, so aggregation rebuilds the fixture. */
const hourly: RawBar[] = fourHour.flatMap((bar) =>
  [0, 1, 2, 3].map((k) => ({
    openTime: new Date(bar.openTime.getTime() + k * HOUR),
    open: bar.open,
    high: bar.high,
    low: bar.low,
    close: bar.close,
    volume: bar.volume / 4,
  })),
);

describe('Backtests (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    for (const symbol of ['GOLD', 'GOLD2']) {
      ctx.resolver.known.set(symbol, {
        symbol,
        name: `${symbol} future`,
        assetClass: AssetClass.Future,
        exchange: 'COMEX',
        currency: 'USD',
        sessionType: SessionType.Continuous,
        provider: 'fake',
      });
      ctx.provider.bars.set(symbol, [...hourly]);
      await api().post('/api/assets').send({ symbol }).expect(201);
    }
    await ctx.idle();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const batch = async (batchId: string): Promise<BatchBody> => {
    await ctx.idle();
    return (await api().get(`/api/backtests/batches/${batchId}`).expect(200)).body as BatchBody;
  };

  it('runs the symbol × strategy matrix and ranks it on the leaderboard', async () => {
    const submit = await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD', 'GOLD2'] })
      .expect(201);
    const { batchId, runs } = submit.body as { batchId: string; runs: number };
    // Default: every active config, i.e. the 5 strategies (the benchmark config is inactive).
    expect(runs).toBe(10);

    const result = await batch(batchId);
    expect(result).toMatchObject({ total: 10, success: 10, failed: 0 });

    // The stored result equals the domain engine on the same bars.
    const trend = findStrategy('trend_ema_adx')!;
    const expected = runBacktest({
      bars: fourHour,
      runner: trend.createRunner(fourHour, trend.defaultParams),
      initialCapital: 10_000,
      execution: DEFAULT_EXECUTION,
      sizing: DEFAULT_SIZING,
    });
    const gold = result.runs.find((r) => r.symbol === 'GOLD' && r.strategyCode === trend.code)!;
    expect(gold.configName).toBe('default');
    expect(gold.metrics?.trades).toBe(expected.trades.length);

    const detail = (await api().get(`/api/backtests/${gold.id}`).expect(200)).body as RunBody;
    expect(detail.equityCurve!.length).toBeGreaterThan(100);
    expect(detail.equityCurve!.length).toBeLessThanOrEqual(1000);

    const trades = (await api().get(`/api/backtests/${gold.id}/trades`).expect(200))
      .body as TradeBody[];
    expect(trades).toHaveLength(expected.trades.length);
    expect(trades[0].pnl).toBe(expected.trades[0].pnl.toFixed(2));

    // Monte Carlo on the stored trades: reproducible, and its trade-by-trade compounding gives
    // the run's own total return.
    const mc = (await api().get(`/api/backtests/${gold.id}/monte-carlo`).expect(200)).body as {
      trades: number;
      actual: { totalReturn: number };
      totalReturn: { p5: number; p95: number };
    };
    expect(mc.trades).toBe(expected.trades.length);
    expect(mc.actual.totalReturn).toBeCloseTo(gold.metrics!.totalReturn, 4);
    expect(mc.totalReturn.p5).toBeLessThan(mc.totalReturn.p95);
    const mcAgain = await api().get(`/api/backtests/${gold.id}/monte-carlo`).expect(200);
    expect(mcAgain.body).toEqual(mc);

    const board = (
      await api().get('/api/backtests/leaderboard').query({ metric: 'sharpe' }).expect(200)
    ).body as RunBody[];
    expect(board).toHaveLength(10);
    const sharpes = board.map((r) => r.metrics!.sharpe ?? -Infinity);
    expect(sharpes).toEqual([...sharpes].sort((a, b) => b - a));

    // A second batch replaces the entries instead of adding to them.
    const again = await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD'], strategies: [{ code: 'trend_ema_adx', config: 'default' }] })
      .expect(201);
    await batch((again.body as { batchId: string }).batchId);
    const filtered = (
      await api().get('/api/backtests/leaderboard').query({ symbol: 'GOLD' }).expect(200)
    ).body as RunBody[];
    expect(filtered).toHaveLength(5);
  });

  it('starts trading at `from` with indicators warmed up on earlier bars', async () => {
    const from = fourHour[800].openTime.toISOString();
    const submit = await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD'], strategies: [{ code: 'breakout_donchian_atr' }], from })
      .expect(201);
    const [run] = (await batch((submit.body as { batchId: string }).batchId)).runs;
    expect(run.status).toBe('success');
    const trades = (await api().get(`/api/backtests/${run.id}/trades`).expect(200))
      .body as TradeBody[];
    expect(trades.length).toBeGreaterThan(0);
    expect(trades.every((t) => t.entryTime > from)).toBe(true);
  });

  it('sweeps on the train segment and tests the best params separately', async () => {
    const submit = await api()
      .post('/api/backtests/sweep')
      .send({
        symbol: 'GOLD',
        strategy: { code: 'trend_ema_adx' },
        paramGrid: { fast: { min: 10, max: 30, step: 10 }, adxMin: [15, 25] },
        top: 2,
      })
      .expect(201);
    const { batchId, runs } = submit.body as { batchId: string; runs: number };
    expect(runs).toBe(6);

    const result = await batch(batchId);
    const train = result.runs.filter((r) => r.segment === 'train');
    const test = result.runs.filter((r) => r.segment === 'test');
    expect(train).toHaveLength(6);
    expect(test).toHaveLength(2);
    expect(result.runs.every((r) => r.source === 'sweep' && r.status === 'success')).toBe(true);
    const trainParams = train.map((r) => JSON.stringify(r.params));
    expect(test.every((r) => trainParams.includes(JSON.stringify(r.params)))).toBe(true);

    // Sweep runs stay out of the default leaderboard.
    const board = (await api().get('/api/backtests/leaderboard').expect(200)).body as RunBody[];
    expect(board).toHaveLength(0);
    const testBoard = (
      await api()
        .get('/api/backtests/leaderboard')
        .query({ segment: 'test', includeSweeps: true })
        .expect(200)
    ).body as RunBody[];
    expect(testBoard).toHaveLength(2);
  });

  it('runs a walk-forward analysis whose test runs match the engine and join into one result', async () => {
    const grid = { fast: [10, 20], adxMin: [15, 25] };
    const submit = await api()
      .post('/api/backtests/walk-forward')
      .send({ symbol: 'GOLD', strategy: { code: 'trend_ema_adx' }, paramGrid: grid, windows: 3 })
      .expect(201);
    const { batchId, runs } = submit.body as { batchId: string; runs: number };
    expect(runs).toBe(7);

    const result = await batch(batchId);
    expect(result).toMatchObject({ total: 7, success: 7, failed: 0 });
    expect(result.runs.every((r) => r.source === 'walk_forward')).toBe(true);
    const bySegment = (segment: string) =>
      result.runs
        .filter((r) => r.segment === segment)
        .sort((a, b) => a.walkForward!.window! - b.walkForward!.window!);
    const train = bySegment('train');
    const test = bySegment('test');
    const [oos] = result.runs.filter((r) => r.segment === 'oos');
    expect(train).toHaveLength(3);
    expect(test).toHaveLength(3);

    // Each test run equals the engine on the same bars, with capital carried between windows.
    const trend = findStrategy('trend_ema_adx')!;
    const windows = walkForwardWindows(0, fourHour.length, {
      windows: 3,
      trainRatio: 0.7,
      anchored: false,
    });
    let capital = 10_000;
    let trades = 0;
    for (const [i, w] of windows.entries()) {
      expect(test[i].params).toEqual(train[i].params);
      expect(Number(test[i].initialCapital)).toBeCloseTo(capital, 2);
      const bars = fourHour.slice(0, w.testTo);
      const expected = runBacktest({
        bars,
        runner: trend.createRunner(bars, trend.validateParams(test[i].params)),
        initialCapital: Number(test[i].initialCapital),
        execution: DEFAULT_EXECUTION,
        sizing: DEFAULT_SIZING,
        tradeFrom: w.testFrom,
      });
      expect(test[i].metrics!.trades).toBe(expected.trades.length);
      capital = expected.equity[expected.equity.length - 1].equity;
      trades += expected.trades.length;
    }

    // The joined out-of-sample run holds every test trade and ends with the last test's equity.
    expect(oos.walkForward!.window).toBeNull();
    expect(oos.walkForward!.summary).toBeDefined();
    expect(oos.metrics!.trades).toBe(trades);
    const oosTrades = (await api().get(`/api/backtests/${oos.id}/trades`).expect(200))
      .body as TradeBody[];
    expect(oosTrades).toHaveLength(trades);
    const detail = (await api().get(`/api/backtests/${oos.id}`).expect(200)).body as RunBody;
    expect(detail.equityCurve!.at(-1)![1]).toBeCloseTo(capital, 0);

    // Walk-forward runs stay out of the default leaderboard; the joined run ranks under `oos`.
    const board = (await api().get('/api/backtests/leaderboard').expect(200)).body as RunBody[];
    expect(board).toHaveLength(0);
    const oosBoard = (
      await api().get('/api/backtests/leaderboard').query({ segment: 'oos' }).expect(200)
    ).body as RunBody[];
    expect(oosBoard.map((r) => r.id)).toEqual([oos.id]);

    // Train segments too short for the data (20 windows, 30% train) are rejected up front.
    await api()
      .post('/api/backtests/walk-forward')
      .send({
        symbol: 'GOLD',
        strategy: { code: 'trend_ema_adx' },
        paramGrid: grid,
        windows: 20,
        trainRatio: 0.3,
      })
      .expect(422);
  });

  it('rejects invalid requests before queueing anything', async () => {
    await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD'], strategies: [{ code: 'trend_ema_adx', params: { fast: 0 } }] })
      .expect(422);
    await api()
      .post('/api/backtests')
      .send({ symbols: ['NOPE'] })
      .expect(404);
    await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD'], strategies: [{ code: 'nope' }] })
      .expect(404);
    await api().post('/api/backtests').send({ symbols: [] }).expect(400);
    await api()
      .post('/api/backtests/sweep')
      .send({
        symbol: 'GOLD',
        strategy: { code: 'trend_ema_adx' },
        paramGrid: { fast: { min: 1, max: 100, step: 1 }, slow: { min: 1, max: 100, step: 1 } },
      })
      .expect(422);
    await api().get('/api/backtests/00000000-0000-0000-0000-000000000000').expect(404);
  });
});
