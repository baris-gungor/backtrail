import request from 'supertest';
import { DataSource } from 'typeorm';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { RawBar } from '../src/modules/market-data/domain/bar';
import { createTestApp, TestContext } from './setup/create-test-app';

interface AssetBody {
  id: string;
  symbol: string;
  isActive: boolean;
  lastSyncedAt: string | null;
}

interface BarBody {
  openTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isComplete: boolean;
}

interface SeriesBody {
  bars: BarBody[];
}

interface RunBody {
  status: string;
  hourlyBarsUpserted: number;
  fourHourBarsUpserted: number;
}

/** Regular-session 1h bars for one EDT day: 09:30..15:30 New York = 13:30Z..19:30Z. */
function sessionDay(date: string, base: number): RawBar[] {
  return [13, 14, 15, 16, 17, 18, 19].map((hour, i) => ({
    openTime: new Date(`${date}T${hour}:30:00Z`),
    open: base + i,
    high: base + i + 2,
    low: base + i - 2,
    close: base + i + 1,
    volume: 1000,
  }));
}

describe('Assets and market data (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    ctx.resolver.known.set('TEST', {
      symbol: 'TEST',
      name: 'Test Corp',
      assetClass: AssetClass.Equity,
      exchange: 'NasdaqGS',
      currency: 'USD',
      sessionType: SessionType.UsEquity,
      provider: 'fake',
    });
    ctx.provider.bars.set('TEST', [
      ...sessionDay('2026-10-05', 100),
      ...sessionDay('2026-10-06', 200),
    ]);
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  const createAsset = async (): Promise<AssetBody> => {
    const res = await api().post('/api/assets').send({ symbol: 'test' }).expect(201);
    return res.body as AssetBody;
  };

  it('registers an asset with normalized symbol and rejects duplicates and unknown symbols', async () => {
    const asset = await createAsset();
    expect(asset).toMatchObject({ symbol: 'TEST', isActive: true });

    await api().post('/api/assets').send({ symbol: 'TEST' }).expect(409);
    await api().post('/api/assets').send({ symbol: 'NOPE' }).expect(422);
    await api().post('/api/assets').send({ symbol: 'bad symbol!' }).expect(400);
  });

  it('syncs 1h bars and builds 4h session bars', async () => {
    const asset = await createAsset();

    const run = (await api().post(`/api/market-data/sync/${asset.id}`).expect(201)).body as RunBody;
    expect(run.status).toBe('success');

    const hourly = await api()
      .get('/api/market-data/bars')
      .query({ symbol: 'TEST', timeframe: '1h', limit: 100 })
      .expect(200);
    expect((hourly.body as SeriesBody).bars).toHaveLength(14);

    const fourHour = await api()
      .get('/api/market-data/bars')
      .query({ symbol: 'TEST', timeframe: '4h' })
      .expect(200);
    const { bars } = fourHour.body as SeriesBody;
    expect(bars.map((b) => b.openTime)).toEqual([
      '2026-10-05T13:30:00.000Z',
      '2026-10-05T17:30:00.000Z',
      '2026-10-06T13:30:00.000Z',
      '2026-10-06T17:30:00.000Z',
    ]);
    expect(bars[0]).toMatchObject({ open: 100, high: 105, low: 98, close: 104, volume: 4000 });
    expect(bars[1]).toMatchObject({ open: 104, close: 107, volume: 3000, isComplete: true });

    const synced = await api().get(`/api/assets/${asset.id}`).expect(200);
    expect((synced.body as AssetBody).lastSyncedAt).not.toBeNull();
  });

  it('continues incrementally from the latest stored bar', async () => {
    const asset = await createAsset();
    await api().post(`/api/market-data/sync/${asset.id}`).expect(201);

    ctx.provider.bars.get('TEST')!.push(...sessionDay('2026-10-07', 300));
    ctx.provider.calls.length = 0;

    await api().post(`/api/market-data/sync/${asset.id}`).expect(201);
    expect(ctx.provider.calls[0].from.toISOString()).toBe('2026-10-06T19:30:00.000Z');

    const fourHour = await api()
      .get('/api/market-data/bars')
      .query({ symbol: 'TEST', timeframe: '4h' })
      .expect(200);
    expect((fourHour.body as SeriesBody).bars).toHaveLength(6);

    const runs = await api()
      .get('/api/market-data/ingestion-runs')
      .query({ assetId: asset.id })
      .expect(200);
    expect((runs.body as RunBody[]).every((r) => r.status === 'success')).toBe(true);
  });

  it('backfills again when the configured history depth is no longer covered', async () => {
    const asset = await createAsset();
    await api().post(`/api/market-data/sync/${asset.id}`).expect(201);

    // Simulate runs made under a smaller MARKET_DATA_HISTORY_DAYS: none reached the target depth.
    await ctx.app
      .get(DataSource)
      .query(`UPDATE ingestion_runs SET range_from = '2026-10-05T00:00:00Z' WHERE asset_id = $1`, [
        asset.id,
      ]);
    ctx.provider.calls.length = 0;

    await api().post(`/api/market-data/sync/${asset.id}`).expect(201);
    const from = ctx.provider.calls[0].from.getTime();
    expect(from).toBeLessThan(new Date('2026-10-05T00:00:00Z').getTime());

    // That run covered the depth, so the next sync is incremental again.
    ctx.provider.calls.length = 0;
    await api().post(`/api/market-data/sync/${asset.id}`).expect(201);
    expect(ctx.provider.calls[0].from.toISOString()).toBe('2026-10-06T19:30:00.000Z');
  });

  it('deactivates and deletes an asset with its price data', async () => {
    const asset = await createAsset();
    await api().post(`/api/market-data/sync/${asset.id}`).expect(201);

    const patched = await api()
      .patch(`/api/assets/${asset.id}`)
      .send({ isActive: false })
      .expect(200);
    expect((patched.body as AssetBody).isActive).toBe(false);

    const active = await api().get('/api/assets').query({ isActive: true }).expect(200);
    expect(active.body).toHaveLength(0);

    await api().delete(`/api/assets/${asset.id}`).expect(204);
    await api().get(`/api/assets/${asset.id}`).expect(404);
    await api().get('/api/market-data/bars').query({ symbol: 'TEST' }).expect(404);
  });
});
