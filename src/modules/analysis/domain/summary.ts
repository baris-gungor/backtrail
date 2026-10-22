import type { Bar } from '../../market-data/domain/bar';
import { adx, atr, bollinger, ema, macd, rsi, Series } from './indicators';
import type { SignalSide } from './strategy';
import { round } from './strategy';

export type TrendState = 'up' | 'down' | 'sideways';
export type MomentumState = 'bullish' | 'bearish' | 'neutral';
export type VolatilityState = 'low' | 'normal' | 'high';

export interface StrategyState {
  code: string;
  configId: string;
  configName: string;
  position: 'long' | 'flat';
  lastSignal: {
    side: SignalSide;
    barTime: Date;
    strength: number;
    price: number;
    stopLoss: number | null;
    reason: string;
  } | null;
}

export interface AssetSummary {
  asOf: Date;
  price: number;
  trend: {
    state: TrendState;
    ema20: number | null;
    ema50: number | null;
    ema200: number | null;
    /** e.g. "20>50>200" */
    emaAlignment: string | null;
    adx: number | null;
    priceVsEma200Pct: number | null;
  };
  momentum: {
    state: MomentumState;
    rsi: number | null;
    macdHistogram: number | null;
  };
  volatility: {
    state: VolatilityState;
    atr: number | null;
    atrPct: number | null;
    bollingerBandwidth: number | null;
    /** Percentile of the current bandwidth within the last `VOL_LOOKBACK` bars, 0..1 */
    bandwidthPercentile: number | null;
  };
  strategies: StrategyState[];
  consensus: {
    long: number;
    flat: number;
    /** Strength-weighted share of strategies currently long, 0..1. Informational only. */
    score: number;
  };
}

const VOL_LOOKBACK = 120;
const lastOf = (s: Series): number | null => (s.length ? s[s.length - 1] : null);

function trendState(close: number, e50: number | null, e200: number | null): TrendState {
  if (e50 === null || e200 === null) return 'sideways';
  if (close > e200 && e50 > e200) return 'up';
  if (close < e200 && e50 < e200) return 'down';
  return 'sideways';
}

function emaAlignment(values: [number, number | null][]): string | null {
  if (values.some(([, v]) => v === null)) return null;
  return [...values]
    .sort((a, b) => b[1]! - a[1]!)
    .map(([period]) => period)
    .join('>');
}

function percentileOfLast(values: Series, lookback: number): number | null {
  const window = values.slice(-lookback).filter((v): v is number => v !== null);
  const current = window[window.length - 1];
  if (current === undefined || window.length < 20) return null;
  return window.filter((v) => v <= current).length / window.length;
}

/** Summary of the latest closed bar. Bars must be closed and ascending. */
export function summarize(bars: Bar[], strategies: StrategyState[]): AssetSummary | null {
  if (bars.length === 0) return null;
  const close = bars.map((b) => b.close);
  const high = bars.map((b) => b.high);
  const low = bars.map((b) => b.low);
  const price = close[close.length - 1];

  const e20 = lastOf(ema(close, 20));
  const e50 = lastOf(ema(close, 50));
  const e200 = lastOf(ema(close, 200));
  const adxValue = lastOf(adx({ high, low, close }, 14).adx);
  const rsiValue = lastOf(rsi(close, 14));
  const hist = lastOf(macd(close).histogram);
  const atrValue = lastOf(atr({ high, low, close }, 14));
  const bandwidth = bollinger(close, 20, 2).bandwidth;
  const bwPercentile = percentileOfLast(bandwidth, VOL_LOOKBACK);

  let momentum: MomentumState = 'neutral';
  if (rsiValue !== null && hist !== null) {
    if (rsiValue > 50 && hist > 0) momentum = 'bullish';
    else if (rsiValue < 50 && hist < 0) momentum = 'bearish';
  }

  let volatility: VolatilityState = 'normal';
  if (bwPercentile !== null && bwPercentile < 0.2) volatility = 'low';
  if (bwPercentile !== null && bwPercentile > 0.8) volatility = 'high';

  const active = strategies.length;
  const long = strategies.filter((s) => s.position === 'long');
  const weighted = long.reduce((sum, s) => sum + (s.lastSignal?.strength ?? 0), 0);
  const maybe = (v: number | null, digits = 4) => (v === null ? null : round(v, digits));

  return {
    asOf: bars[bars.length - 1].openTime,
    price,
    trend: {
      state: trendState(price, e50, e200),
      ema20: maybe(e20),
      ema50: maybe(e50),
      ema200: maybe(e200),
      emaAlignment: emaAlignment([
        [20, e20],
        [50, e50],
        [200, e200],
      ]),
      adx: maybe(adxValue, 2),
      priceVsEma200Pct: e200 === null ? null : round(((price - e200) / e200) * 100, 2),
    },
    momentum: { state: momentum, rsi: maybe(rsiValue, 2), macdHistogram: maybe(hist) },
    volatility: {
      state: volatility,
      atr: maybe(atrValue),
      atrPct: atrValue === null ? null : round((atrValue / price) * 100, 3),
      bollingerBandwidth: maybe(lastOf(bandwidth)),
      bandwidthPercentile: maybe(bwPercentile, 2),
    },
    strategies,
    consensus: {
      long: long.length,
      flat: active - long.length,
      score: active === 0 ? 0 : round(weighted / active, 2),
    },
  };
}
