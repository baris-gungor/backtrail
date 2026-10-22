import Decimal from 'decimal.js';
import request from 'supertest';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { AlpacaBroker } from '../src/modules/trading/infrastructure/alpaca-broker';
import type { RawBar } from '../src/modules/market-data/domain/bar';
import { createTestApp, TestContext } from './setup/create-test-app';

interface OrderBody {
  id: string;
  side: string;
  status: string;
  source: string;
  quantity: string | null;
  rejectReason: string | null;
}
interface PortfolioBody {
  id: string;
  mode: string;
  cash: string;
  haltedAt: string | null;
  positions: { symbol: string; quantity: string; stopLoss: number | null }[];
}

const nyClock = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/New_York',
  hourCycle: 'h23',
  hour: '2-digit',
  minute: '2-digit',
});

/** UTC time of a New York wall-clock time on a calendar day (DST-aware). */
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

/**
 * The GC=F fixture's 4h bars laid out as a US session: two 4h buckets per weekday (09:30–13:30
 * with four 1h bars, 13:30–16:00 with three). The strategy then sees the fixture's bar sequence.
 */
function sessionBars(count: number): RawBar[] {
  const source = fixture.slice(-count);
  const days: Date[] = [];
  const day = new Date();
  day.setUTCHours(0, 0, 0, 0);
  while (days.length < Math.ceil(count / 2)) {
    day.setUTCDate(day.getUTCDate() - 1);
    if (day.getUTCDay() !== 0 && day.getUTCDay() !== 6) days.unshift(new Date(day));
  }
  return source.flatMap(([, open, high, low, close, volume], k) => {
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

const PERMISSIVE = { requireStopLoss: false, maxPositionPct: 100, maxDailyLossPct: 100 };

describe('Alpaca demo broker (e2e, fake client)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());
  const bars = sessionBars(600);
  /** 1h bars of the first `n` 4h bars (4 + 3 per day). */
  const upTo = (n: number) => bars.slice(0, Math.floor(n / 2) * 7 + (n % 2) * 4);

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
    rawBars: RawBar[],
    sessionType = SessionType.UsEquity,
  ): Promise<string> => {
    ctx.resolver.known.set(symbol, {
      symbol,
      name: symbol,
      assetClass: sessionType === SessionType.UsEquity ? AssetClass.Etf : AssetClass.Future,
      exchange: 'NYSE',
      currency: 'USD',
      sessionType,
      provider: 'fake',
    });
    ctx.provider.bars.set(symbol, rawBars);
    const res = await api().post('/api/assets').send({ symbol }).expect(201);
    await ctx.idle();
    return (res.body as { id: string }).id;
  };

  const extend = async (symbol: string, assetId: string, raw: RawBar[]) => {
    ctx.provider.bars.set(symbol, raw);
    ctx.alpaca.prices.set(symbol, raw.at(-1)!.close);
    await api().post(`/api/market-data/sync/${assetId}`).expect(201);
    await ctx.idle();
  };

  const createDemo = async (name = 'demo') =>
    (
      await api()
        .post('/api/portfolios')
        .send({ name, mode: 'alpaca_paper', riskRules: PERMISSIVE })
        .expect(201)
    ).body as PortfolioBody;

  const trendConfigId = async () => {
    const res = await api().get('/api/analysis/strategies').expect(200);
    return (res.body as { code: string; configs: { id: string; name: string }[] }[])
      .find((s) => s.code === 'trend_ema_adx')!
      .configs.find((c) => c.name === 'default')!.id;
  };

  const orders = async (id: string) =>
    (await api().get(`/api/portfolios/${id}/orders`).expect(200)).body as OrderBody[];

  const detail = async (id: string) =>
    (await api().get(`/api/portfolios/${id}`).expect(200)).body as PortfolioBody;

  it('sends strategy entries as bracket orders, books fills and closes on the stop leg', async () => {
    const assetId = await register('SPYX', upTo(400));
    const portfolio = await createDemo();
    expect(portfolio).toMatchObject({ mode: 'alpaca_paper', cash: '100000.00' });
    const configId = await trendConfigId();
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: configId, symbol: 'SPYX' })
      .expect(201);

    // Feed bars until the strategy enters and the fake broker fills the entry.
    let n = 400;
    while (n < 600 && (await detail(portfolio.id)).positions.length === 0) {
      n += 10;
      await extend('SPYX', assetId, upTo(n));
    }
    const held = await detail(portfolio.id);
    expect(held.positions).toHaveLength(1);

    const [entry] = ctx.alpaca.submitted;
    expect(entry).toMatchObject({ symbol: 'SPYX', side: 'buy', type: 'market' });
    expect(new Decimal(entry.qty!).isInteger()).toBe(true);
    expect(entry.client_order_id).toMatch(/:entry$/);
    expect(entry.stop_loss).toBeDefined();
    expect(held.positions[0]).toMatchObject({ quantity: entry.qty });

    const afterEntry = await orders(portfolio.id);
    expect(afterEntry.find((o) => o.side === 'BUY')).toMatchObject({ status: 'filled' });
    const legs = afterEntry.filter((o) => ['stop_loss', 'take_profit'].includes(o.source));
    expect(legs.length).toBe(entry.take_profit ? 2 : 1);
    expect(legs.every((o) => o.status === 'pending')).toBe(true);

    // Each fill is followed by a reconciliation; DB and broker agree.
    const broker = (await api().get(`/api/portfolios/${portfolio.id}/broker`).expect(200)).body as {
      account: { cash: string };
      reconciliations: { status: string }[];
    };
    expect(broker.reconciliations[0].status).toBe('ok');

    // The broker triggers the stop: the trade closes, the sibling leg is cancelled.
    ctx.alpaca.triggerLeg('SPYX', 'stop_loss');
    await ctx.idle();
    const trades = (await api().get(`/api/portfolios/${portfolio.id}/trades`).expect(200)).body as {
      exitReason: string;
      quantity: string;
    }[];
    expect(trades).toMatchObject([{ exitReason: 'stop_loss', quantity: entry.qty }]);
    const closed = await detail(portfolio.id);
    expect(closed.positions).toHaveLength(0);
    expect(new Decimal(closed.cash).toFixed(2)).toBe(ctx.alpaca.cash.toFixed(2));
    const final = await orders(portfolio.id);
    expect(final.filter((o) => o.status === 'pending')).toHaveLength(0);
    const after = (await api().get(`/api/portfolios/${portfolio.id}/broker`).expect(200)).body as {
      reconciliations: { status: string }[];
    };
    expect(after.reconciliations[0].status).toBe('ok');

    // Processing the same bars again sends nothing.
    const sent = ctx.alpaca.submitted.length;
    await api().post(`/api/portfolios/${portfolio.id}/process`).expect(201);
    await ctx.idle();
    expect(ctx.alpaca.submitted).toHaveLength(sent);
  });

  it('halts a portfolio on a reconciliation difference and audits it', async () => {
    const assetId = await register('SPYX', upTo(100));
    ctx.alpaca.prices.set('SPYX', upTo(100).at(-1)!.close);
    const portfolio = await createDemo();

    // Manual market BUY with a stop: an OTO order with whole shares.
    const buy = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', quantity: '3', stopLoss: 1 })
      .expect(201);
    await ctx.idle();
    expect(ctx.alpaca.submitted[0]).toMatchObject({ qty: '3', order_class: 'oto' });
    expect(
      (await orders(portfolio.id)).find((o) => o.id === (buy.body as OrderBody).id),
    ).toMatchObject({
      status: 'filled',
    });

    // Something changes at the broker that the app did not do.
    ctx.alpaca.positions.set('OTHER', new Decimal(5));
    const run = (await api().post(`/api/portfolios/${portfolio.id}/reconcile`).expect(201))
      .body as { status: string; diffs: { symbol: string }[] };
    expect(run).toMatchObject({ status: 'diff', diffs: [{ symbol: 'OTHER' }] });
    expect((await detail(portfolio.id)).haltedAt).not.toBeNull();

    const audit = (
      await api()
        .get('/api/audit')
        .query({ entityType: 'portfolio', entityId: portfolio.id })
        .expect(200)
    ).body as { action: string; actor: string }[];
    expect(audit.map((a) => [a.action, a.actor])).toEqual([
      ['portfolio.halt', 'system'],
      ['portfolio.create', 'user'],
    ]);

    // Halted: manual BUYs are rejected, closing is still possible.
    const rejected = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', quantity: '1' })
      .expect(201);
    expect(rejected.body).toMatchObject({ status: 'rejected', rejectReason: 'halted' });
    await api().post(`/api/portfolios/${portfolio.id}/positions/${assetId}/close`).expect(201);
    await ctx.idle();
    expect((await detail(portfolio.id)).positions).toHaveLength(0);
    // The stop leg was cancelled before the sell.
    expect((await orders(portfolio.id)).filter((o) => o.status === 'pending')).toHaveLength(0);

    ctx.alpaca.positions.delete('OTHER');
    await api().post(`/api/portfolios/${portfolio.id}/resume`).expect(201);
    expect((await detail(portfolio.id)).haltedAt).toBeNull();
    const ok = (await api().post(`/api/portfolios/${portfolio.id}/reconcile`).expect(201)).body as {
      status: string;
    };
    expect(ok.status).toBe('ok');
  });

  it('books a partial fill and closes on the take-profit leg', async () => {
    const assetId = await register('SPYX', upTo(100));
    ctx.alpaca.prices.set('SPYX', 100);
    const portfolio = await createDemo();
    ctx.alpaca.autoFill = false;
    await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', quantity: '10' })
      .expect(201);
    await ctx.idle();
    const remote = [...ctx.alpaca.orders.values()].find((o) => o.side === 'buy')!;

    // 4 of 10 shares filled, the rest cancelled: the position holds 4.
    ctx.alpaca.cancelAfterPartial(remote.id, 4, 100);
    await ctx.idle();
    const held = await detail(portfolio.id);
    expect(held.positions).toMatchObject([{ symbol: 'SPYX', quantity: '4' }]);
    expect((await orders(portfolio.id))[0]).toMatchObject({ status: 'filled', quantity: '4' });

    // Close it, then buy with a stop-loss and a take-profit: a bracket order.
    ctx.alpaca.autoFill = true;
    await api().post(`/api/portfolios/${portfolio.id}/positions/${assetId}/close`).expect(201);
    await ctx.idle();
    await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({
        symbol: 'SPYX',
        side: 'BUY',
        type: 'market',
        quantity: '2',
        stopLoss: 90,
        takeProfit: 110,
      })
      .expect(201);
    await ctx.idle();
    expect(ctx.alpaca.submitted.at(-1)).toMatchObject({
      order_class: 'bracket',
      take_profit: { limit_price: '110.00' },
      stop_loss: { stop_price: '90.00' },
    });
    ctx.alpaca.triggerLeg('SPYX', 'take_profit');
    await ctx.idle();
    const trades = (await api().get(`/api/portfolios/${portfolio.id}/trades`).expect(200)).body as {
      exitReason: string;
      exitPrice: number;
    }[];
    expect(trades[0]).toMatchObject({ exitReason: 'take_profit', exitPrice: 110 });
    expect(new Decimal((await detail(portfolio.id)).cash).toFixed(2)).toBe(
      ctx.alpaca.cash.toFixed(2),
    );
    expect((await orders(portfolio.id)).filter((o) => o.status === 'pending')).toHaveLength(0);
  });

  it('stops automatic and manual entries with the global kill switch', async () => {
    const assetId = await register('SPYX', upTo(400));
    const paper = (
      await api()
        .post('/api/portfolios')
        .send({ name: 'sim', initialCash: 10_000, riskRules: PERMISSIVE })
        .expect(201)
    ).body as PortfolioBody;
    const configId = await trendConfigId();
    await api()
      .post(`/api/portfolios/${paper.id}/subscriptions`)
      .send({ strategyConfigId: configId, symbol: 'SPYX' })
      .expect(201);

    const halted = await api().post('/api/trading/halt').send({ reason: 'test' }).expect(200);
    expect(halted.body).toMatchObject({ halted: true, reason: 'test' });
    const buy = await api()
      .post(`/api/portfolios/${paper.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', notional: '1000', stopLoss: 1 })
      .expect(201);
    expect(buy.body).toMatchObject({ status: 'rejected', rejectReason: 'halted' });

    // Bars that make the strategy enter (see the first test) produce no orders while halted,
    // and they count as processed: resuming does not trade them late.
    await extend('SPYX', assetId, upTo(600));
    expect((await orders(paper.id)).filter((o) => o.source === 'signal')).toHaveLength(0);
    const subs = (await api().get(`/api/portfolios/${paper.id}`).expect(200)).body as {
      subscriptions: { lastBarTime: string }[];
    };
    expect(new Date(subs.subscriptions[0].lastBarTime).getTime()).toBeGreaterThan(
      upTo(400).at(-1)!.openTime.getTime(),
    );

    await api().post('/api/trading/resume').expect(200);
    const again = await api()
      .post(`/api/portfolios/${paper.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', notional: '1000', stopLoss: 1 })
      .expect(201);
    expect(again.body).toMatchObject({ status: 'filled' });

    const audit = (await api().get('/api/audit').query({ entityType: 'trading' }).expect(200))
      .body as { action: string }[];
    expect(audit.map((a) => a.action)).toEqual(['trading.resume', 'trading.halt']);
  });

  it('validates demo-broker portfolios', async () => {
    await register('GOLD', upTo(20), SessionType.Continuous);
    ctx.alpaca.positions.set('SPY', new Decimal(1));
    await api().post('/api/portfolios').send({ name: 'x', mode: 'alpaca_paper' }).expect(422);
    ctx.alpaca.positions.clear();
    const portfolio = await createDemo();
    const configId = await trendConfigId();
    // One Alpaca account backs one portfolio.
    await api().post('/api/portfolios').send({ name: 'y', mode: 'alpaca_paper' }).expect(409);
    // Futures are not tradable on Alpaca.
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: configId, symbol: 'GOLD' })
      .expect(422);
    // Without keys demo-broker portfolios are disabled.
    ctx.alpaca.enabled = false;
    await api().post('/api/portfolios').send({ name: 'z', mode: 'alpaca_paper' }).expect(422);
    const status = (await api().get('/api/brokers/status').expect(200)).body as {
      enabled: boolean;
      environment: string;
    };
    expect(status).toMatchObject({ enabled: false, environment: 'paper' });
  });

  it('adopts an order whose submit response was lost', async () => {
    await register('SPYX', upTo(20));
    const portfolio = await createDemo();
    ctx.alpaca.prices.set('SPYX', 50);
    // The broker accepts the order, but the response never arrives.
    ctx.alpaca.failNextSubmit = 'after';
    const res = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', quantity: '2' })
      .expect(201);
    await ctx.idle();
    const order = (await orders(portfolio.id)).find((o) => o.id === (res.body as OrderBody).id);
    expect(order).toMatchObject({ status: 'filled' });
    expect((await detail(portfolio.id)).positions).toMatchObject([
      { symbol: 'SPYX', quantity: '2' },
    ]);
  });

  it('keeps an unconfirmed order pending and rejects it once the broker is known not to have it', async () => {
    await register('SPYX', upTo(20));
    const portfolio = await createDemo();
    // Neither the submit nor the follow-up lookup gets an answer: the outcome is unknown.
    ctx.alpaca.failNextSubmit = 'before';
    ctx.alpaca.failLookups = true;
    const res = await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'SPYX', side: 'BUY', type: 'market', quantity: '2' })
      .expect(201);
    const id = (res.body as OrderBody).id;
    await ctx.idle();
    expect((await orders(portfolio.id)).find((o) => o.id === id)).toMatchObject({
      status: 'pending',
    });

    // Order sync leaves recent unconfirmed orders alone (a submit may still be running) ...
    ctx.alpaca.failLookups = false;
    const broker = ctx.app.get(AlpacaBroker);
    await broker.syncOrders(portfolio.id);
    expect((await orders(portfolio.id)).find((o) => o.id === id)).toMatchObject({
      status: 'pending',
    });
    // ... and rejects old ones the broker does not know.
    await ctx.dataSource.query(
      `UPDATE orders SET created_at = now() - interval '10 minutes' WHERE id = $1`,
      [id],
    );
    await broker.syncOrders(portfolio.id);
    expect((await orders(portfolio.id)).find((o) => o.id === id)).toMatchObject({
      status: 'rejected',
      rejectReason: 'broker: order never reached the broker',
    });
  });

  it('halts even when the broker cannot cancel an order', async () => {
    const assetId = await register('SPYX', upTo(400));
    const portfolio = await createDemo();
    const configId = await trendConfigId();
    await api()
      .post(`/api/portfolios/${portfolio.id}/subscriptions`)
      .send({ strategyConfigId: configId, symbol: 'SPYX' })
      .expect(201);
    // Entries stay open at the broker until the strategy has sent one.
    ctx.alpaca.autoFill = false;
    let n = 400;
    while (n < 600 && (await orders(portfolio.id)).every((o) => o.source !== 'signal')) {
      n += 10;
      await extend('SPYX', assetId, upTo(n));
    }
    const entry = (await orders(portfolio.id)).find((o) => o.source === 'signal')!;
    expect(entry).toMatchObject({ status: 'pending' });

    ctx.alpaca.failCancels = true;
    const halted = await api().post('/api/trading/halt').send({ reason: 'test' }).expect(200);
    expect(halted.body).toMatchObject({ halted: true });
    // The order is still open at the broker, so it stays pending; the failure is audited.
    expect((await orders(portfolio.id)).find((o) => o.id === entry.id)).toMatchObject({
      status: 'pending',
    });
    const audit = (await api().get('/api/audit').query({ entityType: 'trading' }).expect(200))
      .body as { action: string; after: { failures?: string[] } }[];
    expect(audit[0].action).toBe('trading.halt');
    expect(audit[0].after.failures?.[0]).toMatch(/Could not cancel 1 order/);
  });
});
