import request from 'supertest';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { MarkPriceService } from '../src/modules/market-data/application/mark-price.service';
import type { RawBar } from '../src/modules/market-data/domain/bar';
import { createTestApp, TestContext } from './setup/create-test-app';

interface PortfolioBody {
  id: string;
  equity: string;
  positions: {
    symbol: string;
    quantity: string;
    lastPrice: number;
    priceSource: 'quote' | 'bar' | null;
    priceAsOf: string | null;
    unrealizedPnl: string;
  }[];
}

const HOUR = 3600_000;

/** Flat 1h bars at 100 that end a few hours ago. */
function recentBars(): RawBar[] {
  const end = Math.floor(Date.now() / HOUR) * HOUR;
  return Array.from({ length: 48 }, (_, i) => ({
    openTime: new Date(end - (48 - i) * HOUR),
    open: 100,
    high: 100.5,
    low: 99.5,
    close: 100,
    volume: 10,
  }));
}

describe('Mark prices (e2e)', () => {
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

  /** A portfolio holding 10 units of FLAT bought at the 1h close (~100). */
  const openPosition = async (): Promise<string> => {
    ctx.resolver.known.set('FLAT', {
      symbol: 'FLAT',
      name: 'FLAT future',
      assetClass: AssetClass.Future,
      exchange: 'COMEX',
      currency: 'USD',
      sessionType: SessionType.Continuous,
      provider: 'fake',
    });
    ctx.provider.bars.set('FLAT', recentBars());
    await api().post('/api/assets').send({ symbol: 'FLAT' }).expect(201);
    await ctx.idle();
    const portfolio = (
      await api()
        .post('/api/portfolios')
        .send({
          name: 'marks',
          initialCash: 10_000,
          riskRules: { requireStopLoss: false, maxPositionPct: 100 },
        })
        .expect(201)
    ).body as PortfolioBody;
    await api()
      .post(`/api/portfolios/${portfolio.id}/orders`)
      .send({ symbol: 'FLAT', side: 'BUY', type: 'market', quantity: '10' })
      .expect(201);
    return portfolio.id;
  };

  const detail = async (id: string) =>
    (await api().get(`/api/portfolios/${id}`).expect(200)).body as PortfolioBody;

  it('marks a position at the latest 1h close when there is no quote', async () => {
    const id = await openPosition();
    const { positions } = await detail(id);
    expect(positions[0]).toMatchObject({ lastPrice: 100, priceSource: 'bar' });
    expect(positions[0].priceAsOf).not.toBeNull();
  });

  it('marks a position at a fresher quote and moves PnL and equity with it', async () => {
    const id = await openPosition();
    const before = await detail(id);

    ctx.quotes.set('FLAT', 110);
    const after = await detail(id);

    expect(after.positions[0]).toMatchObject({ lastPrice: 110, priceSource: 'quote' });
    expect(Number(after.positions[0].unrealizedPnl)).toBeGreaterThan(90);
    expect(Number(after.equity)).toBeGreaterThan(Number(before.equity) + 90);
  });

  it('ignores a quote that is older than the latest stored bar', async () => {
    const id = await openPosition();
    ctx.quotes.set('FLAT', 150, new Date(Date.now() - 30 * 24 * HOUR));
    const { positions } = await detail(id);
    expect(positions[0]).toMatchObject({ lastPrice: 100, priceSource: 'bar' });
  });

  it('falls back to the stored bar when the quote provider fails', async () => {
    const id = await openPosition();
    ctx.quotes.set('FLAT', 110);
    ctx.quotes.fail = true;
    ctx.app.get(MarkPriceService).clearCache();
    const { positions } = await detail(id);
    expect(positions[0]).toMatchObject({ lastPrice: 100, priceSource: 'bar' });
  });
});
