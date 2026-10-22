import * as Joi from 'joi';
import { atr, donchian, sma } from '../indicators';
import { at, clamp01, defineStrategy, intParam, numParam, round, snapshot } from '../strategy';

interface Params extends Record<string, unknown> {
  entryPeriod: number;
  exitPeriod: number;
  atrPeriod: number;
  atrSmaPeriod: number;
  useVolume: boolean;
  volPeriod: number;
  stopAtr: number;
}

/**
 * Breakout (Turtle style): close above the prior N-bar high while volatility expands,
 * confirmed by volume. Exits on a shorter opposite channel.
 */
export const breakoutDonchianAtr = defineStrategy<Params>({
  code: 'breakout_donchian_atr',
  version: 1,
  name: 'Breakout: Donchian + expanding ATR + volume',
  description:
    'BUY: close above the highest high of the previous entryPeriod bars, ATR > SMA(ATR) and volume > SMA(volume). ' +
    'SELL: close below the lowest low of the previous exitPeriod bars. Stop: close - stopAtr × ATR. ' +
    'Short (optional): breakdown below the lower channel, exit at the upper channel; stop close + stopAtr × ATR.',
  schema: Joi.object<Params>({
    entryPeriod: intParam(20, 2, 300),
    exitPeriod: intParam(10, 2, 300),
    atrPeriod: intParam(14, 2, 100),
    atrSmaPeriod: intParam(20, 2, 200),
    useVolume: Joi.boolean().default(true),
    volPeriod: intParam(20, 2, 200),
    stopAtr: numParam(2, 0.1, 20),
  }),
  warmupBars: (p) =>
    Math.max(p.entryPeriod, p.exitPeriod, p.atrPeriod + p.atrSmaPeriod, p.volPeriod),
  rules: ({ close, high, low, volume }, p) => {
    const entryChannel = donchian(high, low, p.entryPeriod);
    const exitChannel = donchian(high, low, p.exitPeriod);
    const range = atr({ high, low, close }, p.atrPeriod);
    const rangeSma = sma(range, p.atrSmaPeriod);
    const volSma = sma(volume, p.volPeriod);

    return {
      entry: (i) => {
        const v = at(i, { upper: entryChannel.upper, atr: range, atrSma: rangeSma, volSma });
        if (!v || !(close[i] > v.upper && v.atr > v.atrSma)) return null;
        if (p.useVolume && !(volume[i] > v.volSma)) return null;
        return {
          strength: round(0.5 + 0.5 * clamp01((close[i] - v.upper) / v.atr)),
          stopLoss: round(close[i] - p.stopAtr * v.atr, 6),
          reason: `close broke above ${p.entryPeriod}-bar high ${v.upper.toFixed(2)}, ATR expanding`,
          indicators: snapshot({ close: close[i], ...v, volume: volume[i] }),
        };
      },
      exit: (i) => {
        const lower = exitChannel.lower[i];
        if (lower === null || !(close[i] < lower)) return null;
        return {
          reason: `close fell below ${p.exitPeriod}-bar low ${lower.toFixed(2)}`,
          indicators: snapshot({ close: close[i], lower }),
        };
      },
      // Mirror image for shorts: breakdown below the channel, ATR expanding.
      shortEntry: (i) => {
        const v = at(i, { lower: entryChannel.lower, atr: range, atrSma: rangeSma, volSma });
        if (!v || !(close[i] < v.lower && v.atr > v.atrSma)) return null;
        if (p.useVolume && !(volume[i] > v.volSma)) return null;
        return {
          strength: round(0.5 + 0.5 * clamp01((v.lower - close[i]) / v.atr)),
          stopLoss: round(close[i] + p.stopAtr * v.atr, 6),
          reason: `close broke below ${p.entryPeriod}-bar low ${v.lower.toFixed(2)}, ATR expanding`,
          indicators: snapshot({ close: close[i], ...v, volume: volume[i] }),
        };
      },
      shortExit: (i) => {
        const upper = exitChannel.upper[i];
        if (upper === null || !(close[i] > upper)) return null;
        return {
          reason: `close rose above ${p.exitPeriod}-bar high ${upper.toFixed(2)}`,
          indicators: snapshot({ close: close[i], upper }),
        };
      },
    };
  },
});
