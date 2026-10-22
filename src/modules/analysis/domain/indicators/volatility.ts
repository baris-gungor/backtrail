import { rma } from './moving-averages';
import { nulls, Series } from './series';

export interface Hlc {
  high: number[];
  low: number[];
  close: number[];
}

/** True range. Index 0 is null because it needs the previous close. */
export function trueRange({ high, low, close }: Hlc): Series {
  return high.map((h, i) => {
    if (i === 0) return null;
    const prevClose = close[i - 1];
    return Math.max(h - low[i], Math.abs(h - prevClose), Math.abs(low[i] - prevClose));
  });
}

/** Average True Range (Wilder). First value at index `period` (TA-Lib convention). */
export function atr(bars: Hlc, period = 14): Series {
  return rma(trueRange(bars), period);
}

export interface AdxResult {
  adx: Series;
  plusDI: Series;
  minusDI: Series;
}

/** Average Directional Index (Wilder). DI from index `period`, ADX from index `2 * period - 1`. */
export function adx(bars: Hlc, period = 14): AdxResult {
  const { high, low } = bars;
  const n = high.length;
  const plusDM: Series = [null];
  const minusDM: Series = [null];
  for (let i = 1; i < n; i++) {
    const up = high[i] - high[i - 1];
    const down = low[i - 1] - low[i];
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }

  // Wilder smoothing of sums and of averages differ only by the factor `period`, which cancels in DI.
  const tr = rma(trueRange(bars), period);
  const pdm = rma(plusDM, period);
  const mdm = rma(minusDM, period);

  const plusDI = nulls(n);
  const minusDI = nulls(n);
  const dx = nulls(n);
  for (let i = 0; i < n; i++) {
    const t = tr[i];
    const p = pdm[i];
    const m = mdm[i];
    if (t === null || p === null || m === null) continue;
    const pdi = t === 0 ? 0 : (100 * p) / t;
    const mdi = t === 0 ? 0 : (100 * m) / t;
    plusDI[i] = pdi;
    minusDI[i] = mdi;
    dx[i] = pdi + mdi === 0 ? 0 : (100 * Math.abs(pdi - mdi)) / (pdi + mdi);
  }

  return { adx: rma(dx, period), plusDI, minusDI };
}

export interface ChannelResult {
  upper: Series;
  lower: Series;
  middle: Series;
}

/**
 * Donchian channel over the previous `period` bars, excluding the current bar,
 * so `close > upper` means a breakout above the prior range.
 */
export function donchian(high: number[], low: number[], period = 20): ChannelResult {
  const n = high.length;
  const result: ChannelResult = { upper: nulls(n), lower: nulls(n), middle: nulls(n) };
  for (let i = period; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period; j < i; j++) {
      hi = Math.max(hi, high[j]);
      lo = Math.min(lo, low[j]);
    }
    result.upper[i] = hi;
    result.lower[i] = lo;
    result.middle[i] = (hi + lo) / 2;
  }
  return result;
}

export interface SupertrendResult {
  /** Active band: lower band in an uptrend (support), upper band in a downtrend (resistance). */
  value: Series;
  /** 1 = up, -1 = down, null during warmup */
  direction: Series;
}

export function supertrend(bars: Hlc, period = 10, multiplier = 3): SupertrendResult {
  const { high, low, close } = bars;
  const n = close.length;
  const range = atr(bars, period);
  const value = nulls(n);
  const direction = nulls(n);

  let upper = 0;
  let lower = 0;
  let dir = 0;
  for (let i = 0; i < n; i++) {
    const a = range[i];
    if (a === null) continue;
    const mid = (high[i] + low[i]) / 2;
    const basicUpper = mid + multiplier * a;
    const basicLower = mid - multiplier * a;

    if (dir === 0) {
      upper = basicUpper;
      lower = basicLower;
      dir = close[i] >= mid ? 1 : -1;
    } else {
      const prevClose = close[i - 1];
      upper = basicUpper < upper || prevClose > upper ? basicUpper : upper;
      lower = basicLower > lower || prevClose < lower ? basicLower : lower;
      if (dir === 1 && close[i] < lower) dir = -1;
      else if (dir === -1 && close[i] > upper) dir = 1;
    }

    direction[i] = dir;
    value[i] = dir === 1 ? lower : upper;
  }
  return { value, direction };
}
