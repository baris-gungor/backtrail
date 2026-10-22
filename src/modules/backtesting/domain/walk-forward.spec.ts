import Decimal from 'decimal.js';
import type { BacktestResult } from './engine';
import type { BacktestMetrics } from './metrics';
import {
  bestIndex,
  MIN_TEST_BARS,
  stitchResults,
  summarize,
  walkForwardWindows,
} from './walk-forward';

describe('walkForwardWindows', () => {
  it('splits rolling windows with the train ratio and gives the last test the remainder', () => {
    // 1000 bars after 20 warmup bars, 4 windows, 75% train: T = 3S, 3S + 4S = 1000 -> S = 142.
    const windows = walkForwardWindows(20, 1020, { windows: 4, trainRatio: 0.75, anchored: false });
    expect(windows).toEqual([
      { index: 0, trainFrom: 20, testFrom: 452, testTo: 594 },
      { index: 1, trainFrom: 162, testFrom: 594, testTo: 736 },
      { index: 2, trainFrom: 304, testFrom: 736, testTo: 878 },
      { index: 3, trainFrom: 446, testFrom: 878, testTo: 1020 },
    ]);
    for (const w of windows) expect(w.testFrom - w.trainFrom).toBe(432);
  });

  it('keeps every train segment starting at the first bar when anchored', () => {
    const windows = walkForwardWindows(0, 1000, { windows: 3, trainRatio: 0.7, anchored: true });
    expect(windows.map((w) => w.trainFrom)).toEqual([0, 0, 0]);
    expect(windows.at(-1)!.testTo).toBe(1000);
    // Test segments are contiguous.
    expect(windows[1].testFrom).toBe(windows[0].testTo);
  });

  it('rejects windows that would be too short', () => {
    expect(() =>
      walkForwardWindows(0, MIN_TEST_BARS * 5, { windows: 10, trainRatio: 0.7, anchored: false }),
    ).toThrow(/Not enough bars/);
    expect(() =>
      walkForwardWindows(0, 1000, { windows: 1, trainRatio: 0.7, anchored: false }),
    ).toThrow(/windows/);
  });
});

describe('bestIndex', () => {
  const m = (sharpe: number | null) => ({ sharpe }) as BacktestMetrics;

  it('picks the highest value, missing values last, first on ties', () => {
    expect(bestIndex([m(0.5), m(null), m(1.2), m(1.2)], 'sharpe')).toBe(2);
    expect(bestIndex([m(null), m(null)], 'sharpe')).toBe(0);
    expect(bestIndex([null, m(null)], 'sharpe')).toBe(1);
  });
});

describe('stitchResults', () => {
  const t = (h: number) => new Date(Date.UTC(2026, 0, 1, h));
  const segment = (
    equity: number[],
    benchmark: number[],
    start: number,
    fees: number,
  ): BacktestResult => ({
    trades: [],
    equity: equity.map((e, i) => ({ time: t(start + i), equity: e })),
    benchmark: benchmark.map((e, i) => ({ time: t(start + i), equity: e })),
    bars: equity.length - 1,
    barsInMarket: 1,
    totalFees: new Decimal(fees),
  });

  it('continues equity as is and rescales the benchmark of later segments', () => {
    // The second segment starts with the first one's final equity (110).
    const result = stitchResults([
      segment([100, 105, 110], [100, 120, 150], 0, 1),
      segment([110, 99, 121], [110, 121, 132], 2, 2),
    ]);
    expect(result.equity.map((p) => p.equity)).toEqual([100, 105, 110, 99, 121]);
    // 150 × (121 / 110) and 150 × (132 / 110).
    expect(result.benchmark.map((p) => Math.round(p.equity))).toEqual([100, 120, 150, 165, 180]);
    expect(result.bars).toBe(4);
    expect(result.barsInMarket).toBe(2);
    expect(result.totalFees.toNumber()).toBe(3);
  });
});

describe('summarize', () => {
  it('computes efficiency, profitable share and parameter stability', () => {
    const summary = summarize(
      [
        { trainCagr: 0.2, testReturn: 0.05, params: { a: 1, b: 2 } },
        { trainCagr: 0.4, testReturn: -0.01, params: { b: 2, a: 1 } },
        { trainCagr: null, testReturn: 0.02, params: { a: 3, b: 2 } },
      ],
      0.15,
    );
    expect(summary.meanTrainCagr).toBeCloseTo(0.3);
    expect(summary.efficiency).toBeCloseTo(0.5);
    expect(summary.profitableWindows).toBeCloseTo(2 / 3);
    expect(summary.distinctParams).toBe(2);
  });

  it('has no efficiency when the in-sample result was not positive', () => {
    expect(summarize([{ trainCagr: -0.1, testReturn: 0, params: {} }], 0.1).efficiency).toBeNull();
  });
});
