import Decimal from 'decimal.js';
import { feeFor, slippedPrice, type ExecutionModel } from './execution-model';
import { checkExitLevels } from './fill';
import { Account } from './account';
import { positionSize } from './position-sizing';

const model: ExecutionModel = { feeBps: 10, slippageBps: 20, minFee: 0 };
const t0 = new Date('2026-01-01T00:00:00Z');
const t1 = new Date('2026-01-02T00:00:00Z');

describe('execution model', () => {
  it('applies slippage against the trader and fees on notional', () => {
    expect(slippedPrice(100, 'BUY', model).toNumber()).toBe(100.2);
    expect(slippedPrice(100, 'SELL', model).toNumber()).toBe(99.8);
    expect(feeFor(1000, model).toNumber()).toBe(1);
    expect(feeFor(1000, { ...model, minFee: 2 }).toNumber()).toBe(2);
  });
});

describe('position sizing', () => {
  const base = {
    equity: new Decimal(10_000),
    cash: new Decimal(10_000),
    price: new Decimal(100),
    model,
  };

  it('keeps notional plus fee within cash for all-in', () => {
    const qty = positionSize({ ...base, sizing: { type: 'all_in' } });
    const spent = qty.mul(100).plus(feeFor(qty.mul(100), model));
    expect(spent.toNumber()).toBeCloseTo(10_000, 6);
    expect(spent.lte(10_000)).toBe(true);
  });

  it('uses a fraction of equity', () => {
    const qty = positionSize({ ...base, sizing: { type: 'fixed_fraction', fraction: 0.25 } });
    expect(qty.mul(100).toNumber()).toBeCloseTo(2500 / 1.001, 6);
  });

  it('sizes by risk to the stop and falls back to cash without a stop', () => {
    const sizing = { type: 'risk_per_trade', riskPct: 1 } as const;
    // 1% of 10 000 = 100 risk, 5 per unit to the stop -> 20 units.
    expect(positionSize({ ...base, sizing, stopLoss: 95 }).toNumber()).toBe(20);
    expect(positionSize({ ...base, sizing }).toNumber()).toBeCloseTo(10_000 / 100.1, 6);
  });
});

describe('exit levels', () => {
  const levels = { stopLoss: 95, takeProfit: 110 };

  it('fills a gap through the stop at the open', () => {
    expect(checkExitLevels({ open: 90, high: 92, low: 88 }, levels)).toEqual({
      reason: 'stop_loss',
      price: 90,
      market: true,
    });
  });

  it('assumes the stop hits first when both levels are inside the bar', () => {
    expect(checkExitLevels({ open: 100, high: 112, low: 94 }, levels)?.reason).toBe('stop_loss');
  });

  it('fills take-profit at the level, or at the open on a gap up', () => {
    expect(checkExitLevels({ open: 100, high: 111, low: 99 }, levels)).toMatchObject({
      reason: 'take_profit',
      price: 110,
    });
    expect(checkExitLevels({ open: 115, high: 116, low: 114 }, levels)?.price).toBe(115);
    expect(checkExitLevels({ open: 100, high: 105, low: 96 }, levels)).toBeNull();
  });
});

describe('account', () => {
  it('tracks cash, equity and round-trip PnL net of fees', () => {
    const account = new Account(1000);
    account.buy('A', new Decimal(5), new Decimal(100), new Decimal(1), t0);
    expect(account.cash.toNumber()).toBe(499);
    expect(account.equity(() => 110).toNumber()).toBe(1049);

    const trade = account.close('A', new Decimal(110), new Decimal(1), t1);
    expect(trade.pnl.toNumber()).toBe(48);
    expect(trade.fees.toNumber()).toBe(2);
    expect(trade.returnPct.toNumber()).toBeCloseTo(48 / 501, 10);
    expect(account.cash.toNumber()).toBe(1048);
    expect(account.position('A')).toBeNull();
  });

  it('tracks a short: proceeds in cash, liability in equity, gain when the price falls', () => {
    const account = new Account(1000);
    account.openPosition('A', 'short', new Decimal(5), new Decimal(100), new Decimal(1), t0);
    expect(account.position('A')!.quantity.toNumber()).toBe(-5);
    expect(account.cash.toNumber()).toBe(1499);
    // Price up: the short loses.
    expect(account.equity(() => 110).toNumber()).toBe(949);

    const trade = account.close('A', new Decimal(90), new Decimal(1), t1);
    expect(trade.side).toBe('short');
    expect(trade.quantity.toNumber()).toBe(5);
    expect(trade.pnl.toNumber()).toBe(48);
    expect(trade.returnPct.toNumber()).toBeCloseTo(48 / 501, 10);
    expect(account.cash.toNumber()).toBe(1048);
  });

  it('holds one position per key and marks each at its own price', () => {
    const account = new Account(1000);
    account.buy('A', new Decimal(2), new Decimal(100), new Decimal(0.1), t0);
    account.buy('B', new Decimal(0.5), new Decimal(300), new Decimal(0.1), t0);
    expect(account.cash.toString()).toBe('649.8');
    expect(account.equity((key) => (key === 'A' ? 110 : 280)).toString()).toBe('1009.8');
    expect(account.totalFees.toString()).toBe('0.2');
  });

  it('rejects a second position for a key and selling when flat', () => {
    const account = new Account(1000);
    expect(() => account.close('A', new Decimal(1), new Decimal(0), t0)).toThrow();
    account.buy('A', new Decimal(1), new Decimal(10), new Decimal(0), t0);
    expect(() => account.buy('A', new Decimal(1), new Decimal(10), new Decimal(0), t0)).toThrow();
  });
});
