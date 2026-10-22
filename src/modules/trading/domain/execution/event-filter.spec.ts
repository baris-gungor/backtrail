import type { StrategyRunner } from '../../../analysis/domain/strategy';
import { runBacktest } from '../../../backtesting/domain/engine';
import type { Bar } from '../../../market-data/domain/bar';
import { nextUsBarOpen, usReportGap } from '../../../market-data/domain/session';
import { earningsFilter } from './event-filter';

/**
 * US-session 4h bars in summer time: 09:30 and 13:30 New York = 13:30 and 17:30 UTC,
 * Monday 2026-06-01 onwards, weekdays only.
 */
function sessionBars(days: number): Bar[] {
  const bars: Bar[] = [];
  for (let d = 0, added = 0; added < days; d++) {
    const day = new Date(Date.UTC(2026, 5, 1 + d));
    if (day.getUTCDay() === 0 || day.getUTCDay() === 6) continue;
    added++;
    for (const hour of [13, 17]) {
      const openTime = new Date(day.getTime() + hour * 3600_000 + 30 * 60_000);
      bars.push({
        openTime,
        open: 100,
        high: 101,
        low: 99,
        close: 100,
        volume: 1,
        isComplete: true,
      });
    }
  }
  return bars;
}

const bars = sessionBars(10); // 2026-06-01 (Mon) .. 2026-06-12 (Fri), 20 bars
const at = (iso: string) => new Date(iso);
const iso = (d: Date) => d.toISOString();
const indices = (pred: (t: number) => boolean) => bars.map((_, t) => t).filter(pred);

describe('US session calendar', () => {
  it('projects the next 4h bar open over nights and weekends', () => {
    expect(iso(nextUsBarOpen(at('2026-06-03T13:30:00Z')))).toBe('2026-06-03T17:30:00.000Z');
    expect(iso(nextUsBarOpen(at('2026-06-03T17:30:00Z')))).toBe('2026-06-04T13:30:00.000Z');
    // Friday afternoon → Monday morning.
    expect(iso(nextUsBarOpen(at('2026-06-05T17:30:00Z')))).toBe('2026-06-08T13:30:00.000Z');
    // Winter time: 09:30 New York is 14:30 UTC.
    expect(iso(nextUsBarOpen(at('2026-01-07T18:30:00Z')))).toBe('2026-01-08T14:30:00.000Z');
  });

  it('puts the report gap at the open that first trades on it', () => {
    // After the close (20:30 New York): next morning.
    expect(iso(usReportGap(at('2026-06-04T00:30:00Z')))).toBe('2026-06-04T13:30:00.000Z');
    // Before the open, or filed during the session after a pre-market release: that morning.
    expect(iso(usReportGap(at('2026-06-03T11:05:00Z')))).toBe('2026-06-03T13:30:00.000Z');
    expect(iso(usReportGap(at('2026-06-03T15:00:00Z')))).toBe('2026-06-03T13:30:00.000Z');
    // Friday evening and Saturday: Monday morning.
    expect(iso(usReportGap(at('2026-06-05T21:00:00Z')))).toBe('2026-06-08T13:30:00.000Z');
    expect(iso(usReportGap(at('2026-06-06T15:00:00Z')))).toBe('2026-06-08T13:30:00.000Z');
  });
});

describe('earningsFilter', () => {
  // Wednesday after the close → gap at Thursday's open, bar 6.
  const report = at('2026-06-04T00:30:00Z');

  it('forces the exit at the last bar whose next fill is before the gap', () => {
    const f = earningsFilter(bars, [report], { exitBefore: true, blockEntryDays: 0 });
    // Bar 4 (Wed 09:30): fills at Wed 13:30, before the gap. Bar 5 is the fallback.
    expect(indices((t) => f.forceExit(t) !== null)).toEqual([4, 5]);
    expect(indices((t) => f.blockEntry(t))).toEqual([4, 5]);
  });

  it('works before the report bar exists (live trading)', () => {
    const f = earningsFilter(bars.slice(0, 5), [report], { exitBefore: true, blockEntryDays: 0 });
    expect(f.forceExit(4)).not.toBeNull();
  });

  it('blocks entries for the given days before the gap, without forcing exits', () => {
    const f = earningsFilter(bars, [report], { exitBefore: false, blockEntryDays: 2 });
    // Gap Thu 13:30 UTC; two days earlier is Tue 13:30 UTC = bar 2.
    expect(indices((t) => f.blockEntry(t))).toEqual([2, 3, 4, 5]);
    expect(indices((t) => f.forceExit(t) !== null)).toEqual([]);
  });
});

describe('backtest with the earnings filter', () => {
  /** Enters whenever flat, never exits on its own. */
  const always: StrategyRunner = {
    warmup: 0,
    entry: () => ({ strength: 1, reason: 'always', indicators: {} }),
    exit: () => null,
  };
  const run = (filter?: ReturnType<typeof earningsFilter>) =>
    runBacktest({
      bars,
      runner: always,
      initialCapital: 10_000,
      execution: { feeBps: 0, slippageBps: 0, minFee: 0 },
      sizing: { type: 'all_in' },
      filter,
    });

  it('is flat at the gap and enters again after it', () => {
    expect(run().trades.map((t) => t.exitReason)).toEqual(['end_of_data']);

    const [first, second] = run(
      earningsFilter(bars, [at('2026-06-04T00:30:00Z')], { exitBefore: true, blockEntryDays: 0 }),
    ).trades;
    expect(first.exitReason).toBe('earnings');
    // Exit decided at bar 4's close, filled at bar 5's open: before the gap at bar 6.
    expect(first.exitTime).toEqual(bars[5].openTime);
    // Entries resume at the gap bar's close: decided at 6, filled at 7.
    expect(second.entryTime).toEqual(bars[7].openTime);
  });
});
