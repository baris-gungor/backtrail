import { monteCarlo, percentile, tradeReturns } from './monte-carlo';

describe('tradeReturns', () => {
  it('turns PnL into account returns that compound to the final equity', () => {
    const returns = tradeReturns(10_000, [1000, -550, 2090]);
    [0.1, -0.05, 0.2].forEach((r, i) => expect(returns[i]).toBeCloseTo(r, 12));
    const final = returns.reduce((e, r) => e * (1 + r), 10_000);
    expect(final).toBeCloseTo(10_000 + 1000 - 550 + 2090, 6);
  });
});

describe('monteCarlo', () => {
  const returns = [0.05, -0.02, 0.03, -0.04, 0.06, 0.01, -0.01, 0.02];

  it('is reproducible for a seed and differs for another', () => {
    const a = monteCarlo(returns, { samples: 500, seed: 7 });
    expect(monteCarlo(returns, { samples: 500, seed: 7 })).toEqual(a);
    expect(monteCarlo(returns, { samples: 500, seed: 8 }).totalReturn).not.toEqual(a.totalReturn);
  });

  it('has ordered percentiles around the actual result', () => {
    const r = monteCarlo(returns, { samples: 2000 });
    expect(r.totalReturn.p5).toBeLessThan(r.totalReturn.p50);
    expect(r.totalReturn.p50).toBeLessThan(r.totalReturn.p95);
    expect(r.actual.totalReturn).toBeGreaterThan(r.totalReturn.p5);
    expect(r.actual.totalReturn).toBeLessThan(r.totalReturn.p95);
    expect(r.lossProbability).toBeGreaterThan(0);
    expect(r.lossProbability).toBeLessThan(0.5);
  });

  it('gives a zero-width range when every trade is the same', () => {
    const r = monteCarlo([0.01, 0.01, 0.01, 0.01, 0.01], { samples: 100 });
    expect(r.totalReturn.p5).toBeCloseTo(1.01 ** 5 - 1, 10);
    expect(r.totalReturn.p95).toBeCloseTo(r.totalReturn.p5, 10);
    expect(r.lossProbability).toBe(0);
    expect(r.maxDrawdown.p95).toBe(0);
  });

  it('keeps the total and changes only the path when shuffling', () => {
    // Two losses in a row are the worst order: 1 - 0.9 × 0.9 = 0.19.
    const r = monteCarlo([0.1, -0.1, 0.1, -0.1, 0.1], { samples: 3000 });
    expect(r.shuffledMaxDrawdown.p95).toBeCloseTo(0.19, 10);
  });

  it('refuses fewer than 5 trades', () => {
    expect(() => monteCarlo([0.1, 0.2, 0.3, 0.4])).toThrow(/at least 5 trades/);
  });
});

describe('percentile', () => {
  it('interpolates between ranks', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3);
    expect(percentile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentile([0, 10], 0.05)).toBeCloseTo(0.5);
  });
});
