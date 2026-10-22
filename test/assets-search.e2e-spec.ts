import request from 'supertest';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { createTestApp, TestContext } from './setup/create-test-app';

describe('Asset search (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    const known = (symbol: string, name: string, assetClass: AssetClass) =>
      ctx.resolver.known.set(symbol, {
        symbol,
        name,
        assetClass,
        exchange: 'NasdaqGS',
        currency: 'USD',
        sessionType: SessionType.UsEquity,
        provider: 'fake',
      });
    known('AAPL', 'Apple Inc.', AssetClass.Equity);
    known('APLE', 'Apple Hospitality REIT', AssetClass.Equity);
    known('SPY', 'SPDR S&P 500 ETF', AssetClass.Etf);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  interface Hit {
    symbol: string;
    name: string;
    tracked: boolean;
  }

  it('finds symbols by name or ticker fragment', async () => {
    const byName = await api().get('/api/assets/search').query({ q: 'apple' }).expect(200);
    expect((byName.body as Hit[]).map((h) => h.symbol).sort()).toEqual(['AAPL', 'APLE']);

    const byTicker = await api().get('/api/assets/search').query({ q: 'spy' }).expect(200);
    expect((byTicker.body as Hit[]).map((h) => h.symbol)).toEqual(['SPY']);
  });

  it('marks symbols that are already tracked', async () => {
    await api().post('/api/assets').send({ symbol: 'AAPL' }).expect(201);
    const res = await api().get('/api/assets/search').query({ q: 'apple' }).expect(200);
    const tracked = Object.fromEntries((res.body as Hit[]).map((h) => [h.symbol, h.tracked]));
    expect(tracked).toEqual({ AAPL: true, APLE: false });
  });

  it('returns an empty list when nothing matches', async () => {
    const res = await api().get('/api/assets/search').query({ q: 'zzzz' }).expect(200);
    expect(res.body).toEqual([]);
  });

  it('rejects a missing or empty query', async () => {
    await api().get('/api/assets/search').expect(400);
    await api().get('/api/assets/search').query({ q: '' }).expect(400);
  });
});
