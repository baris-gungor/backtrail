import { InvalidInputError } from '../../../common/errors/domain.error';

/** Fewer trades say nothing about a distribution. */
export const MIN_MONTE_CARLO_TRADES = 5;
export const DEFAULT_MONTE_CARLO_SAMPLES = 1000;

export interface Percentiles {
  p5: number;
  p50: number;
  p95: number;
}

export interface MonteCarloResult {
  samples: number;
  trades: number;
  /** The backtest's own trade sequence, on the same trade-by-trade basis. */
  actual: { totalReturn: number; maxDrawdown: number };
  /** Bootstrap: trades drawn with replacement, as many as the backtest had. */
  totalReturn: Percentiles;
  maxDrawdown: Percentiles;
  /** Share of bootstrap samples that ended below the starting capital. */
  lossProbability: number;
  /** Same trades in random order: total return is fixed, only the path (drawdown) changes. */
  shuffledMaxDrawdown: Percentiles;
}

/**
 * Account return of each trade: PnL over the equity before it. A backtest trades one instrument
 * and holds cash between trades, so equity before trade k is the initial capital plus the PnL of
 * the trades before it, and compounding these returns gives the final equity exactly.
 */
export function tradeReturns(initialCapital: number, pnls: number[]): number[] {
  let equity = initialCapital;
  return pnls.map((pnl) => {
    const r = equity > 0 ? pnl / equity : 0;
    equity += pnl;
    return r;
  });
}

/**
 * Monte Carlo on trade returns. Deterministic for a given seed. Drawdowns are
 * measured on equity after each trade, so they are smaller than the bar-by-bar drawdown of the
 * backtest; compare them with `actual.maxDrawdown`, which uses the same basis.
 */
export function monteCarlo(
  returns: number[],
  options: { samples?: number; seed?: number } = {},
): MonteCarloResult {
  if (returns.length < MIN_MONTE_CARLO_TRADES) {
    throw new InvalidInputError(
      `Monte Carlo needs at least ${MIN_MONTE_CARLO_TRADES} trades (this run has ${returns.length})`,
    );
  }
  const samples = options.samples ?? DEFAULT_MONTE_CARLO_SAMPLES;
  const random = mulberry32(options.seed ?? 1);
  const n = returns.length;

  const totals: number[] = [];
  const drawdowns: number[] = [];
  const shuffled: number[] = [];
  const path = new Array<number>(n);
  for (let s = 0; s < samples; s++) {
    for (let k = 0; k < n; k++) path[k] = returns[Math.floor(random() * n)];
    const boot = walk(path);
    totals.push(boot.totalReturn);
    drawdowns.push(boot.maxDrawdown);

    // Fisher–Yates on a copy of the actual trades.
    const order = [...returns];
    for (let k = n - 1; k > 0; k--) {
      const j = Math.floor(random() * (k + 1));
      [order[k], order[j]] = [order[j], order[k]];
    }
    shuffled.push(walk(order).maxDrawdown);
  }

  return {
    samples,
    trades: n,
    actual: walk(returns),
    totalReturn: percentiles(totals),
    maxDrawdown: percentiles(drawdowns),
    lossProbability: totals.filter((t) => t < 0).length / samples,
    shuffledMaxDrawdown: percentiles(shuffled),
  };
}

/** Compounds returns from 1 and tracks the deepest drop from a running peak. */
function walk(returns: number[]): { totalReturn: number; maxDrawdown: number } {
  let equity = 1;
  let peak = 1;
  let maxDrawdown = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    maxDrawdown = Math.max(maxDrawdown, 1 - equity / peak);
  }
  return { totalReturn: equity - 1, maxDrawdown };
}

/** Linear interpolation between closest ranks. */
export function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const rank = (sorted.length - 1) * p;
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  return sorted[low] + (sorted[high] - sorted[low]) * (rank - low);
}

function percentiles(values: number[]): Percentiles {
  const sorted = [...values].sort((a, b) => a - b);
  return {
    p5: percentile(sorted, 0.05),
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
  };
}

/** Small seeded PRNG (uniform in [0, 1)); reproducible results for the same request. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
