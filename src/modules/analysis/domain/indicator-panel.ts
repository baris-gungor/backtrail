import type { Bar } from '../../market-data/domain/bar';
import { adx, atr, bollinger, ema, macd, rsi, supertrend } from './indicators';

export interface IndicatorPoint {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  atr14: number | null;
  adx14: number | null;
  supertrend: number | null;
  supertrendDirection: number | null;
}

/**
 * Standard indicator set for charts. Computed over the full history so warmup does not
 * affect the returned tail, then cut to the last `limit` points.
 */
export function indicatorPanel(bars: Bar[], limit: number): IndicatorPoint[] {
  const close = bars.map((b) => b.close);
  const hlc = { high: bars.map((b) => b.high), low: bars.map((b) => b.low), close };
  const e20 = ema(close, 20);
  const e50 = ema(close, 50);
  const e200 = ema(close, 200);
  const r = rsi(close, 14);
  const m = macd(close);
  const bb = bollinger(close, 20, 2);
  const a = atr(hlc, 14);
  const d = adx(hlc, 14).adx;
  const st = supertrend(hlc, 10, 3);

  const start = Math.max(0, bars.length - limit);
  return bars.slice(start).map((bar, k) => {
    const i = start + k;
    return {
      openTime: bar.openTime,
      open: bar.open,
      high: bar.high,
      low: bar.low,
      close: bar.close,
      volume: bar.volume,
      ema20: e20[i],
      ema50: e50[i],
      ema200: e200[i],
      rsi14: r[i],
      macd: m.macd[i],
      macdSignal: m.signal[i],
      macdHistogram: m.histogram[i],
      bbUpper: bb.upper[i],
      bbMiddle: bb.middle[i],
      bbLower: bb.lower[i],
      atr14: a[i],
      adx14: d[i],
      supertrend: st.value[i],
      supertrendDirection: st.direction[i],
    };
  });
}
