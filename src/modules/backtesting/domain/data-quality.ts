import { atr } from '../../analysis/domain/indicators';
import { toSeries } from '../../analysis/domain/strategy';
import type { Bar } from '../../market-data/domain/bar';

export interface DataQualityReport {
  /**
   * Bars that opened more than `JUMP_ATR` ATRs away from the previous close.
   * In continuous futures series these are often contract rolls, which create fake PnL.
   */
  jumps: number;
  /** First few jump bar times (ISO). */
  jumpTimes: string[];
  /** Holes longer than `GAP_DAYS` between consecutive bars (missing data, not weekends). */
  gaps: number;
  maxGapDays: number;
  /** Set when the run used roll-adjusted prices: roll jumps removed in the traded window. */
  rollAdjustments?: number;
}

export const JUMP_ATR = 3;
export const GAP_DAYS = 4;
/**
 * A roll happens while the market trades: the jump bar follows the previous bar within this many
 * hours. Larger spacing (weekends, holidays) means a real overnight gap, which is left alone.
 */
export const ROLL_MAX_SPACING_HOURS = 8;
const LISTED_JUMPS = 20;
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

/** Indices of bars that opened more than `JUMP_ATR` ATRs from the previous close. */
export function jumpIndices(bars: Bar[]): number[] {
  const range = atr(toSeries(bars), 14);
  const jumps: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prevAtr = range[i - 1];
    if (prevAtr && Math.abs(bars[i].open - bars[i - 1].close) > JUMP_ATR * prevAtr) jumps.push(i);
  }
  return jumps;
}

export function dataQuality(bars: Bar[]): DataQualityReport {
  const jumps = jumpIndices(bars);
  let gaps = 0;
  let maxGapDays = 0;
  for (let i = 1; i < bars.length; i++) {
    const days = (bars[i].openTime.getTime() - bars[i - 1].openTime.getTime()) / DAY_MS;
    if (days > GAP_DAYS) {
      gaps++;
      maxGapDays = Math.max(maxGapDays, days);
    }
  }
  return {
    jumps: jumps.length,
    jumpTimes: jumps.slice(0, LISTED_JUMPS).map((i) => bars[i].openTime.toISOString()),
    gaps,
    maxGapDays: Number(maxGapDays.toFixed(2)),
  };
}

/**
 * Ratio back-adjustment of futures roll jumps. For each roll candidate
 * (a jump within `ROLL_MAX_SPACING_HOURS` of the previous bar), every earlier bar is scaled by
 * open / previous close, so the series has no jump there and the latest prices stay real.
 * Returns are unchanged everywhere else; earlier price levels are no longer real prices.
 * The input is not modified.
 */
export function adjustRolls(bars: Bar[]): { bars: Bar[]; rolls: number[] } {
  const rolls = jumpIndices(bars).filter(
    (i) =>
      bars[i].openTime.getTime() - bars[i - 1].openTime.getTime() <=
      ROLL_MAX_SPACING_HOURS * HOUR_MS,
  );
  if (rolls.length === 0) return { bars, rolls };
  const adjusted = bars.map((b) => ({ ...b }));
  let factor = 1;
  let next = rolls.length - 1;
  for (let i = bars.length - 1; i >= 0; i--) {
    // Bars before a roll bar take its ratio on top of all later rolls'.
    while (next >= 0 && rolls[next] > i) {
      const r = rolls[next];
      factor *= bars[r].open / bars[r - 1].close;
      next--;
    }
    if (factor !== 1) {
      const b = adjusted[i];
      b.open *= factor;
      b.high *= factor;
      b.low *= factor;
      b.close *= factor;
    }
  }
  return { bars: adjusted, rolls };
}
