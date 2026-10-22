import request from 'supertest';
import fixture from '../src/modules/analysis/domain/strategies/__fixtures__/gc-f-4h.json';
import { AssetClass, SessionType } from '../src/modules/assets/domain/asset.types';
import type { RawBar } from '../src/modules/market-data/domain/bar';
import { ClosedTradeEntity } from '../src/modules/trading/infrastructure/closed-trade.entity';
import { createTestApp, TestContext } from './setup/create-test-app';

const HOUR = 3600_000;
const hourly: RawBar[] = fixture.flatMap(([t, open, high, low, close, volume]) =>
  [0, 1, 2, 3].map((k) => ({
    openTime: new Date(t * 1000 + k * HOUR),
    open,
    high,
    low,
    close,
    volume: volume / 4,
  })),
);

interface HealthView {
  subscriptionId: string;
  health: { level: string; checks: { code: string; level: string }[]; runId: string | null };
}

describe('Strategy health (e2e)', () => {
  let ctx: TestContext;
  const api = () => request(ctx.app.getHttpServer());

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  beforeEach(async () => {
    await ctx.reset();
    ctx.resolver.known.set('GOLD', {
      symbol: 'GOLD',
      name: 'Gold',
      assetClass: AssetClass.Future,
      exchange: 'COMEX',
      currency: 'USD',
      sessionType: SessionType.Continuous,
      provider: 'fake',
    });
    ctx.provider.bars.set('GOLD', [...hourly]);
    await api().post('/api/assets').send({ symbol: 'GOLD' }).expect(201);
    await ctx.idle();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  /** A paper portfolio with a trend subscription on GOLD. */
  const subscribe = async () => {
    const portfolio = (
      await api().post('/api/portfolios').send({ name: 'health', initialCash: 10_000 }).expect(201)
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
      .send({ strategyConfigId: configId, symbol: 'GOLD' })
      .expect(201);
    await ctx.idle();
    return { portfolioId: portfolio.id, configId };
  };

  const check = async (portfolioId: string) => {
    const res = await api().post(`/api/portfolios/${portfolioId}/health`).expect(201);
    await ctx.idle();
    return (res.body as HealthView[])[0];
  };

  /** Closed trades of the subscription, as if the portfolio had traded them. */
  const addTrades = async (portfolioId: string, returns: number[]) => {
    const [sub] = (
      (await api().get(`/api/portfolios/${portfolioId}`).expect(200)).body as {
        subscriptions: { id: string }[];
      }
    ).subscriptions;
    const repo = ctx.dataSource.getRepository(ClosedTradeEntity);
    const asset = (await api().get('/api/assets').expect(200)).body as { id: string }[];
    const start = Date.now() - returns.length * 24 * HOUR;
    await repo.save(
      returns.map((r, i) =>
        repo.create({
          portfolioId,
          assetId: asset[0].id,
          subscriptionId: sub.id,
          strategyConfigId: null,
          entryTime: new Date(start + i * 24 * HOUR),
          entryPrice: 100,
          exitTime: new Date(start + i * 24 * HOUR + 12 * HOUR),
          exitPrice: 100 * (1 + r),
          quantity: '1',
          fees: '0',
          pnl: String(100 * r),
          returnPct: r,
          exitReason: 'signal',
          barsHeld: 3,
        }),
      ),
    );
  };

  it('is unknown without a backtest to compare with', async () => {
    const { portfolioId } = await subscribe();
    const view = await check(portfolioId);
    expect(view.health.level).toBe('unknown');
    expect(ctx.notifier.sent).toHaveLength(0);
  });

  it('warns once when live trades fall far below the backtest, and reports recovery', async () => {
    const { portfolioId } = await subscribe();
    await api()
      .post('/api/backtests')
      .send({ symbols: ['GOLD'], strategies: [{ code: 'trend_ema_adx', config: 'default' }] })
      .expect(201);
    await ctx.idle();

    // Six losses of 6% in a row: a drawdown far beyond the backtest's. (The trend strategy wins
    // only about a quarter of its trades, so the streak itself is not unusual for it.)
    await addTrades(portfolioId, [-0.06, -0.06, -0.06, -0.06, -0.06, -0.06]);
    const view = await check(portfolioId);
    expect(view.health.level).toBe('warning');
    expect(view.health.runId).not.toBeNull();
    expect(view.health.checks.find((c) => c.code === 'drawdown')?.level).toBe('warning');
    expect(ctx.notifier.sent).toHaveLength(1);
    expect(ctx.notifier.sent[0]).toMatch(/^⚠️ Strateji sağlığı: health · GOLD · Trend/);

    // Still in warning: no second message. The stored result shows on the portfolio.
    await check(portfolioId);
    expect(ctx.notifier.sent).toHaveLength(1);
    const detail = (await api().get(`/api/portfolios/${portfolioId}`).expect(200)).body as {
      subscriptions: { health: { level: string } | null }[];
    };
    expect(detail.subscriptions[0].health?.level).toBe('warning');

    // Recovered: the old trades are gone, a few winners remain.
    await ctx.dataSource.getRepository(ClosedTradeEntity).delete({ portfolioId });
    await addTrades(portfolioId, [0.02, 0.01]);
    expect((await check(portfolioId)).health.level).not.toBe('warning');
    expect(ctx.notifier.sent).toHaveLength(2);
    expect(ctx.notifier.sent[1]).toMatch(/^✅ Strateji sağlığı düzeldi/);
  });
});
