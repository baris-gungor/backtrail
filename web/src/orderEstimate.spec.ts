import { describe, expect, it } from 'vitest';
import { setLocale } from './i18n';
import { estimateBuy, type EstimateInput } from './orderEstimate';

setLocale('tr');

const base: EstimateInput = {
  amountMode: 'notional',
  amount: 200,
  price: 350,
  wholeShares: false,
  equity: 100_000,
  cash: 100_000,
  maxPositionPct: 25,
  cashBufferPct: 0,
};

describe('estimateBuy', () => {
  it('buys a fraction when the broker allows it', () => {
    const e = estimateBuy(base);
    expect(e.quantity).toBeCloseTo(200 / 350);
    expect(e.issues).toEqual([]);
  });

  it('warns when the amount is below one whole share', () => {
    const e = estimateBuy({ ...base, wholeShares: true });
    expect(e.quantity).toBe(0);
    expect(e.issues[0]).toContain('1 adet bile etmiyor');
  });

  it('floors to whole shares and reports the real cost', () => {
    const e = estimateBuy({ ...base, amount: 1000, wholeShares: true });
    expect(e.quantity).toBe(2);
    expect(e.cost).toBe(700);
  });

  it('flags missing cash and the position limit', () => {
    const e = estimateBuy({ ...base, amountMode: 'quantity', amount: 100, cash: 5000 });
    expect(e.issues).toHaveLength(2);
  });

  it('is empty without an amount or price', () => {
    expect(estimateBuy({ ...base, amount: null }).quantity).toBe(0);
    expect(estimateBuy({ ...base, price: null }).issues).toEqual([]);
  });
});
