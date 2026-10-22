import type { SignalSide } from '../../analysis/domain/strategy';

export const DEFAULT_HORIZONS = [1, 3, 6, 12];

export interface SignalAt {
  barTime: Date;
  side: SignalSide;
  /** Close of the signal bar. */
  price: number;
}

/**
 * Return from the signal bar's close to the close `h` bars later, for each horizon; null when
 * the data does not reach that far. Independent of any trade execution.
 */
export function forwardReturns(
  bars: { openTime: Date; close: number }[],
  signal: SignalAt,
  horizons: number[],
): (number | null)[] {
  let i = bars.findIndex((b) => b.openTime.getTime() === signal.barTime.getTime());
  if (i < 0) i = Number.NaN;
  return horizons.map((h) => {
    const later = bars[i + h];
    return later ? later.close / signal.price - 1 : null;
  });
}

export interface Distribution {
  count: number;
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  /** Share of signals that moved the expected way: up after BUY, down after SELL. */
  hitRate: number | null;
}

/** Linear-interpolated quantile of an ascending array. */
export function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function distribution(values: number[], side: SignalSide): Distribution {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  const hits = values.filter((v) => (side === 'BUY' ? v > 0 : v < 0)).length;
  return {
    count: n,
    mean: n ? sorted.reduce((a, b) => a + b, 0) / n : null,
    median: quantile(sorted, 0.5),
    p25: quantile(sorted, 0.25),
    p75: quantile(sorted, 0.75),
    hitRate: n ? hits / n : null,
  };
}
