import * as Joi from 'joi';
import { ema, rsi, supertrend } from '../indicators';
import { at, clamp01, defineStrategy, intParam, numParam, round, snapshot } from '../strategy';

interface Params extends Record<string, unknown> {
  stPeriod: number;
  stMultiplier: number;
  emaPeriod: number;
  rsiPeriod: number;
  pullbackLevel: number;
  rsiCeiling: number;
}

/**
 * Pullback within a trend: Supertrend and EMA say "uptrend", RSI dipped to the pullback zone
 * and turns up. Stop is the Supertrend line.
 */
export const pullbackSupertrendRsi = defineStrategy<Params>({
  code: 'pullback_supertrend_rsi',
  version: 1,
  name: 'Pullback: Supertrend + EMA + RSI turn',
  description:
    'BUY: Supertrend up, close > EMA, previous RSI ≤ pullbackLevel and RSI turning up (still below rsiCeiling). ' +
    'SELL: Supertrend turns down. Stop: the Supertrend line.',
  schema: Joi.object<Params>({
    stPeriod: intParam(10, 2, 100),
    stMultiplier: numParam(3, 0.5, 10),
    emaPeriod: intParam(50, 2, 300),
    rsiPeriod: intParam(14, 2, 100),
    pullbackLevel: numParam(50, 10, 60),
    rsiCeiling: numParam(65, 20, 90),
  }),
  warmupBars: (p) => Math.max(p.emaPeriod, p.rsiPeriod + 2, p.stPeriod + 1),
  rules: ({ close, high, low }, p) => {
    const st = supertrend({ high, low, close }, p.stPeriod, p.stMultiplier);
    const trend = ema(close, p.emaPeriod);
    const rsiLine = rsi(close, p.rsiPeriod);

    return {
      entry: (i) => {
        const v = at(i, { direction: st.direction, stop: st.value, ema: trend, rsi: rsiLine });
        const prevRsi = rsiLine[i - 1];
        if (!v || prevRsi === null) return null;
        const turnedUp = prevRsi <= p.pullbackLevel && v.rsi > prevRsi && v.rsi < p.rsiCeiling;
        if (!(v.direction === 1 && close[i] > v.ema && turnedUp)) return null;
        return {
          strength: round(0.5 + 0.5 * clamp01((p.pullbackLevel - prevRsi) / 15)),
          stopLoss: round(v.stop, 6),
          reason: `Supertrend up, close > EMA${p.emaPeriod}, RSI turned up from ${prevRsi.toFixed(1)}`,
          indicators: snapshot({ close: close[i], ...v, prevRsi }),
        };
      },
      exit: (i) => {
        if (st.direction[i] !== -1) return null;
        return {
          reason: 'Supertrend turned down',
          indicators: snapshot({ close: close[i], supertrend: st.value[i] ?? 0 }),
        };
      },
    };
  },
});
