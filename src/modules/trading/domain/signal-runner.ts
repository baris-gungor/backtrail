import type { SignalSide, StrategyRunner } from '../../analysis/domain/strategy';
import type { Bar } from '../../market-data/domain/bar';

export interface StoredSignal {
  barTime: Date;
  side: SignalSide;
  strength: number;
  stopLoss: number | null;
  takeProfit: number | null;
  reason: string;
  indicators: Record<string, number>;
}

/**
 * A runner that replays stored signals instead of evaluating the strategy rules: a BUY on bar i is
 * an entry decision, a SELL an exit decision. It lets the `signals` subscription source use the
 * same execution path (`stepBar`) as the `strategy` source.
 */
export function signalRunner(bars: Bar[], signals: StoredSignal[]): StrategyRunner {
  const byTime = new Map(signals.map((s) => [s.barTime.getTime(), s]));
  const at = (i: number) => byTime.get(bars[i].openTime.getTime());
  return {
    warmup: 0,
    entry: (i) => {
      const s = at(i);
      if (s?.side !== 'BUY') return null;
      return {
        strength: s.strength,
        stopLoss: s.stopLoss ?? undefined,
        takeProfit: s.takeProfit ?? undefined,
        reason: s.reason,
        indicators: s.indicators,
      };
    },
    exit: (i) => {
      const s = at(i);
      return s?.side === 'SELL' ? { reason: s.reason, indicators: s.indicators } : null;
    },
  };
}
