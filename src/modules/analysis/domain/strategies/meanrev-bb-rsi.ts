import * as Joi from 'joi';
import { atr, bollinger, ema, rsi } from '../indicators';
import { at, clamp01, defineStrategy, intParam, numParam, round, snapshot } from '../strategy';

interface Params extends Record<string, unknown> {
  bbPeriod: number;
  bbStd: number;
  rsiPeriod: number;
  rsiEntry: number;
  rsiExit: number;
  trend: number;
  maxBars: number;
  atrPeriod: number;
  stopAtr: number;
}

/**
 * Mean reversion inside an uptrend: buy oversold dips (below the lower Bollinger band with
 * low RSI) only while price stays above the long-term EMA.
 */
export const meanrevBbRsi = defineStrategy<Params>({
  code: 'meanrev_bb_rsi',
  version: 1,
  name: 'Mean reversion: Bollinger + RSI, trend-filtered',
  description:
    'BUY: close below the lower Bollinger band, RSI < rsiEntry and close > EMA(trend). ' +
    'SELL: close above the middle band, RSI > rsiExit or after maxBars bars. Stop: close - stopAtr × ATR.',
  schema: Joi.object<Params>({
    bbPeriod: intParam(20, 5, 200),
    bbStd: numParam(2, 0.5, 5),
    rsiPeriod: intParam(14, 2, 100),
    rsiEntry: numParam(35, 1, 50),
    rsiExit: numParam(55, 30, 99),
    trend: intParam(200, 5, 500),
    maxBars: intParam(10, 1, 200),
    atrPeriod: intParam(14, 2, 100),
    stopAtr: numParam(2, 0.1, 20),
  }),
  warmupBars: (p) => Math.max(p.trend, p.bbPeriod, p.rsiPeriod + 1, p.atrPeriod + 1),
  rules: ({ close, high, low }, p) => {
    const bb = bollinger(close, p.bbPeriod, p.bbStd);
    const rsiLine = rsi(close, p.rsiPeriod);
    const trend = ema(close, p.trend);
    const range = atr({ high, low, close }, p.atrPeriod);

    return {
      entry: (i) => {
        const v = at(i, { lower: bb.lower, rsi: rsiLine, trend, atr: range });
        if (!v || !(close[i] < v.lower && v.rsi < p.rsiEntry && close[i] > v.trend)) return null;
        return {
          strength: round(0.5 + 0.5 * clamp01((p.rsiEntry - v.rsi) / 15)),
          stopLoss: round(close[i] - p.stopAtr * v.atr, 6),
          reason: `close < lower band, RSI ${v.rsi.toFixed(1)} < ${p.rsiEntry}, above EMA${p.trend}`,
          indicators: snapshot({ close: close[i], ...v }),
        };
      },
      exit: (i, entryIndex) => {
        const v = at(i, { middle: bb.middle, rsi: rsiLine });
        if (!v) return null;
        const indicators = snapshot({ close: close[i], ...v });
        if (close[i] >= v.middle) return { reason: 'close reached middle band', indicators };
        if (v.rsi > p.rsiExit)
          return { reason: `RSI ${v.rsi.toFixed(1)} > ${p.rsiExit}`, indicators };
        if (i - entryIndex >= p.maxBars)
          return { reason: `time stop after ${p.maxBars} bars`, indicators };
        return null;
      },
    };
  },
});
