import { InvalidInputError } from '../../../common/errors/domain.error';
import type { BacktestResult, EquityPoint } from './engine';
import type { BacktestMetrics } from './metrics';

/** Metrics a walk-forward window can select its parameters by (higher is better). */
export const WALK_FORWARD_METRICS = [
  'sharpe',
  'sortino',
  'calmar',
  'totalReturn',
  'profitFactor',
] as const satisfies readonly (keyof BacktestMetrics)[];
export type WalkForwardMetric = (typeof WALK_FORWARD_METRICS)[number];

/** Smallest segments that still say something (4h bars: ~2 weeks of futures, ~1 month of stocks). */
export const MIN_TRAIN_BARS = 100;
export const MIN_TEST_BARS = 30;
/** Backtests per request: parameter combinations × windows. */
export const MAX_WALK_FORWARD_RUNS = 2000;

export interface WalkForwardOptions {
  /** Number of test segments. */
  windows: number;
  /** Train share of one train + test window. */
  trainRatio: number;
  /** Anchored: every train segment starts at the first bar (expanding window). Default: rolling. */
  anchored: boolean;
}

/** Bar indices of one window; ends are exclusive. Train ends where the test starts. */
export interface WalkForwardWindow {
  index: number;
  trainFrom: number;
  testFrom: number;
  testTo: number;
}

/**
 * Splits bars[tradeFrom..barCount) into `windows` consecutive test segments of equal length, each
 * preceded by its train segment. With train length T and test length S: T / (T + S) = trainRatio
 * and T + windows × S = available bars. The last test segment takes the remainder.
 */
export function walkForwardWindows(
  tradeFrom: number,
  barCount: number,
  options: WalkForwardOptions,
): WalkForwardWindow[] {
  const { windows, trainRatio, anchored } = options;
  if (!Number.isInteger(windows) || windows < 2) {
    throw new InvalidInputError('windows must be an integer of at least 2');
  }
  if (!(trainRatio > 0 && trainRatio < 1)) {
    throw new InvalidInputError('trainRatio must be between 0 and 1');
  }
  const available = barCount - tradeFrom;
  const test = Math.floor(available / (windows + trainRatio / (1 - trainRatio)));
  const train = available - windows * test;
  if (test < MIN_TEST_BARS || train < MIN_TRAIN_BARS) {
    throw new InvalidInputError(
      `Not enough bars for ${windows} windows: ${available} bars give ${train} train and ${test} test bars ` +
        `(minimum ${MIN_TRAIN_BARS} / ${MIN_TEST_BARS}). Use fewer windows or a longer period.`,
    );
  }
  return Array.from({ length: windows }, (_, index) => {
    const testFrom = tradeFrom + train + index * test;
    return {
      index,
      trainFrom: anchored ? tradeFrom : testFrom - train,
      testFrom,
      testTo: index === windows - 1 ? barCount : testFrom + test,
    };
  });
}

/** Index of the best result by `metric`; missing values lose, ties keep the earlier one. */
export function bestIndex(metrics: (BacktestMetrics | null)[], metric: WalkForwardMetric): number {
  let best = -1;
  let bestValue = -Infinity;
  metrics.forEach((m, i) => {
    const value = m?.[metric];
    if (value != null && Number.isFinite(value) && value > bestValue) {
      best = i;
      bestValue = value;
    } else if (best < 0 && m) {
      best = i;
    }
  });
  return best;
}

/**
 * Joins consecutive test results into one out-of-sample result. Each test segment must have
 * started with the previous segment's final equity, so the equity points line up as they are.
 * The benchmark of each segment is rescaled to continue from the previous one's end.
 */
export function stitchResults(segments: BacktestResult[]): BacktestResult {
  if (segments.length === 0) throw new InvalidInputError('No segments to stitch');
  const equity: EquityPoint[] = [];
  const benchmark: EquityPoint[] = [];
  for (const [i, segment] of segments.entries()) {
    // A segment's first point (initial capital at the first open) repeats the previous end.
    const skip = i === 0 ? 0 : 1;
    equity.push(...segment.equity.slice(skip));
    const scale =
      i === 0 ? 1 : benchmark[benchmark.length - 1].equity / segment.benchmark[0].equity;
    benchmark.push(
      ...segment.benchmark.slice(skip).map((p) => ({ time: p.time, equity: p.equity * scale })),
    );
  }
  return {
    trades: segments.flatMap((s) => s.trades),
    equity,
    benchmark,
    bars: segments.reduce((n, s) => n + s.bars, 0),
    barsInMarket: segments.reduce((n, s) => n + s.barsInMarket, 0),
    totalFees: segments.slice(1).reduce((sum, s) => sum.plus(s.totalFees), segments[0].totalFees),
  };
}

export interface WindowOutcome {
  /** CAGR of the selected params on the train segment (in-sample). */
  trainCagr: number | null;
  /** Total return of the test segment (out-of-sample). */
  testReturn: number;
  params: Record<string, unknown>;
}

export interface WalkForwardSummary {
  /** Out-of-sample CAGR / mean in-sample CAGR. Null when in-sample CAGR is not positive. */
  efficiency: number | null;
  meanTrainCagr: number | null;
  /** Share of test segments with a positive return. */
  profitableWindows: number;
  /** Different parameter sets selected across windows (1 = fully stable). */
  distinctParams: number;
}

export function summarize(windows: WindowOutcome[], oosCagr: number | null): WalkForwardSummary {
  const cagrs = windows.map((w) => w.trainCagr).filter((c): c is number => c != null);
  const meanTrainCagr = cagrs.length ? cagrs.reduce((a, b) => a + b, 0) / cagrs.length : null;
  return {
    efficiency:
      oosCagr != null && meanTrainCagr != null && meanTrainCagr > 0
        ? oosCagr / meanTrainCagr
        : null,
    meanTrainCagr,
    profitableWindows: windows.length
      ? windows.filter((w) => w.testReturn > 0).length / windows.length
      : 0,
    distinctParams: new Set(windows.map((w) => stableKey(w.params))).size,
  };
}

/** JSON with sorted keys, so equal params give equal strings. */
function stableKey(params: Record<string, unknown>): string {
  return JSON.stringify(
    Object.keys(params)
      .sort()
      .map((k) => [k, params[k]]),
  );
}
