import { StrategyDefinition } from '../strategy';
import { breakoutDonchianAtr } from './breakout-donchian-atr';
import { buyAndHold } from './buy-and-hold';
import { meanrevBbRsi } from './meanrev-bb-rsi';
import { momentumMacdRsiVol } from './momentum-macd-rsi-vol';
import { pullbackSupertrendRsi } from './pullback-supertrend-rsi';
import { trendEmaAdx } from './trend-ema-adx';

/** All strategies known to the system. Synced to the `strategies` table on startup. */
export const STRATEGIES: readonly StrategyDefinition[] = [
  trendEmaAdx,
  meanrevBbRsi,
  momentumMacdRsiVol,
  breakoutDonchianAtr,
  pullbackSupertrendRsi,
  buyAndHold,
];

export function findStrategy(code: string): StrategyDefinition | undefined {
  return STRATEGIES.find((s) => s.code === code);
}
