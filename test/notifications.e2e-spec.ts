import request from 'supertest';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import { STRATEGIES } from '../src/modules/analysis/domain/strategies';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import type { Bar, RawBar } from '../src/modules/market-data/domain/bar';
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

const toHourly = (bars: Bar[]): RawBar[] =>
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

const active = STRATEGIES.filter((s) => !s.isBenchmark);
const signalTimes = (bars: Bar[]) =>
  new Set(active.flatMap((s) => s.evaluate(bars, s.defaultParams).map((x) => x.barTime.getTime())));

// The history ends on a bar with a signal; the next bar has none (both found in the fixture).
const all = signalTimes(fourHour);
const lastIndex = fourHour.findLastIndex(
  (b, i) =>
    all.has(b.openTime.getTime()) &&
    i + 1 < fourHour.length &&
    !all.has(fourHour[i + 1].openTime.getTime()),
);
const history = fourHour.slice(0, lastIndex + 1);
const lastBar = history[history.length - 1].openTime.getTime();
const signalsOnLastBar = active.filter((s) =>
  s.evaluate(history, s.defaultParams).some((x) => x.barTime.getTime() === lastBar),
).length;

describe('Notifications (e2e)', () => {
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
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('notifies only the signals of the latest closed bar, once', async () => {
    ctx.provider.bars.set('GOLD', toHourly(history));
    const res = await api().post('/api/assets').send({ symbol: 'GOLD' }).expect(201);
    await ctx.idle();

    const messages = ctx.notifier.sent.filter((m) => m.startsWith('📈'));
    expect(messages).toHaveLength(1);
    expect(messages[0]).toContain(`GOLD: ${signalsOnLastBar} yeni sinyal`);

    // A new bar without signals: the backfilled history is not notified again.
    ctx.provider.bars.set('GOLD', toHourly(fourHour.slice(0, lastIndex + 2)));
    await api()
      .post(`/api/market-data/sync/${(res.body as { id: string }).id}`)
      .expect((r) => expect(r.status).toBeLessThan(300));
    await ctx.idle();
    expect(ctx.notifier.sent.filter((m) => m.startsWith('📈'))).toHaveLength(1);

    // Rebuilding signals re-creates the latest ones, but they are not news.
    await api().post('/api/analysis/signals/rebuild').send({ symbol: 'GOLD' }).expect(200);
    await ctx.idle();
    expect(ctx.notifier.sent.filter((m) => m.startsWith('📈'))).toHaveLength(1);
  });

  it('notifies kill switch halt and resume', async () => {
    await api().post('/api/trading/halt').send({ reason: 'test' }).expect(200);
    await api().post('/api/trading/resume').expect(200);
    await ctx.idle();
    expect(ctx.notifier.sent).toEqual([
      '⛔ TÜM İŞLEMLER DURDURULDU\nSebep: test\nKullanıcı tarafından',
      '▶️ İşlemler yeniden açıldı',
    ]);
  });

  it('reports status and sends a test message', async () => {
    const status = await api().get('/api/notifications/status').expect(200);
    expect(status.body).toEqual({ enabled: true, channel: 'telegram' });
    await api().post('/api/notifications/test').expect(204);
    expect(ctx.notifier.sent).toHaveLength(1);
  });
});
