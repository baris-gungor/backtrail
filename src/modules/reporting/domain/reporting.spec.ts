import type { EquityPoint } from '../../backtesting/domain/engine';
import { toCsv } from './csv';
import {
  correlationMatrix,
  dailyCloses,
  drawdownCurve,
  longestDrawdown,
  pearson,
  periodReturns,
  rollingSharpe,
  ulcerIndex,
} from './performance';
import { distribution, forwardReturns, quantile } from './signal-quality';
import { bestAndWorst, streaks, tradeStats, type TradeRecord } from './trade-record';

const DAY = 86_400_000;
const at = (iso: string) => new Date(iso);
const curve = (start: string, values: number[], stepMs = DAY): EquityPoint[] =>
  values.map((equity, i) => ({ time: new Date(at(start).getTime() + i * stepMs), equity }));

describe('performance', () => {
  it('keeps the first point and the last point of each UTC day', () => {
    const points: EquityPoint[] = [
      { time: at('2026-01-01T10:00:00Z'), equity: 100 },
      { time: at('2026-01-01T15:00:00Z'), equity: 101 },
      { time: at('2026-01-01T20:00:00Z'), equity: 102 },
      { time: at('2026-01-03T09:00:00Z'), equity: 99 },
    ];
    expect(dailyCloses(points).map((p) => p.equity)).toEqual([100, 102, 99]);
  });

  it('chains monthly and yearly returns from period-end equity', () => {
    const points: EquityPoint[] = [
      { time: at('2025-12-31T00:00:00Z'), equity: 100 },
      { time: at('2026-01-15T00:00:00Z'), equity: 105 },
      { time: at('2026-01-31T00:00:00Z'), equity: 110 },
      { time: at('2026-02-10T00:00:00Z'), equity: 99 },
    ];
    const monthly = periodReturns(points, 'month');
    expect(monthly.map((m) => m.period)).toEqual(['2026-01', '2026-02']);
    expect(monthly[0].return).toBeCloseTo(0.1, 12);
    expect(monthly[1].return).toBeCloseTo(-0.1, 12);
    // Monthly returns compound to the yearly return.
    const yearly = periodReturns(points, 'year');
    expect(yearly).toHaveLength(1);
    expect(yearly[0].return).toBeCloseTo(1.1 * 0.9 - 1, 12);
  });

  it('computes rolling Sharpe once the window is full', () => {
    const points = curve('2026-01-01T00:00:00Z', [100, 101, 100, 102, 103]);
    const rolling = rollingSharpe(points, 3, 365);
    expect(rolling.map((r) => r.value === null)).toEqual([true, true, false, false]);
    const r = [100 / 101 - 1, 102 / 100 - 1, 103 / 102 - 1];
    const m = (r[0] + r[1] + r[2]) / 3;
    const sd = Math.sqrt(r.reduce((a, x) => a + (x - m) ** 2, 0) / 2);
    expect(rolling[3].value).toBeCloseTo((m / sd) * Math.sqrt(365), 10);
  });

  it('measures ulcer index, the longest underwater period and the drawdown curve', () => {
    const points = curve('2026-01-01T00:00:00Z', [100, 90, 95, 100, 120, 110]);
    const dd = [0, 0.1, 0.05, 0, 0, 1 - 110 / 120];
    expect(ulcerIndex(points)).toBeCloseTo(Math.sqrt(dd.reduce((a, x) => a + x * x, 0) / 6), 12);
    expect(drawdownCurve(points).map((p) => p.equity)).toEqual(
      dd.map((x) => expect.closeTo(x, 12) as number),
    );
    // Day 0 peak, recovered on day 3; the last dip (day 4 to 5) is shorter and not recovered.
    expect(longestDrawdown(points)).toMatchObject({ days: 3, recovered: true });
    expect(longestDrawdown(curve('2026-01-01T00:00:00Z', [100, 99, 98, 97]))).toMatchObject({
      days: 3,
      recovered: false,
    });
  });

  it('correlates returns on shared time points', () => {
    expect(pearson([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 12);
    expect(pearson([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 12);
    expect(pearson([1, 1, 1], [1, 2, 3])).toBeNull();

    const a = curve('2026-01-01T00:00:00Z', [100, 110, 99, 121, 127]);
    const b = curve('2026-01-01T00:00:00Z', [50, 55, 49.5, 60.5, 63.5]);
    // c misses day 2; only the shared points count. Its returns move against a's.
    const c = [0, 1, 3, 4].map((day, i) => ({
      time: a[day].time,
      equity: [100, 90, 82, 80][i],
    }));
    const m = correlationMatrix([a, b, c]);
    expect(m[0][0]).toBe(1);
    expect(m[0][1]).toBeCloseTo(1, 10);
    expect(m[0][2]).toBeLessThan(0);
  });
});

const trade = (pnl: number, exitDay: number, returnPct = pnl / 1000): TradeRecord => ({
  source: 'paper',
  side: 'long',
  id: String(exitDay),
  runId: null,
  portfolioId: 'p',
  subscriptionId: null,
  strategyCode: 's',
  configName: 'default',
  symbol: 'X',
  assetId: 'a',
  entryTime: new Date(exitDay * DAY - 2 * 3_600_000),
  entryPrice: 1,
  exitTime: new Date(exitDay * DAY),
  exitPrice: 1,
  quantity: '1',
  fees: '0',
  pnl: String(pnl),
  returnPct,
  exitReason: 'signal',
  barsHeld: 1,
});

describe('trade stats', () => {
  it('counts streaks in exit order', () => {
    expect(streaks([1, 2, -1, -1, -1, 3, 0, 4])).toEqual({ maxWin: 2, maxLoss: 3 });
  });

  it('summarizes trades with decimal PnL', () => {
    const trades = [trade(0.1, 3), trade(0.2, 1), trade(-0.15, 2), trade(-0.05, 4)];
    const s = tradeStats(trades);
    expect(s).toMatchObject({ trades: 4, wins: 2, losses: 2, winRate: 0.5, totalPnl: '0.10' });
    expect(s.profitFactor).toBeCloseTo(0.3 / 0.2, 12);
    expect(s.expectancy).toBeCloseTo(0.025, 12);
    expect(s.avgHoldingHours).toBeCloseTo(2, 12);
    // Exit order: +0.2, -0.15, +0.1, -0.05.
    expect(s.maxWinStreak).toBe(1);
    expect(tradeStats([])).toMatchObject({ trades: 0, winRate: null, totalPnl: '0.00' });

    const { best, worst } = bestAndWorst(trades, 1);
    expect(best[0].pnl).toBe('0.2');
    expect(worst[0].pnl).toBe('-0.15');
  });
});

describe('signal quality', () => {
  const bars = [100, 102, 101, 105, 99].map((close, i) => ({
    openTime: new Date(i * 4 * 3_600_000),
    close,
  }));

  it('measures forward returns from the signal close', () => {
    const r = forwardReturns(
      bars,
      { barTime: bars[1].openTime, side: 'BUY', price: 102 },
      [1, 3, 6],
    );
    expect(r[0]).toBeCloseTo(101 / 102 - 1, 12);
    expect(r[1]).toBeCloseTo(99 / 102 - 1, 12);
    expect(r[2]).toBeNull();
    expect(forwardReturns(bars, { barTime: new Date(1), side: 'BUY', price: 1 }, [1])).toEqual([
      null,
    ]);
  });

  it('summarizes a distribution with side-aware hit rate', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(distribution([0.02, -0.01, 0.03, 0.01], 'BUY')).toMatchObject({
      count: 4,
      hitRate: 0.75,
      median: 0.015,
    });
    expect(distribution([0.02, -0.01], 'SELL').hitRate).toBe(0.5);
    expect(distribution([], 'BUY')).toMatchObject({ count: 0, mean: null, hitRate: null });
  });
});

describe('csv', () => {
  it('escapes quotes, commas and line breaks and writes ISO dates', () => {
    const csv = toCsv(
      [
        { header: 'name', value: (r: { name: string; at: Date | null }) => r.name },
        { header: 'at', value: (r) => r.at },
      ],
      [
        { name: 'a,"b"', at: new Date('2026-01-01T00:00:00Z') },
        { name: 'line\nbreak', at: null },
      ],
    );
    expect(csv).toBe('name,at\r\n"a,""b""",2026-01-01T00:00:00.000Z\r\n"line\nbreak",\r\n');
  });
});
