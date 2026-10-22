import request from 'supertest';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { STRATEGIES } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import { createTestApp, TestContext } from './setup/create-test-app';

interface SignalBody {
  symbol: string;
  strategy: string;
  configName: string;
  side: string;
  barTime: string;
}

interface StrategyBody {
  code: string;
  isBenchmark: boolean;
  paramsSchema: unknown;
  configs: { id: string; name: string; isActive: boolean }[];
}

interface SummaryBody {
  symbol: string;
  asOf: string;
  trend: { state: string; emaAlignment: string | null };
  strategies: { code: string; position: string }[];
  consensus: { long: number; flat: number; score: number };
}

const HOUR = 3600_000;

/** Real GC=F 4h bars (closed). */
const fourHour: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
  openTime: new Date(t * 1000),
  open,
  high,
  low,
  close,
  volume,
  isComplete: true,
}));

/** Splits each 4h bar into four identical 1h bars, so aggregation rebuilds the same 4h bars. */
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

/** Signals the domain layer produces for every default, non-benchmark strategy. */
const expectedSignalCount = STRATEGIES.filter((s) => !s.isBenchmark).reduce(
  (sum, s) => sum + s.evaluate(fourHour, s.defaultParams).length,
  0,
);

describe('Analysis (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    ctx.resolver.known.set('GOLD', {
      symbol: 'GOLD',
      name: 'Gold future',
      assetClass: AssetClass.Future,
      exchange: 'COMEX',
      currency: 'USD',
      sessionType: SessionType.Continuous,
      provider: 'fake',
    });
    ctx.provider.bars.set('GOLD', [...hourly]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** Registers GOLD; the backfill and signal generation run in the background. */
  const createGold = async (): Promise<string> => {
    const res = await api().post('/api/assets').send({ symbol: 'GOLD' }).expect(201);
    await ctx.idle();
    return (res.body as { id: string }).id;
  };

  const listSignals = async (query: Record<string, string | number> = {}) =>
    (
      await api()
        .get('/api/analysis/signals')
        .query({ symbol: 'GOLD', limit: 1000, ...query })
        .expect(200)
    ).body as SignalBody[];

  it('lists the strategy catalog with default configs', async () => {
    const res = await api().get('/api/analysis/strategies').expect(200);
    const strategies = res.body as StrategyBody[];
    expect(strategies.map((s) => s.code).sort()).toEqual(STRATEGIES.map((s) => s.code).sort());
    for (const s of strategies) {
      expect(s.paramsSchema).toBeTruthy();
      const def = s.configs.find((c) => c.name === 'default')!;
      expect(def.isActive).toBe(!s.isBenchmark);
    }
  });

  it('generates signals automatically after sync, matching the domain layer', async () => {
    await createGold();
    const signals = await listSignals();
    expect(signals.length).toBe(expectedSignalCount);
    expect(new Set(signals.map((s) => s.strategy)).size).toBe(5);
    expect(signals.every((s) => s.symbol === 'GOLD' && s.configName === 'default')).toBe(true);

    const bySide = await listSignals({ side: 'SELL', strategy: 'trend_ema_adx' });
    expect(bySide.every((s) => s.side === 'SELL' && s.strategy === 'trend_ema_adx')).toBe(true);
  });

  it('does not duplicate signals on re-sync', async () => {
    const assetId = await createGold();
    await api().post(`/api/market-data/sync/${assetId}`).expect(201);
    await ctx.idle();
    expect((await listSignals()).length).toBe(expectedSignalCount);
  });

  it('ignores the still-open bar', async () => {
    // A 1h bar in the current 4h bucket makes the latest 4h bar incomplete.
    const now = Date.now();
    const openBar = { ...hourly[hourly.length - 1], openTime: new Date(now - (now % HOUR)) };
    ctx.provider.bars.get('GOLD')!.push(openBar);
    await createGold();

    const bars = await api()
      .get('/api/market-data/bars')
      .query({ symbol: 'GOLD', timeframe: '4h', limit: 1 })
      .expect(200);
    const latest = (bars.body as { bars: { openTime: string; isComplete: boolean }[] }).bars[0];
    expect(latest.isComplete).toBe(false);

    const summary = (await api().get('/api/analysis/assets/GOLD/summary').expect(200))
      .body as SummaryBody;
    expect(new Date(summary.asOf).getTime()).toBeLessThan(new Date(latest.openTime).getTime());
    const signals = await listSignals();
    expect(signals.every((s) => s.barTime < latest.openTime)).toBe(true);
  });

  it('returns a summary and indicator series', async () => {
    await createGold();
    const summary = (await api().get('/api/analysis/assets/GOLD/summary').expect(200))
      .body as SummaryBody;
    expect(new Date(summary.asOf)).toEqual(fourHour[fourHour.length - 1].openTime);
    expect(['up', 'down', 'sideways']).toContain(summary.trend.state);
    expect(summary.strategies).toHaveLength(5);
    expect(summary.consensus.long + summary.consensus.flat).toBe(5);

    const indicators = await api()
      .get('/api/analysis/assets/GOLD/indicators')
      .query({ limit: 50 })
      .expect(200);
    const points = (indicators.body as { points: { openTime: string; ema200: number | null }[] })
      .points;
    expect(points).toHaveLength(50);
    expect(points.every((p) => p.ema200 !== null)).toBe(true);

    await api().get('/api/analysis/assets/NOPE/summary').expect(404);
  });

  it('manages configs and rebuilds signals', async () => {
    await createGold();
    const path = '/api/analysis/strategies/trend_ema_adx/configs';

    await api()
      .post(path)
      .send({ name: 'bad', params: { fast: 80, slow: 50 } })
      .expect(422);
    await api()
      .post('/api/analysis/strategies/nope/configs')
      .send({ name: 'x', params: {} })
      .expect(404);

    const created = await api()
      .post(path)
      .send({ name: 'fast', params: { fast: 10, slow: 30, trend: 100 } })
      .expect(201);
    const config = created.body as { id: string; params: Record<string, number> };
    expect(config.params).toMatchObject({ fast: 10, slow: 30, trend: 100, adxMin: 20 });
    await api().post(path).send({ name: 'fast', params: {} }).expect(409);

    const rebuilt = await api()
      .post('/api/analysis/signals/rebuild')
      .send({ symbol: 'GOLD', strategy: 'trend_ema_adx' })
      .expect(200);
    expect((rebuilt.body as { inserted: number }[])[0].inserted).toBeGreaterThan(0);
    const fast = (await listSignals({ strategy: 'trend_ema_adx' })).filter(
      (s) => s.configName === 'fast',
    );
    expect(fast.length).toBeGreaterThan(0);

    await api().patch(`/api/analysis/configs/${config.id}`).send({ isActive: false }).expect(200);
    const summary = (await api().get('/api/analysis/assets/GOLD/summary').expect(200))
      .body as SummaryBody;
    expect(summary.strategies).toHaveLength(5);

    const strategies = (await api().get('/api/analysis/strategies').expect(200))
      .body as StrategyBody[];
    const defaultId = strategies
      .find((s) => s.code === 'trend_ema_adx')!
      .configs.find((c) => c.name === 'default')!.id;
    await api()
      .patch(`/api/analysis/configs/${defaultId}`)
      .send({ params: { fast: 5 } })
      .expect(422);
  });
});
