import request from 'supertest';
import { findStrategy } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { adjustRolls } from '../src/modules/backtesting/domain/data-quality';
import { runBacktest } from '../src/modules/backtesting/domain/engine';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import { DEFAULT_EXECUTION, DEFAULT_SIZING } from '../src/modules/trading/domain/execution';
import { createTestApp, TestContext } from './setup/create-test-app';

const HOUR = 3600_000;

const real: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
  openTime: new Date(t * 1000),
  open,
  high,
  low,
  close,
  volume,
  isComplete: true,
}));
/** A synthetic contract roll: from a mid-week bar on, prices are 6% higher. */
const ROLL = real.findIndex(
  (b, i) => i > 1000 && b.openTime.getTime() - real[i - 1].openTime.getTime() === 4 * HOUR,
);
const fourHour: Bar[] = real.map((b, i) =>
  i < ROLL
    ? b
    : { ...b, open: b.open * 1.06, high: b.high * 1.06, low: b.low * 1.06, close: b.close * 1.06 },
);

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

interface AssetBody {
  id: string;
  symbol: string;
  proxyForId: string | null;
}

describe('Commodities (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    const known = (symbol: string, assetClass: AssetClass, sessionType: SessionType) =>
      ctx.resolver.known.set(symbol, {
        symbol,
        name: symbol,
        assetClass,
        exchange: 'X',
        currency: 'USD',
        sessionType,
        provider: 'fake',
      });
    known('GC=F', AssetClass.Future, SessionType.Continuous);
    known('GLD', AssetClass.Etf, SessionType.UsEquity);
    known('SPY', AssetClass.Etf, SessionType.UsEquity);
    ctx.provider.bars.set('GC=F', [...hourly]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const create = async (symbol: string): Promise<AssetBody> => {
    const res = await api().post('/api/assets').send({ symbol }).expect(201);
    await ctx.idle();
    return res.body as AssetBody;
  };
  const get = async (id: string) =>
    (await api().get(`/api/assets/${id}`).expect(200)).body as AssetBody;

  it('links a known ETF proxy to its futures in either registration order', async () => {
    const gld = await create('GLD');
    expect(gld.proxyForId).toBeNull();
    const gold = await create('GC=F');
    expect((await get(gld.id)).proxyForId).toBe(gold.id);

    // Removed by hand, and set again.
    await api().patch(`/api/assets/${gld.id}`).send({ proxyFor: null }).expect(200);
    expect((await get(gld.id)).proxyForId).toBeNull();
    await api().patch(`/api/assets/${gld.id}`).send({ proxyFor: 'GC=F' }).expect(200);
    expect((await get(gld.id)).proxyForId).toBe(gold.id);

    // Registered after the futures: linked at creation.
    await api().delete(`/api/assets/${gld.id}`).expect(204);
    expect((await create('GLD')).proxyForId).toBe(gold.id);
  });

  it('only links to futures assets', async () => {
    const spy = await create('SPY');
    const gld = await create('GLD');
    await api().patch(`/api/assets/${gld.id}`).send({ proxyFor: 'SPY' }).expect(422);
    await api().patch(`/api/assets/${spy.id}`).send({ proxyFor: 'SPY' }).expect(422);
    // isActive alone still works.
    await api().patch(`/api/assets/${spy.id}`).send({ isActive: false }).expect(200);
  });

  it('lists the known commodity proxies', async () => {
    const res = await api().get('/api/assets/commodity-proxies').expect(200);
    expect(res.body).toContainEqual({ futures: 'GC=F', etf: 'GLD', name: 'Gold' });
  });

  it('backtests on roll-adjusted prices when asked', async () => {
    await create('GC=F');
    const submit = await api()
      .post('/api/backtests')
      .send({
        symbols: ['GC=F'],
        strategies: [{ code: 'trend_ema_adx', config: 'default' }],
        adjustRolls: true,
      })
      .expect(201);
    await ctx.idle();
    const batch = (
      await api()
        .get(`/api/backtests/batches/${(submit.body as { batchId: string }).batchId}`)
        .expect(200)
    ).body as {
      runs: {
        status: string;
        execution: { adjustRolls?: boolean };
        metrics: { trades: number; dataQuality: { jumps: number; rollAdjustments?: number } };
      }[];
    };
    const [run] = batch.runs;
    expect(run.status).toBe('success');
    expect(run.execution.adjustRolls).toBe(true);

    // Same as the engine on the adjusted series; data quality still reports the raw jumps.
    const { bars, rolls } = adjustRolls(fourHour);
    const trend = findStrategy('trend_ema_adx')!;
    const expected = runBacktest({
      bars,
      runner: trend.createRunner(bars, trend.defaultParams),
      initialCapital: 10_000,
      execution: DEFAULT_EXECUTION,
      sizing: DEFAULT_SIZING,
    });
    expect(rolls).toEqual([ROLL]);
    expect(run.metrics.trades).toBe(expected.trades.length);
    expect(run.metrics.dataQuality.rollAdjustments).toBe(1);
    expect(run.metrics.dataQuality.jumps).toBe(1);

    // A raw run with the same params is a separate leaderboard entry, not a replacement.
    await api()
      .post('/api/backtests')
      .send({ symbols: ['GC=F'], strategies: [{ code: 'trend_ema_adx', config: 'default' }] })
      .expect(201);
    await ctx.idle();
    const board = (await api().get('/api/backtests/leaderboard').expect(200)).body as unknown[];
    expect(board).toHaveLength(2);
  });
});
