import Decimal from 'decimal.js';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { findStrategy } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { runBacktest } from '../src/modules/backtesting/domain/engine';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
import { BROKER } from '../src/modules/trading/domain/broker.port';
import { DEFAULT_EXECUTION, DEFAULT_SIZING } from '../src/modules/trading/domain/execution';
import { createTestApp, TestContext } from './setup/create-test-app';

interface PortfolioBody {
  id: string;
  cash: string;
  equity: string;
  openPositions: number;
  positions: { assetId: string; symbol: string; quantity: string; stopLoss: number | null }[];
  subscriptions: { id: string; isActive: boolean; lastBarTime: string | null }[];
}

interface OrderBody {
  id: string;
  side: string;
  type: string;
  status: string;
  source: string;
  quantity: string | null;
  barTime: string | null;
  filledAt: string | null;
  signalId: string | null;
  rejectReason: string | null;
}

interface TradeBody {
  entryTime: string;
  exitTime: string;
  quantity: string;
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

/** Flat 1h bars from `start`, then the given [low] dips, one per 4h bucket. */
function flatHourly(start: number, hours: number, price = 100): RawBar[] {
  return Array.from({ length: hours }, (_, i) => ({
    openTime: new Date(start + i * HOUR),
    open: price,
    high: price + 0.5,
    low: price - 0.5,
    close: price,
    volume: 10,
  }));
}

const PERMISSIVE = {
  requireStopLoss: false,
  maxPositionPct: 100,
  maxOpenPositions: 5,
  maxDailyLossPct: 100,
};

describe('Portfolios / paper trading (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

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

  /** Makes more bars available and syncs, as the scheduler would. */
  const extend = async (symbol: string, assetId: string, bars: RawBar[]): Promise<void> => {
    ctx.provider.bars.set(symbol, bars);
    await api().post(`/api/market-data/sync/${assetId}`).expect(201);
    await ctx.idle();
  };

  const createPortfolio = async (name: string, riskRules: object = PERMISSIVE) =>
    (await api().post('/api/portfolios').send({ name, initialCash: 10_000, riskRules }).expect(201))
      .body as PortfolioBody;

  const configId = async (code: string): Promise<string> => {
    const res = await api().get('/api/analysis/strategies').expect(200);
    const strategies = res.body as { code: string; configs: { id: string; name: string }[] }[];
    return strategies.find((s) => s.code === code)!.configs.find((c) => c.name === 'default')!.id;
  };

  const orders = async (portfolioId: string) =>
    (await api().get(`/api/portfolios/${portfolioId}/orders`).expect(200)).body as OrderBody[];

  const trades = async (portfolioId: string) =>
    (await api().get(`/api/portfolios/${portfolioId}/trades`).expect(200)).body as TradeBody[];

  it('trades a strategy subscription exactly like a backtest of the same bars', async () => {
    const start = 400;
    const assetId = await register('GOLD', hourlyOf(fourHour.slice(0, start)));
    const portfolio = await createPortfolio('parity');
    const trendId = await configId('trend_ema_adx');
    const sub = await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: trendId, symbol: 'GOLD' })
      .expect(201);
    expect((sub.body as { lastBarTime: string }).lastBarTime).toBe(
      fourHour[start - 1].openTime.toISOString(),
    );

    // New bars arrive over several syncs.
    for (const end of [700, 1100, fourHour.length]) {
      await extend('GOLD', assetId, hourlyOf(fourHour.slice(0, end)));
    }

    const strategy = findStrategy('trend_ema_adx')!;
    const backtest = runBacktest({
      bars: fourHour,
      runner: strategy.createRunner(fourHour, strategy.defaultParams),
      initialCapital: 10_000,
      execution: DEFAULT_EXECUTION,
      sizing: DEFAULT_SIZING,
      tradeFrom: start,
    });
    const expected = backtest.trades.filter((t) => t.exitReason !== 'end_of_data');
    expect(expected.length).toBeGreaterThan(3);

    const paper = (await trades(portfolio.id)).reverse();
    expect(paper).toHaveLength(expected.length);
    paper.forEach((trade, i) => {
      expect(trade.entryTime).toBe(expected[i].entryTime.toISOString());
      expect(trade.exitTime).toBe(expected[i].exitTime.toISOString());
      expect(trade.exitReason).toBe(expected[i].exitReason);
      expect(new Decimal(trade.quantity).eq(expected[i].quantity)).toBe(true);
      expect(new Decimal(trade.pnl).eq(expected[i].pnl)).toBe(true);
    });

    // Every automatic order filled at a bar after the bar that decided it.
    const all = await orders(portfolio.id);
    const filledEntries = all.filter((o) => o.side === 'BUY' && o.status === 'filled');
    expect(filledEntries.length).toBeGreaterThanOrEqual(expected.length);
    for (const o of filledEntries) {
      expect(new Date(o.filledAt!).getTime()).toBeGreaterThan(new Date(o.barTime!).getTime());
    }

    // Processing the same bars again creates nothing new.
    await api().post(`/api/portfolios/${portfolio.id}/process`).expect(201);
    expect(await orders(portfolio.id)).toHaveLength(all.length);
    expect(await trades(portfolio.id)).toHaveLength(expected.length);
  });

  it('turns stored signals into orders with source=signals', async () => {
    const start = 400;
    const assetId = await register('GOLD', hourlyOf(fourHour.slice(0, start)));
    const portfolio = await createPortfolio('signals');
    const trendId = await configId('trend_ema_adx');
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({
        strategyConfigId: trendId,
        symbol: 'GOLD',
        source: 'signals',
      })
      .expect(201);
    await extend('GOLD', assetId, hourlyOf(fourHour));

    const signalOrders = (await orders(portfolio.id)).filter((o) => o.source === 'signal');
    expect(signalOrders.length).toBeGreaterThan(0);
    // Each order points at the stored signal of the bar that produced it.
    expect(signalOrders.every((o) => o.signalId !== null)).toBe(true);
    expect((await trades(portfolio.id)).length).toBeGreaterThan(0);
  });

  it('applies risk rules, fills manual orders and triggers a stop-loss on a later bar', async () => {
    const t0 = Date.UTC(2026, 8, 1);
    const assetId = await register('FLAT', flatHourly(t0, 48));
    const strict = await createPortfolio('strict', {});

    // Default rules require a stop-loss.
    const noStop = await api()
      .post(`/api/portfolios/${strict.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'market', quantity: '10' })
      .expect(201);
    expect(noStop.body).toMatchObject({ status: 'rejected', rejectReason: 'no_stop_loss' });

    // 25% max position: 100 units at ~100 are resized to about 25.
    const buy = await api()
      .post(`/api/portfolios/${strict.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'market', quantity: '100', stopLoss: 95 })
      .expect(201);
    const order = buy.body as OrderBody;
    expect(order.status).toBe('filled');
    expect(Number(order.quantity)).toBeLessThan(25);
    expect(Number(order.quantity)).toBeGreaterThan(24.5);

    const detail = (await api().get(`/api/portfolios/${strict.id}`).expect(200))
      .body as PortfolioBody;
    expect(detail.positions).toMatchObject([{ symbol: 'FLAT', stopLoss: 95 }]);

    // A later 4h bucket dips to 90: the stop fills at 95 minus slippage.
    const dip = flatHourly(t0 + 48 * HOUR, 4).map((b, i) => (i === 1 ? { ...b, low: 90 } : b));
    await extend('FLAT', assetId, [...flatHourly(t0, 48), ...dip]);

    const closed = await trades(strict.id);
    expect(closed).toHaveLength(1);
    expect(closed[0].exitReason).toBe('stop_loss');
    const after = (await api().get(`/api/portfolios/${strict.id}`).expect(200))
      .body as PortfolioBody;
    expect(after.openPositions).toBe(0);
    expect(Number(after.cash)).toBeLessThan(10_000);
    expect((await orders(strict.id)).find((o) => o.source === 'stop_loss')?.status).toBe('filled');
  });

  it('fills limit orders on later bars, cancels pending ones and closes positions', async () => {
    const t0 = Date.UTC(2026, 8, 1);
    const assetId = await register('FLAT', flatHourly(t0, 48));
    const portfolio = await createPortfolio('manual');

    const limit = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'limit', limitPrice: 97, notional: '1000' })
      .expect(201);
    expect((limit.body as OrderBody).status).toBe('pending');
    const far = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'limit', limitPrice: 50, quantity: '1' })
      .expect(201);
    await api()
      .delete(`/api/portfolios/${portfolio.id}/orders/${(far.body as OrderBody).id}`)
      .expect(204);
    await api()
      .delete(`/api/portfolios/${portfolio.id}/orders/${(far.body as OrderBody).id}`)
      .expect(409);

    // Orders placed now only see bars that open later: an open (future) bucket does not fill it.
    // The next 4h bucket starts after now, so none of its bars exist yet.
    const now = Date.now();
    const future = now - (now % (4 * HOUR)) + 4 * HOUR;
    const futureDip = flatHourly(future, 4).map((b, i) => (i === 2 ? { ...b, low: 96 } : b));
    await extend('FLAT', assetId, [...flatHourly(t0, 48), ...futureDip]);
    const limitId = (limit.body as OrderBody).id;
    expect((await orders(portfolio.id)).find((o) => o.id === limitId)?.status).toBe('pending');
    expect(
      (await orders(portfolio.id)).find((o) => o.id === (far.body as OrderBody).id)?.status,
    ).toBe('cancelled');

    // Pretend the order was placed before a closed bucket that dips to 96: it fills at the limit.
    await ctx.app
      .get(DataSource)
      .query('UPDATE orders SET created_at = $1 WHERE id = $2', [
        new Date(t0 + 48 * HOUR),
        limitId,
      ]);
    const dip = flatHourly(t0 + 48 * HOUR, 4).map((b, i) => (i === 2 ? { ...b, low: 96 } : b));
    await extend('FLAT', assetId, [...flatHourly(t0, 48), ...dip, ...futureDip]);
    const filled = (await orders(portfolio.id)).find((o) => o.id === limitId)!;
    expect(filled).toMatchObject({
      status: 'filled',
      filledAt: new Date(t0 + 48 * HOUR).toISOString(),
    });
    const fills = (await api().get(`/api/portfolios/${portfolio.id}/fills`).expect(200)).body as {
      price: number;
      quantity: string;
    }[];
    expect(fills[0].price).toBe(97);
    expect(Number(fills[0].quantity)).toBeCloseTo(1000 / 97, 6);

    // A second BUY on the same asset is rejected; closing sells the whole position.
    const second = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'market', notional: '2000' })
      .expect(201);
    expect(second.body).toMatchObject({ status: 'rejected', rejectReason: 'position_exists' });

    const close = await api()
      .post(`/api/portfolios/${portfolio.id}/positions/${assetId}/close`)
      .expect(201);
    expect(close.body).toMatchObject({ side: 'SELL', status: 'filled' });
    const closed = await trades(portfolio.id);
    expect(closed).toMatchObject([{ exitReason: 'manual' }]);
    // Selling without a position is rejected.
    const again = await api()
      .post(`/api/portfolios/${portfolio.id}/positions/${assetId}/close`)
      .expect(201);
    expect(again.body).toMatchObject({ status: 'rejected', rejectReason: 'no_position' });
  });

  it('keeps the position when a subscription is removed', async () => {
    const start = 400;
    const assetId = await register('GOLD', hourlyOf(fourHour.slice(0, start)));
    const portfolio = await createPortfolio('unsubscribe');
    const trendId = await configId('trend_ema_adx');
    const sub = (
      await api()
        .post(`/api/portfolios/${portfolio.id}/subscriptions`)
        .send({ strategyConfigId: trendId, symbol: 'GOLD' })
        .expect(201)
    ).body as { id: string };
    // Advance until the strategy holds a position.
    let end = start;
    let held: PortfolioBody | undefined;
    while (end < fourHour.length && !held) {
      end += 25;
      await extend('GOLD', assetId, hourlyOf(fourHour.slice(0, end)));
      const detail = (await api().get(`/api/portfolios/${portfolio.id}`).expect(200))
        .body as PortfolioBody;
      if (detail.openPositions > 0) held = detail;
    }
    expect(held).toBeDefined();

    await api().delete(`/api/portfolios/${portfolio.id}/subscriptions/${sub.id}`).expect(204);
    const detail = (await api().get(`/api/portfolios/${portfolio.id}`).expect(200))
      .body as PortfolioBody;
    expect(detail.openPositions).toBe(1);
    expect(detail.subscriptions[0].isActive).toBe(false);
    expect(
      (await orders(portfolio.id)).filter((o) => o.status === 'pending' && o.source === 'signal'),
    ).toHaveLength(0);
  });

  it('rolls back the whole fill when a write fails', async () => {
    const assetId = await register('FLAT', flatHourly(Date.UTC(2026, 8, 1), 8));
    const portfolio = await createPortfolio('rollback');
    const broker = ctx.app.get<{ fill: () => Promise<void> }>(BROKER);
    const spy = vi.spyOn(broker, 'fill').mockRejectedValueOnce(new Error('disk full'));
    await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'market', notional: '1000' })
      .expect(500);
    spy.mockRestore();

    const detail = (await api().get(`/api/portfolios/${portfolio.id}`).expect(200))
      .body as PortfolioBody;
    expect(detail).toMatchObject({ cash: '10000.00', openPositions: 0 });
    expect(await orders(portfolio.id)).toHaveLength(0);
    // The same order goes through afterwards.
    await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'market', notional: '1000' })
      .expect(201);
    expect(
      (await api().get(`/api/portfolios/${portfolio.id}/positions`).expect(200)).body,
    ).toMatchObject([{ assetId }]);
  });

  it('validates requests', async () => {
    await register('FLAT', flatHourly(Date.UTC(2026, 8, 1), 8));
    const portfolio = await createPortfolio('validation');
    await api().post('/api/portfolios').send({ name: 'validation', initialCash: 5 }).expect(409);
    await api().post('/api/portfolios').send({ name: 'x', initialCash: -1 }).expect(400);
    await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'limit', quantity: '1' })
      .expect(422);
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: '00000000-0000-4000-8000-000000000000', symbol: 'FLAT' })
      .expect(404);
  });
});
