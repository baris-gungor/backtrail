import Decimal from 'decimal.js';
import request from 'supertest';
import { findStrategy } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { runBacktest } from '../src/modules/backtesting/domain/engine';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import { DEFAULT_EXECUTION, DEFAULT_SIZING } from '../src/modules/trading/domain/execution';
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

const PERMISSIVE = {
  requireStopLoss: false,
  maxPositionPct: 100,
  maxOpenPositions: 5,
  maxDailyLossPct: 100,
};

interface TradeBody {
  side: string;
  entryTime: string;
  exitTime: string;
  exitReason: string;
  quantity: string;
  pnl: string;
}

/** Short positions: backtest API, paper parity and the demo broker. */
describe('Short positions (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());
  const trend = findStrategy('trend_ema_adx')!;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const register = async (
    symbol: string,
    bars: RawBar[],
    sessionType = SessionType.Continuous,
  ): Promise<string> => {
    ctx.resolver.known.set(symbol, {
      symbol,
      name: symbol,
      assetClass: sessionType === SessionType.UsEquity ? AssetClass.Etf : AssetClass.Future,
      exchange: 'X',
      currency: 'USD',
      sessionType,
      provider: 'fake',
    });
    ctx.provider.bars.set(symbol, bars);
    const res = await api().post('/api/assets').send({ symbol }).expect(201);
    await ctx.idle();
    return (res.body as { id: string }).id;
  };

  const configId = async (code: string): Promise<string> => {
    const res = await api().get('/api/analysis/strategies').expect(200);
    const strategies = res.body as { code: string; configs: { id: string; name: string }[] }[];
    return strategies.find((s) => s.code === code)!.configs.find((c) => c.name === 'default')!.id;
  };

  const expectedTrades = (tradeFrom: number, borrowPct = 0) =>
    runBacktest({
      bars: fourHour,
      runner: trend.createRunner(fourHour, trend.defaultParams),
      initialCapital: 10_000,
      execution: { ...DEFAULT_EXECUTION, borrowPct },
      sizing: DEFAULT_SIZING,
      tradeFrom,
      direction: 'both',
    }).trades;

  it('backtests both directions exactly like the engine and rejects shorts without rules', async () => {
    await register('GOLD', hourlyOf(fourHour));
    await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD'], strategies: [{ code: 'meanrev_bb_rsi' }], direction: 'short' })
      .expect(422);

    const submit = await api()
      .post('/api/backtests')
      .send({
        symbols: ['GOLD'],
        strategies: [{ code: 'trend_ema_adx', config: 'default' }],
        direction: 'both',
        execution: { borrowPct: 2 },
      })
      .expect(201);
    await ctx.idle();
    const batch = (
      await api()
        .get(`/api/backtests/batches/${(submit.body as { batchId: string }).batchId}`)
        .expect(200)
    ).body as { runs: { id: string; status: string; execution: { direction?: string } }[] };
    const [run] = batch.runs;
    expect(run).toMatchObject({ status: 'success', execution: { direction: 'both' } });

    const expected = expectedTrades(0, 2);
    expect(expected.some((t) => t.side === 'short')).toBe(true);
    const trades = (await api().get(`/api/backtests/${run.id}/trades`).expect(200))
      .body as TradeBody[];
    expect(trades.map((t) => [t.side, t.entryTime, t.exitTime, t.exitReason, t.pnl])).toEqual(
      expected.map((t) => [
        t.side,
        t.entryTime.toISOString(),
        t.exitTime.toISOString(),
        t.exitReason,
        t.pnl.toFixed(2),
      ]),
    );
  });

  it('paper trades a short subscription exactly like the backtest', async () => {
    const start = 400;
    const assetId = await register('GOLD', hourlyOf(fourHour.slice(0, start)));
    const trendId = await configId('trend_ema_adx');
    const meanrevId = await configId('meanrev_bb_rsi');
    const create = (name: string, allowShort: boolean) =>
      api()
        .post('/api/portfolios')
        .send({ name, initialCash: 10_000, riskRules: { ...PERMISSIVE, allowShort } })
        .expect(201)
        .then((r) => (r.body as { id: string }).id);

    // Shorts need the portfolio switch, short rules and source=strategy.
    const longOnly = await create('long-only', false);
    await api()
      .post(`/api/portfolios/${longOnly}/subscriptions`)
      .send({ strategyConfigId: trendId, symbol: 'GOLD', direction: 'both' })
      .expect(422);
    const portfolio = await create('shorts', true);
    await api()
      .post(`/api/portfolios/${portfolio}/subscriptions`)
      .send({
        strategyConfigId: meanrevId,
        symbol: 'GOLD',
        direction: 'short',
      })
      .expect(422);
    await api()
      .post(`/api/portfolios/${portfolio}/subscriptions`)
      .send({ strategyConfigId: trendId, symbol: 'GOLD', direction: 'both', source: 'signals' })
      .expect(422);
    await api()
      .post(`/api/portfolios/${portfolio}/subscriptions`)
      .send({ strategyConfigId: trendId, symbol: 'GOLD', direction: 'both' })
      .expect(201);

    for (const end of [700, 1100, fourHour.length]) {
      ctx.provider.bars.set('GOLD', hourlyOf(fourHour.slice(0, end)));
      await api().post(`/api/market-data/sync/${assetId}`).expect(201);
      await ctx.idle();
    }

    const expected = expectedTrades(start).filter((t) => t.exitReason !== 'end_of_data');
    expect(expected.some((t) => t.side === 'short')).toBe(true);
    const paper = (
      (await api().get(`/api/portfolios/${portfolio}/trades`).expect(200)).body as TradeBody[]
    ).reverse();
    expect(paper.map((t) => [t.side, t.entryTime, t.exitTime, t.exitReason])).toEqual(
      expected.map((t) => [
        t.side,
        t.entryTime.toISOString(),
        t.exitTime.toISOString(),
        t.exitReason,
      ]),
    );
    paper.forEach((t, i) => expect(new Decimal(t.pnl).eq(expected[i].pnl)).toBe(true));

    // Short entries sell, covers buy.
    const orders = (await api().get(`/api/portfolios/${portfolio}/orders`).expect(200)).body as {
      side: string;
      status: string;
      clientOrderId?: string;
    }[];
    const filled = orders.filter((o) => o.status === 'filled');
    const shorts = expected.filter((t) => t.side === 'short').length;
    expect(filled.filter((o) => o.side === 'SELL').length).toBeGreaterThanOrEqual(shorts);
  });

  it('sells short through the demo broker and covers on the stop leg', async () => {
    // Alpaca trades only US equities and ETFs, so the fixture is laid out as US-session bars.
    const assetId = await register('SHRT', sessionBars(600, 400), SessionType.UsEquity);
    const portfolio = (
      await api()
        .post('/api/portfolios')
        .send({
          name: 'demo-short',
          mode: 'alpaca_paper',
          riskRules: { ...PERMISSIVE, allowShort: true },
        })
        .expect(201)
    ).body as { id: string };
    const trendId = await configId('trend_ema_adx');

    ctx.alpaca.unshortable.add('SHRT');
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: trendId, symbol: 'SHRT', direction: 'short' })
      .expect(422);
    ctx.alpaca.unshortable.clear();
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: trendId, symbol: 'SHRT', direction: 'short' })
      .expect(201);

    const detail = async () =>
      (await api().get(`/api/portfolios/${portfolio.id}`).expect(200)).body as {
        cash: string;
        positions: { quantity: string; stopLoss: number | null }[];
      };
    let n = 400;
    while (n < 600 && (await detail()).positions.length === 0) {
      n += 10;
      const raw = sessionBars(600, n);
      ctx.provider.bars.set('SHRT', raw);
      ctx.alpaca.prices.set('SHRT', raw.at(-1)!.close);
      await api().post(`/api/market-data/sync/${assetId}`).expect(201);
      await ctx.idle();
    }
    const held = await detail();
    expect(held.positions).toHaveLength(1);
    const [entry] = ctx.alpaca.submitted;
    expect(entry).toMatchObject({ symbol: 'SHRT', side: 'sell', type: 'market' });
    expect(entry.stop_loss).toBeDefined();
    // A short's stop is above the price.
    expect(Number(entry.stop_loss!.stop_price)).toBeGreaterThan(ctx.alpaca.prices.get('SHRT')!);
    expect(held.positions[0].quantity).toBe(`-${entry.qty}`);
    expect(ctx.alpaca.positions.get('SHRT')!.toString()).toBe(`-${entry.qty}`);

    const reconciled = async () =>
      (
        (await api().get(`/api/portfolios/${portfolio.id}/broker`).expect(200)).body as {
          reconciliations: { status: string }[];
        }
      ).reconciliations[0].status;
    expect(await reconciled()).toBe('ok');

    ctx.alpaca.triggerLeg('SHRT', 'stop_loss');
    await ctx.idle();
    const trades = (await api().get(`/api/portfolios/${portfolio.id}/trades`).expect(200))
      .body as TradeBody[];
    expect(trades).toMatchObject([{ side: 'short', exitReason: 'stop_loss', quantity: entry.qty }]);
    expect(new Decimal(trades[0].pnl).isNeg()).toBe(true);
    const closed = await detail();
    expect(closed.positions).toHaveLength(0);
    expect(new Decimal(closed.cash).toFixed(2)).toBe(ctx.alpaca.cash.toFixed(2));
    expect(await reconciled()).toBe('ok');
  });
});

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

function newYork(day: Date, hour: number, minute: number): Date {
  let guess = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate(), hour + 5, minute);
  for (let i = 0; i < 2; i++) {
    const parts = Object.fromEntries(
      nyClock.formatToParts(new Date(guess)).map((p) => [p.type, Number(p.value)]),
    );
    guess += ((hour - parts.hour) * 60 + (minute - parts.minute)) * 60_000;
  }
  return new Date(guess);
}

/** The last `total` fixture bars as US-session 1h bars (two 4h buckets a weekday), first `n`. */
function sessionBars(total: number, n: number): RawBar[] {
  const source = fixture.slice(-total);
  const days: Date[] = [];
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  while (days.length < Math.ceil(total / 2)) {
    day.setUTCDate(day.getUTCDate() - 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) days.unshift(new Date(day));
  }
  return source.slice(0, n).flatMap(([, open, high, low, close, volume], k) => {
    const hours = k % 2 === 0 ? [9, 10, 11, 12] : [13, 14, 15];
    return hours.map((h) => ({
      openTime: newYork(days[Math.floor(k / 2)], h, 30),
      open,
      high,
      low,
      close,
      volume: volume / hours.length,
    }));
  });
}
