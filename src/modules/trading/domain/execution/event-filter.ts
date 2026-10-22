import type { ExitDecision } from '../../../analysis/domain/strategy';
import { SessionType } from '../../../assets/domain/asset.types';
import type { Bar } from '../../../market-data/domain/bar';
import { nextUsBarOpen, usReportGap } from '../../../market-data/domain/session';

/**
 * Overrides of the strategy's decision at a bar's close, applied by `decide`.
 * Backtest, paper trading and the demo broker pass the same filter, so they stay equal.
 */
export interface DecisionFilter {
  /** No new entry is decided at bar `t`. */
  blockEntry(t: number): boolean;
  /** An exit decided at bar `t` (it fills at the next open) whatever the strategy says. */
  forceExit(t: number): ExitDecision | null;
}

export interface EarningsRule {
  /** Close a held position before the report. */
  exitBefore: boolean;
  /** No entries this many calendar days before the report (0: only the last two bars). */
  blockEntryDays: number;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * Earnings filter. A decision at bar t fills at the next bar's open (f1); the one after can fill
 * at f2. The report gap G is the first open that trades on the report. When f1 < G ≤ f2, bar t
 * is the last chance to be flat before the gap, so the exit is forced there (and at a later bar
 * before G as a fallback, which fills at G). Entries decided then would be closed at once, so
 * they are blocked; `blockEntryDays` widens the blocked window.
 *
 * Bar opens are projected from the session calendar, not read from the series: live trading
 * decides before the next bars exist, and backtest and paper trading must decide the same way.
 * US exchange holidays are unknown, so near a holiday the exit can come one bar early or late.
 */
export function earningsFilter(
  bars: Bar[],
  reports: Date[],
  rule: EarningsRule,
  session: SessionType = SessionType.UsEquity,
): DecisionFilter {
  const us = session === SessionType.UsEquity;
  const nextOpen = (time: Date) =>
    us ? nextUsBarOpen(time) : new Date(time.getTime() + 4 * HOUR_MS);
  const gaps = reports.map((r) => (us ? usReportGap(r) : r).getTime()).sort((a, b) => a - b);

  /** Per bar, computed once: a filter is asked many times in a sweep or walk-forward. */
  const cache = new Map<number, { force: boolean; block: boolean }>();
  const window = (t: number) => {
    let hit = cache.get(t);
    if (!hit) cache.set(t, (hit = compute(t)));
    return hit;
  };
  /** The first report gap after bar t's open, and how bar t relates to it. */
  const compute = (t: number): { force: boolean; block: boolean } => {
    const open = bars[t]?.openTime;
    if (!open) return { force: false, block: false };
    const time = open.getTime();
    const gap = gaps.find((g) => g > time);
    if (gap === undefined) return { force: false, block: false };
    const f2 = nextOpen(nextOpen(open)).getTime();
    const force = gap <= f2;
    return { force, block: force || time >= gap - rule.blockEntryDays * DAY_MS };
  };

  const decision: ExitDecision = { reason: 'Exit before earnings report', indicators: {} };
  return {
    blockEntry: (t) => window(t).block,
    forceExit: (t) => (rule.exitBefore && window(t).force ? decision : null),
  };
}
