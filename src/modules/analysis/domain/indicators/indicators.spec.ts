import * as ref from 'technicalindicators';
import { adx, atr, bollinger, donchian, ema, macd, rma, rsi, sma, supertrend, trueRange } from '.';

/** Deterministic pseudo-random OHLC series (random walk) for cross-checks. */
function series(length: number, seed = 42) {
  let s = seed;
  const rand = () => {
    s = (s * 1664525 + 1013904223) % 2 ** 32;
    return s / 2 ** 32;
  };
  const close: number[] = [];
  const high: number[] = [];
  const low: number[] = [];
  let price = 100;
  for (let i = 0; i < length; i++) {
    const open = price;
    price = Math.max(1, price + (rand() - 0.48) * 3);
    high.push(Math.max(open, price) + rand() * 1.5);
    low.push(Math.min(open, price) - rand() * 1.5);
    close.push(price);
  }
  return { high, low, close };
}

const last = <T>(values: T[]): T => values[values.length - 1];

describe('moving averages', () => {
  it('sma', () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });

  it('ema seeds with SMA and then smooths', () => {
    // alpha = 0.5; seed = (1+2+3)/3 = 2; next = 2 + 0.5*(10-2) = 6
    expect(ema([1, 2, 3, 10], 3)).toEqual([null, null, 2, 6]);
  });

  it('ema skips leading nulls', () => {
    // alpha = 2/3; seed = (2+4)/2 = 3; next = 3 + 2/3*(6-3) = 5
    expect(ema([null, null, 2, 4, 6], 2)).toEqual([null, null, null, 3, 5]);
  });

  it('rma uses alpha = 1/period', () => {
    // seed 2, next = 2 + (5-2)/2 = 3.5
    expect(rma([1, 3, 5], 2)).toEqual([null, 2, 3.5]);
  });

  it('returns all nulls when there is not enough data', () => {
    expect(ema([1, 2], 5)).toEqual([null, null]);
    expect(sma([], 3)).toEqual([]);
  });
});

describe('oscillators', () => {
  it('rsi is 100 on a strictly rising series and 50 on a flat one', () => {
    const rising = Array.from({ length: 20 }, (_, i) => i + 1);
    expect(last(rsi(rising, 14))).toBe(100);
    expect(last(rsi(Array<number>(20).fill(5), 14))).toBe(50);
    expect(
      rsi(rising, 14)
        .slice(0, 14)
        .every((v) => v === null),
    ).toBe(true);
  });

  it('bollinger collapses to the price on a flat series', () => {
    const bb = bollinger(Array<number>(25).fill(10), 20, 2);
    expect(last(bb.upper)).toBe(10);
    expect(last(bb.lower)).toBe(10);
    expect(last(bb.percentB)).toBe(0.5);
    expect(bb.middle[18]).toBeNull();
  });
});

describe('volatility', () => {
  it('true range uses the previous close on gaps', () => {
    const tr = trueRange({ high: [10, 15], low: [9, 14], close: [9.5, 14.5] });
    expect(tr).toEqual([null, 5.5]); // high 15 - prev close 9.5
  });

  it('donchian excludes the current bar', () => {
    const ch = donchian([1, 2, 3, 10], [0, 1, 2, 9], 3);
    expect(ch.upper[3]).toBe(3);
    expect(ch.lower[3]).toBe(0);
    expect(ch.upper[2]).toBeNull();
  });

  it('supertrend flips down when price falls through the lower band', () => {
    const up = Array.from({ length: 30 }, (_, i) => 100 + i);
    const down = Array.from({ length: 15 }, (_, i) => 129 - i * 4);
    const close = [...up, ...down];
    const bars = { close, high: close.map((c) => c + 1), low: close.map((c) => c - 1) };
    const st = supertrend(bars, 10, 3);
    expect(st.direction[29]).toBe(1);
    expect(last(st.direction)).toBe(-1);
  });
});

/**
 * Cross-check against `technicalindicators` on a long random walk. Seeding conventions differ
 * slightly between libraries, but the effect decays, so the latest values must match.
 */
describe('cross-check with technicalindicators', () => {
  const bars = series(400);
  const { close, high, low } = bars;
  const close6 = (v: number | null) => Number((v ?? NaN).toFixed(6));

  it('sma / ema', () => {
    expect(close6(last(sma(close, 20)))).toBeCloseTo(
      last(ref.SMA.calculate({ period: 20, values: close })),
      6,
    );
    expect(close6(last(ema(close, 20)))).toBeCloseTo(
      last(ref.EMA.calculate({ period: 20, values: close })),
      6,
    );
  });

  it('rsi', () => {
    expect(last(rsi(close, 14))!).toBeCloseTo(
      last(ref.RSI.calculate({ period: 14, values: close })),
      2,
    );
  });

  it('macd', () => {
    const ours = macd(close, 12, 26, 9);
    const theirs = last(
      ref.MACD.calculate({
        values: close,
        fastPeriod: 12,
        slowPeriod: 26,
        signalPeriod: 9,
        SimpleMAOscillator: false,
        SimpleMASignal: false,
      }),
    );
    expect(last(ours.macd)!).toBeCloseTo(theirs.MACD!, 6);
    expect(last(ours.signal)!).toBeCloseTo(theirs.signal!, 6);
    expect(last(ours.histogram)!).toBeCloseTo(theirs.histogram!, 6);
  });

  it('bollinger', () => {
    const ours = bollinger(close, 20, 2);
    const theirs = last(ref.BollingerBands.calculate({ period: 20, stdDev: 2, values: close }));
    expect(last(ours.upper)!).toBeCloseTo(theirs.upper, 6);
    expect(last(ours.lower)!).toBeCloseTo(theirs.lower, 6);
  });

  it('atr', () => {
    expect(last(atr(bars, 14))!).toBeCloseTo(
      last(ref.ATR.calculate({ period: 14, high, low, close })),
      6,
    );
  });

  it('adx', () => {
    const ours = adx(bars, 14);
    const theirs = last(ref.ADX.calculate({ period: 14, high, low, close }));
    expect(last(ours.adx)!).toBeCloseTo(theirs.adx, 4);
    expect(last(ours.plusDI)!).toBeCloseTo(theirs.pdi, 4);
    expect(last(ours.minusDI)!).toBeCloseTo(theirs.mdi, 4);
  });
});
