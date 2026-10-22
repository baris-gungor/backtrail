import * as Joi from 'joi';
import { atr, macd, rsi, sma } from '../indicators';
import { at, clamp01, defineStrategy, intParam, numParam, round, snapshot } from '../strategy';

interface Params extends Record<string, unknown> {
  fast: number;
  slow: number;
  signal: number;
  rsiPeriod: number;
  rsiMin: number;
  rsiMax: number;
  rsiOverbought: number;
  useVolume: boolean;
  volPeriod: number;
  volMult: number;
  atrPeriod: number;
  stopAtr: number;
}

/**
 * Momentum: MACD histogram turns positive while RSI shows strength without being overbought,
 * confirmed by above-average volume.
 */
export const momentumMacdRsiVol = defineStrategy<Params>({
  code: 'momentum_macd_rsi_vol',
  version: 1,
  name: 'Momentum: MACD + RSI + volume',
  description:
    'BUY: MACD histogram crosses above 0, rsiMin ≤ RSI ≤ rsiMax and volume > volMult × SMA(volume). ' +
    'SELL: histogram crosses below 0, or RSI went above rsiOverbought since entry and fell back below rsiMax.',
  schema: Joi.object<Params>({
    fast: intParam(12, 2, 100),
    slow: intParam(26, 3, 200),
    signal: intParam(9, 2, 100),
    rsiPeriod: intParam(14, 2, 100),
    rsiMin: numParam(50, 0, 100),
    rsiMax: numParam(70, 0, 100),
    rsiOverbought: numParam(75, 0, 100),
    useVolume: Joi.boolean().default(true),
    volPeriod: intParam(20, 2, 200),
    volMult: numParam(1.2, 0, 10),
    atrPeriod: intParam(14, 2, 100),
    stopAtr: numParam(2, 0.1, 20),
  }).custom((p: Params, helpers) =>
    p.fast < p.slow ? p : helpers.message({ custom: 'require fast < slow' }),
  ),
  warmupBars: (p) => Math.max(p.slow + p.signal, p.rsiPeriod + 1, p.volPeriod, p.atrPeriod + 1),
  rules: ({ close, high, low, volume }, p) => {
    const m = macd(close, p.fast, p.slow, p.signal);
    const rsiLine = rsi(close, p.rsiPeriod);
    const volSma = sma(volume, p.volPeriod);
    const range = atr({ high, low, close }, p.atrPeriod);

    return {
      entry: (i) => {
        const v = at(i, { hist: m.histogram, rsi: rsiLine, volSma, atr: range });
        const prevHist = m.histogram[i - 1];
        if (!v || prevHist === null || !(prevHist <= 0 && v.hist > 0)) return null;
        if (v.rsi < p.rsiMin || v.rsi > p.rsiMax) return null;
        const volRatio = v.volSma > 0 ? volume[i] / v.volSma : 0;
        if (p.useVolume && volRatio <= p.volMult) return null;

        const volScore = p.useVolume ? clamp01((volRatio - p.volMult) / p.volMult) : 0.5;
        return {
          strength: round(0.5 + 0.25 * clamp01((v.rsi - p.rsiMin) / 10) + 0.25 * volScore),
          stopLoss: round(close[i] - p.stopAtr * v.atr, 6),
          reason:
            `MACD histogram crossed above 0, RSI ${v.rsi.toFixed(1)}` +
            (p.useVolume ? `, volume ${volRatio.toFixed(2)}x average` : ''),
          indicators: snapshot({ close: close[i], ...v, volume: volume[i] }),
        };
      },
      exit: (i, entryIndex) => {
        const v = at(i, { hist: m.histogram, rsi: rsiLine });
        if (!v) return null;
        const indicators = snapshot(v);
        if (v.hist < 0) return { reason: 'MACD histogram crossed below 0', indicators };

        let peak = 0;
        for (let j = entryIndex + 1; j < i; j++) peak = Math.max(peak, rsiLine[j] ?? 0);
        if (peak > p.rsiOverbought && v.rsi < p.rsiMax) {
          return { reason: `RSI fell back below ${p.rsiMax} after ${peak.toFixed(1)}`, indicators };
        }
        return null;
      },
    };
  },
});
