import type { EquityPoint } from '../../backtesting/domain/engine';
import { drawdownStats } from '../../backtesting/domain/metrics';

const DAY_MS = 24 * 60 * 60 * 1000;

const dayKey = (d: Date) => d.toISOString().slice(0, 10);

/**
 * One point per UTC day (the day's last value), after the first point. Paper snapshots are taken
 * at irregular times; daily closes make return statistics comparable to bar-based ones.
 */
export function dailyCloses(points: EquityPoint[]): EquityPoint[] {
  if (points.length === 0) return [];
  const out: EquityPoint[] = [points[0]];
  for (const point of points.slice(1)) {
    const last = out[out.length - 1];
    if (out.length > 1 && dayKey(last.time) === dayKey(point.time)) out[out.length - 1] = point;
    else out.push(point);
  }
  return out;
}

export interface PeriodReturn {
  /** `2026-03` for months, `2026` for years. */
  period: string;
  return: number;
}

/**
 * Return of each calendar month or year (UTC): the period's last equity over the previous
 * period's last equity (the first point for the first period).
 */
export function periodReturns(points: EquityPoint[], unit: 'month' | 'year'): PeriodReturn[] {
  if (points.length < 2) return [];
  const key = (d: Date) => d.toISOString().slice(0, unit === 'month' ? 7 : 4);
  const closes = new Map<string, number>();
  for (const p of points.slice(1)) closes.set(key(p.time), p.equity);

  const out: PeriodReturn[] = [];
  let previous = points[0].equity;
  for (const [period, equity] of closes) {
    out.push({ period, return: equity / previous - 1 });
    previous = equity;
  }
  return out;
}

export interface RollingPoint {
  time: Date;
  value: number | null;
}

/**
 * Annualized Sharpe over the last `window` returns at each point (risk-free 0). Null until the
 * window is full or when the window has no variance.
 */
export function rollingSharpe(
  points: EquityPoint[],
  window: number,
  periodsPerYear: number,
): RollingPoint[] {
  const returns = points.slice(1).map((p, i) => p.equity / points[i].equity - 1);
  return points.slice(1).map((p, i) => {
    if (i + 1 < window) return { time: p.time, value: null };
    const slice = returns.slice(i + 1 - window, i + 1);
    const m = slice.reduce((a, b) => a + b, 0) / window;
    const sd = Math.sqrt(slice.reduce((a, b) => a + (b - m) ** 2, 0) / (window - 1));
    return { time: p.time, value: sd > 0 ? (m / sd) * Math.sqrt(periodsPerYear) : null };
  });
}

/** Root mean square of the drawdown from the running peak, as a fraction (0.05 = 5%). */
export function ulcerIndex(points: EquityPoint[]): number {
  if (points.length === 0) return 0;
  let peak = -Infinity;
  let squares = 0;
  for (const p of points) {
    peak = Math.max(peak, p.equity);
    squares += (p.equity / peak - 1) ** 2;
  }
  return Math.sqrt(squares / points.length);
}

export interface UnderwaterPeriod {
  /** Calendar days from the peak to the recovery (or to the last point). */
  days: number;
  from: Date | null;
  to: Date | null;
  recovered: boolean;
}

/** Longest time spent below a previous equity peak. */
export function longestDrawdown(points: EquityPoint[]): UnderwaterPeriod {
  let best: UnderwaterPeriod = { days: 0, from: null, to: null, recovered: true };
  let peak = -Infinity;
  let peakTime: Date | null = null;
  let underwater = false;

  const consider = (to: Date, recovered: boolean) => {
    const days = (to.getTime() - peakTime!.getTime()) / DAY_MS;
    if (days > best.days) best = { days, from: peakTime, to, recovered };
  };

  for (const p of points) {
    if (p.equity >= peak) {
      if (underwater) consider(p.time, true);
      peak = p.equity;
      peakTime = p.time;
      underwater = false;
    } else {
      underwater = true;
    }
  }
  if (underwater) consider(points[points.length - 1].time, false);
  return best;
}

/** Drawdown from the running peak at every point (0..1), for charting. */
export function drawdownCurve(points: EquityPoint[]): EquityPoint[] {
  let peak = -Infinity;
  return points.map((p) => {
    peak = Math.max(peak, p.equity);
    return { time: p.time, equity: 1 - p.equity / peak };
  });
}

/** Pearson correlation, null with fewer than 3 pairs or no variance. */
export function pearson(a: number[], b: number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 3) return null;
  const ma = a.slice(0, n).reduce((s, x) => s + x, 0) / n;
  const mb = b.slice(0, n).reduce((s, x) => s + x, 0) / n;
  let cov = 0;
  let va = 0;
  let vb = 0;
  for (let i = 0; i < n; i++) {
    cov += (a[i] - ma) * (b[i] - mb);
    va += (a[i] - ma) ** 2;
    vb += (b[i] - mb) ** 2;
  }
  return va > 0 && vb > 0 ? cov / Math.sqrt(va * vb) : null;
}

/**
 * Correlation of period returns between equity curves, on the time points all curves share.
 * Returns are taken between consecutive shared points.
 */
export function correlationMatrix(curves: EquityPoint[][]): (number | null)[][] {
  const shared = curves
    .map((c) => new Set(c.map((p) => p.time.getTime())))
    .reduce<Set<number> | null>(
      (acc, set) => (acc ? new Set([...acc].filter((t) => set.has(t))) : set),
      null,
    );
  const times = [...(shared ?? [])].sort((x, y) => x - y);
  const returns = curves.map((c) => {
    const at = new Map(c.map((p) => [p.time.getTime(), p.equity]));
    const values = times.map((t) => at.get(t)!);
    return values.slice(1).map((v, i) => v / values[i] - 1);
  });
  return returns.map((a, i) => returns.map((b, j) => (i === j ? 1 : pearson(a, b))));
}

export interface ExtraMetrics {
  ulcerIndex: number;
  longestDrawdown: UnderwaterPeriod;
  /** Depth of the deepest drawdown (same as the run metrics' maxDrawdown). */
  maxDrawdown: number;
  monthly: PeriodReturn[];
  yearly: PeriodReturn[];
}

export function extraMetrics(points: EquityPoint[]): ExtraMetrics {
  return {
    ulcerIndex: ulcerIndex(points),
    longestDrawdown: longestDrawdown(points),
    maxDrawdown: drawdownStats(points).depth,
    monthly: periodReturns(points, 'month'),
    yearly: periodReturns(points, 'year'),
  };
}
