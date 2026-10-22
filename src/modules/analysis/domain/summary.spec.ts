import type { Bar } from '../../market-data/domain/bar';
import { StrategyState, summarize } from './summary';

const trendBars = (n: number, step: number): Bar[] =>
  Array.from({ length: n }, (_, i) => {
    const close = 100 + i * step + Math.sin(i) * 0.5;
    return {
      openTime: new Date(Date.UTC(2026, 0, 1) + i * 4 * 3600_000),
      open: close - step,
      high: close + 1,
      low: close - 1,
      close,
      volume: 1000,
      isComplete: true,
    };
  });

const state = (position: 'long' | 'flat', strength: number): StrategyState => ({
  code: 'x',
  configId: 'id',
  configName: 'default',
  position,
  lastSignal: {
    side: position === 'long' ? 'BUY' : 'SELL',
    barTime: new Date(),
    strength,
    price: 1,
    stopLoss: null,
    reason: '',
  },
});

describe('summarize', () => {
  it('returns null without bars', () => {
    expect(summarize([], [])).toBeNull();
  });

  it('detects an uptrend with bullish alignment', () => {
    const s = summarize(trendBars(300, 0.5), [])!;
    expect(s.trend.state).toBe('up');
    expect(s.trend.emaAlignment).toBe('20>50>200');
    expect(s.trend.priceVsEma200Pct).toBeGreaterThan(0);
    expect(s.momentum.rsi).toBeGreaterThan(50);
  });

  it('detects a downtrend', () => {
    const s = summarize(trendBars(300, -0.2), [])!;
    expect(s.trend.state).toBe('down');
    expect(s.trend.emaAlignment).toBe('200>50>20');
  });

  it('leaves long-period fields null on short history', () => {
    const s = summarize(trendBars(60, 0.5), [])!;
    expect(s.trend.ema200).toBeNull();
    expect(s.trend.emaAlignment).toBeNull();
    expect(s.trend.state).toBe('sideways');
  });

  it('computes a strength-weighted consensus', () => {
    const s = summarize(trendBars(50, 0.1), [
      state('long', 0.8),
      state('long', 0.6),
      state('flat', 1),
    ])!;
    expect(s.consensus).toEqual({ long: 2, flat: 1, score: round2((0.8 + 0.6) / 3) });
  });
});

function round2(x: number) {
  return Number(x.toFixed(2));
}
