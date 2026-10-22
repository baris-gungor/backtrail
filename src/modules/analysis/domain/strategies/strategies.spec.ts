import type { Bar } from '../../../market-data/domain/bar';
import { STRATEGIES, findStrategy } from '.';
import { InvalidInputError } from '../../../../common/errors/domain.error';

import fixture from './__fixtures__/gc-f-4h.json';

/**
 * Real data: GC=F (gold futures) 4h bars, 2025-10-09 to 2026-10-09, ~1550 bars.
 * Rows are [unixSeconds, open, high, low, close, volume]. The year contains trends,
 * pullbacks and chop, so every strategy fires on it.
 */
const bars: Bar[] = fixture.map(([t, open, high, low, close, volume]) => ({
  openTime: new Date(t * 1000),
  open,
  high,
  low,
  close,
  volume,
  isComplete: true,
}));

describe.each(STRATEGIES.map((s) => [s.code, s] as const))('%s', (_code, strategy) => {
  const params = strategy.defaultParams;
  const signals = strategy.evaluate(bars, params);

  it('produces signals on mixed regimes', () => {
    expect(signals.length).toBeGreaterThan(0);
    expect(signals[0].side).toBe('BUY');
  });

  it('alternates BUY and SELL (long-only state machine)', () => {
    signals.forEach((sig, i) => expect(sig.side).toBe(i % 2 === 0 ? 'BUY' : 'SELL'));
  });

  it('has no look-ahead: a prefix of the data gives a prefix of the signals', () => {
    for (const cut of [300, 777, 1200, 1500]) {
      const prefix = bars.slice(0, cut);
      const lastTime = prefix[prefix.length - 1].openTime.getTime();
      const expected = signals.filter((s) => s.barTime.getTime() <= lastTime);
      expect(strategy.evaluate(prefix, params)).toEqual(expected);
    }
  });

  it('respects warmup and keeps fields in range', () => {
    const firstAllowed = bars[strategy.warmupBars(params)].openTime.getTime();
    for (const sig of signals) {
      expect(sig.barTime.getTime()).toBeGreaterThanOrEqual(firstAllowed);
      expect(sig.strength).toBeGreaterThanOrEqual(0);
      expect(sig.strength).toBeLessThanOrEqual(1);
      if (sig.side === 'BUY' && sig.stopLoss !== undefined)
        expect(sig.stopLoss).toBeLessThan(sig.price);
    }
  });

  it('returns nothing when there is not enough data', () => {
    if (strategy.isBenchmark) return;
    expect(strategy.evaluate(bars.slice(0, strategy.warmupBars(params)), params)).toEqual([]);
  });
});

describe('params', () => {
  const trend = findStrategy('trend_ema_adx')!;

  it('fills defaults and accepts overrides', () => {
    expect(trend.validateParams({ fast: 10 })).toMatchObject({ fast: 10, slow: 50, trend: 200 });
  });

  it('rejects invalid params', () => {
    expect(() => trend.validateParams({ fast: 60, slow: 50 })).toThrow(InvalidInputError);
    expect(() => trend.validateParams({ fast: 'abc' })).toThrow(InvalidInputError);
    expect(() => trend.validateParams({ unknown: 1 })).toThrow(InvalidInputError);
  });

  it('changes behaviour with params', () => {
    const fastSignals = trend.evaluate(bars, { fast: 5, slow: 15, trend: 50 });
    expect(fastSignals.length).not.toBe(trend.evaluate(bars, trend.defaultParams).length);
  });
});

describe('buy_and_hold', () => {
  it('buys once on the first bar', () => {
    const signals = findStrategy('buy_and_hold')!.evaluate(bars, {});
    expect(signals).toHaveLength(1);
    expect(signals[0]).toMatchObject({ side: 'BUY', barTime: bars[0].openTime });
  });
});
