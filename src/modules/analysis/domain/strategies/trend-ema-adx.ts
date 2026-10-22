import * as Joi from 'joi';
import { adx, atr, ema } from '../indicators';
import { at, clamp01, defineStrategy, intParam, numParam, round, snapshot } from '../strategy';

interface Params extends Record<string, unknown> {
  fast: number;
  slow: number;
  trend: number;
  adxPeriod: number;
  adxMin: number;
  atrPeriod: number;
  stopAtr: number;
}

/**
 * Trend following: fast EMA above slow EMA, price above the long-term EMA, and ADX confirms
 * that a trend exists (filters crossovers in sideways markets).
 */
export const trendEmaAdx = defineStrategy<Params>({
  code: 'trend_ema_adx',
  version: 1,
  name: 'Trend: EMA crossover + ADX + EMA200 filter',
  description:
    'BUY: EMA(fast) > EMA(slow), close > EMA(trend) and ADX > adxMin. ' +
    'SELL: EMA(fast) < EMA(slow) or close < EMA(trend). Stop: close - stopAtr × ATR. ' +
    'Short (optional): mirrored rules, stop close + stopAtr × ATR.',
  schema: Joi.object<Params>({
    fast: intParam(20, 2, 200),
    slow: intParam(50, 3, 300),
    trend: intParam(200, 5, 500),
    adxPeriod: intParam(14, 2, 100),
    adxMin: numParam(20, 0, 100),
    atrPeriod: intParam(14, 2, 100),
    stopAtr: numParam(2.5, 0.1, 20),
  }).custom((p: Params, helpers) =>
    p.fast < p.slow && p.slow < p.trend
      ? p
      : helpers.message({ custom: 'require fast < slow < trend' }),
  ),
  warmupBars: (p) => Math.max(p.trend, 2 * p.adxPeriod, p.atrPeriod + 1),
  rules: ({ close, high, low }, p) => {
    const fast = ema(close, p.fast);
    const slow = ema(close, p.slow);
    const trend = ema(close, p.trend);
    const { adx: adxLine } = adx({ high, low, close }, p.adxPeriod);
    const range = atr({ high, low, close }, p.atrPeriod);

    return {
      entry: (i) => {
        const v = at(i, { fast, slow, trend, adx: adxLine, atr: range });
        if (!v || !(v.fast > v.slow && close[i] > v.trend && v.adx > p.adxMin)) return null;
        return {
          strength: round(0.5 + 0.5 * clamp01((v.adx - p.adxMin) / 20)),
          stopLoss: round(close[i] - p.stopAtr * v.atr, 6),
          reason: `EMA${p.fast} > EMA${p.slow}, close > EMA${p.trend}, ADX ${v.adx.toFixed(1)} > ${p.adxMin}`,
          indicators: snapshot({ close: close[i], ...v }),
        };
      },
      exit: (i) => {
        const v = at(i, { fast, slow, trend });
        if (!v) return null;
        if (v.fast < v.slow) {
          return { reason: `EMA${p.fast} crossed below EMA${p.slow}`, indicators: snapshot(v) };
        }
        if (close[i] < v.trend) {
          return {
            reason: `close fell below EMA${p.trend}`,
            indicators: snapshot({ close: close[i], ...v }),
          };
        }
        return null;
      },
      // Mirror image for shorts: downtrend with the same ADX strength filter.
      shortEntry: (i) => {
        const v = at(i, { fast, slow, trend, adx: adxLine, atr: range });
        if (!v || !(v.fast < v.slow && close[i] < v.trend && v.adx > p.adxMin)) return null;
        return {
          strength: round(0.5 + 0.5 * clamp01((v.adx - p.adxMin) / 20)),
          stopLoss: round(close[i] + p.stopAtr * v.atr, 6),
          reason: `EMA${p.fast} < EMA${p.slow}, close < EMA${p.trend}, ADX ${v.adx.toFixed(1)} > ${p.adxMin}`,
          indicators: snapshot({ close: close[i], ...v }),
        };
      },
      shortExit: (i) => {
        const v = at(i, { fast, slow, trend });
        if (!v) return null;
        if (v.fast > v.slow) {
          return { reason: `EMA${p.fast} crossed above EMA${p.slow}`, indicators: snapshot(v) };
        }
        if (close[i] > v.trend) {
          return {
            reason: `close rose above EMA${p.trend}`,
            indicators: snapshot({ close: close[i], ...v }),
          };
        }
        return null;
      },
    };
  },
});
