import { firstValid, nulls, Series } from './series';

/** Simple moving average. */
export function sma(values: Series, period: number): Series {
  const out = nulls(values.length);
  let sum = 0;
  let count = 0;
  for (let i = 0; i < values.length; i++) {
    const v = values[i];
    if (v === null) {
      sum = 0;
      count = 0;
      continue;
    }
    sum += v;
    count++;
    if (count > period) {
      sum -= values[i - period]!;
      count = period;
    }
    if (count === period) out[i] = sum / period;
  }
  return out;
}

/**
 * Exponential smoothing seeded with the SMA of the first `period` valid values.
 * Leading nulls are skipped, so it works on derived series such as the MACD line.
 */
function smooth(values: Series, period: number, alpha: number): Series {
  const out = nulls(values.length);
  const start = firstValid(values);
  if (start < 0 || values.length - start < period) return out;

  let prev = 0;
  for (let i = start; i < start + period; i++) prev += values[i]!;
  prev /= period;
  out[start + period - 1] = prev;

  for (let i = start + period; i < values.length; i++) {
    const v = values[i];
    if (v === null) return out;
    prev = prev + alpha * (v - prev);
    out[i] = prev;
  }
  return out;
}

/** Exponential moving average, alpha = 2 / (period + 1). */
export function ema(values: Series, period: number): Series {
  return smooth(values, period, 2 / (period + 1));
}

/** Wilder's moving average (RMA / SMMA), alpha = 1 / period. Used by RSI, ATR, ADX. */
export function rma(values: Series, period: number): Series {
  return smooth(values, period, 1 / period);
}
