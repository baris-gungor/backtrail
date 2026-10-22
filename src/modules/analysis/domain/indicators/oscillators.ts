import { ema, rma } from './moving-averages';
import { nulls, Series } from './series';

/** Relative Strength Index with Wilder smoothing. First value at index `period`. */
export function rsi(close: number[], period = 14): Series {
  const gains: Series = [null];
  const losses: Series = [null];
  for (let i = 1; i < close.length; i++) {
    const change = close[i] - close[i - 1];
    gains.push(Math.max(change, 0));
    losses.push(Math.max(-change, 0));
  }
  const avgGain = rma(gains, period);
  const avgLoss = rma(losses, period);

  return close.map((_, i) => {
    const g = avgGain[i];
    const l = avgLoss[i];
    if (g === null || l === null) return null;
    if (l === 0) return g === 0 ? 50 : 100;
    return 100 - 100 / (1 + g / l);
  });
}

export interface MacdResult {
  macd: Series;
  signal: Series;
  histogram: Series;
}

export function macd(close: number[], fast = 12, slow = 26, signalPeriod = 9): MacdResult {
  const fastEma = ema(close, fast);
  const slowEma = ema(close, slow);
  const line: Series = close.map((_, i) => {
    const f = fastEma[i];
    const s = slowEma[i];
    return f === null || s === null ? null : f - s;
  });
  const signal = ema(line, signalPeriod);
  const histogram = line.map((m, i) => {
    const s = signal[i];
    return m === null || s === null ? null : m - s;
  });
  return { macd: line, signal, histogram };
}

export interface BollingerResult {
  upper: Series;
  middle: Series;
  lower: Series;
  /** (upper - lower) / middle */
  bandwidth: Series;
  /** (close - lower) / (upper - lower); 0.5 when the bands collapse */
  percentB: Series;
}

/** Bollinger Bands with population standard deviation. */
export function bollinger(close: number[], period = 20, stdDev = 2): BollingerResult {
  const n = close.length;
  const result: BollingerResult = {
    upper: nulls(n),
    middle: nulls(n),
    lower: nulls(n),
    bandwidth: nulls(n),
    percentB: nulls(n),
  };
  for (let i = period - 1; i < n; i++) {
    let mean = 0;
    for (let j = i - period + 1; j <= i; j++) mean += close[j];
    mean /= period;
    let variance = 0;
    for (let j = i - period + 1; j <= i; j++) variance += (close[j] - mean) ** 2;
    const sd = Math.sqrt(variance / period);

    const upper = mean + stdDev * sd;
    const lower = mean - stdDev * sd;
    result.middle[i] = mean;
    result.upper[i] = upper;
    result.lower[i] = lower;
    result.bandwidth[i] = mean === 0 ? null : (upper - lower) / mean;
    result.percentB[i] = upper === lower ? 0.5 : (close[i] - lower) / (upper - lower);
  }
  return result;
}
