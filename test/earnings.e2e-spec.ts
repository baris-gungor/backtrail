import request from 'supertest';
import { findStrategy } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { runBacktest } from '../src/modules/backtesting/domain/engine';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import {
  DEFAULT_EXECUTION,
  DEFAULT_SIZING,
  earningsFilter,
} from '../src/modules/trading/domain/execution';
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

/**
 * A company on the gold fixture: an equity (so it has earnings) with continuous 4h bars, which
 * keeps the bars as they are. Reports every 60 bars, an hour after a bar opens.
 */
const REPORTS = fourHour
  .filter((_, i) => i >= 300 && i % 60 === 0)
  .map((b) => new Date(b.openTime.getTime() + HOUR));
const RULE = { exitBefore: true, blockEntryDays: 0 };
const PERMISSIVE = {
  requireStopLoss: false,
  maxPositionPct: 100,
  maxOpenPositions: 5,
  maxDailyLossPct: 100,
};

interface TradeBody {
  entryTime: string;
  exitTime: string;
  exitReason: string;
}

describe('Earnings filter (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());
  const trend = findStrategy('trend_ema_adx')!;
  const expectedRun = (tradeFrom = 0) =>
    runBacktest({
      bars: fourHour,
      runner: trend.createRunner(fourHour, trend.defaultParams),
      initialCapital: 10_000,
      execution: DEFAULT_EXECUTION,
      sizing: DEFAULT_SIZING,
      tradeFrom,
      filter: earningsFilter(fourHour, REPORTS, RULE, SessionType.Continuous),
    });

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    ctx.resolver.known.set('ACME', {
      symbol: 'ACME',
      name: 'Acme Corp',
      assetClass: AssetClass.Equity,
      exchange: 'X',
      currency: 'USD',
      sessionType: SessionType.Continuous,
      provider: 'fake',
    });
    ctx.earnings.reports.set('ACME', REPORTS);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const register = async (bars: Bar[]): Promise<string> => {
    ctx.provider.bars.set('ACME', hourlyOf(bars));
    const res = await api().post('/api/assets').send({ symbol: 'ACME' }).expect(201);
    await ctx.idle();
    return (res.body as { id: string }).id;
  };

  it('stores report times on sync and serves them', async () => {
    await register(fourHour);
    const res = await api().get('/api/market-data/earnings').query({ symbol: 'ACME' }).expect(200);
    const body = res.body as { applies: boolean; reports: string[] };
    expect(body.applies).toBe(true);
    expect(body.reports).toEqual(REPORTS.map((r) => r.toISOString()));
  });

  it('backtests with the filter exactly like the engine', async () => {
    await register(fourHour);
    const submit = await api()
      .post('/api/backtests')
      .send({
        symbols: ['ACME'],
        strategies: [{ code: 'trend_ema_adx', config: 'default' }],
        earnings: RULE,
      })
      .expect(201);
    await ctx.idle();
    const batch = (
      await api()
        .get(`/api/backtests/batches/${(submit.body as { batchId: string }).batchId}`)
        .expect(200)
    ).body as { runs: { id: string; status: string }[] };
    const [run] = batch.runs;
    expect(run.status).toBe('success');

    const expected = expectedRun().trades;
    expect(expected.some((t) => t.exitReason === 'earnings')).toBe(true);
    const trades = (await api().get(`/api/backtests/${run.id}/trades`).expect(200))
      .body as TradeBody[];
    expect(trades.map((t) => [t.entryTime, t.exitTime, t.exitReason])).toEqual(
      expected.map((t) => [t.entryTime.toISOString(), t.exitTime.toISOString(), t.exitReason]),
    );
  });

  it('paper trades with the filter exactly like the backtest', async () => {
    const start = 400;
    const assetId = await register(fourHour.slice(0, start));
    const portfolio = (
      await api()
        .post('/api/portfolios')
        .send({
          name: 'earnings',
          initialCash: 10_000,
          riskRules: { ...PERMISSIVE, earningsExit: true },
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
      .send({ strategyConfigId: configId, symbol: 'ACME' })
      .expect(201);

    for (const end of [700, 1100, fourHour.length]) {
      ctx.provider.bars.set('ACME', hourlyOf(fourHour.slice(0, end)));
      await api().post(`/api/market-data/sync/${assetId}`).expect(201);
      await ctx.idle();
    }

    const expected = expectedRun(start).trades.filter((t) => t.exitReason !== 'end_of_data');
    expect(expected.some((t) => t.exitReason === 'earnings')).toBe(true);
    const paper = (
      (await api().get(`/api/portfolios/${portfolio.id}/trades`).expect(200)).body as TradeBody[]
    ).reverse();
    expect(paper.map((t) => [t.entryTime, t.exitTime, t.exitReason])).toEqual(
      expected.map((t) => [t.entryTime.toISOString(), t.exitTime.toISOString(), t.exitReason]),
    );
  });
});
