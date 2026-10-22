import Decimal from 'decimal.js';
import { envValidationSchema } from '../../../config/env.validation';
import {
  automaticClientOrderId,
  brokerPrice,
  orderClass,
  reconcile,
  wholeShares,
} from './demo-broker';

describe('demo broker rules', () => {
  it('picks the order class from the protective levels', () => {
    expect(orderClass({ stopLoss: 95, takeProfit: 110 })).toBe('bracket');
    expect(orderClass({ stopLoss: 95 })).toBe('oto');
    expect(orderClass({ takeProfit: 110 })).toBe('oto');
    expect(orderClass({})).toBe('simple');
  });

  it('rounds entries down to whole shares and prices to broker ticks', () => {
    expect(wholeShares('12.987').toString()).toBe('12');
    expect(wholeShares('0.4').toString()).toBe('0');
    expect(brokerPrice(95.4567, 'down')).toBe('95.45');
    expect(brokerPrice(110.0012, 'up')).toBe('110.01');
    expect(brokerPrice(0.123456)).toBe('0.1235');
  });

  it('builds a deterministic client order id', () => {
    const at = new Date('2026-10-05T13:30:00Z');
    expect(automaticClientOrderId('sub', at, 'entry')).toBe('sub:2026-10-05T13:30:00.000Z:entry');
  });

  it('reports position and cash differences', () => {
    const db = {
      holdings: [
        { symbol: 'GLD', quantity: '10' },
        { symbol: 'SPY', quantity: '2.5' },
      ],
      cash: '5000.00',
    };
    expect(
      reconcile(
        {
          holdings: [
            { symbol: 'GLD', quantity: '10.000000' },
            { symbol: 'SPY', quantity: '2.5' },
          ],
          cash: '5000.40',
        },
        db,
      ),
    ).toEqual([]);
    expect(
      reconcile(
        {
          holdings: [
            { symbol: 'GLD', quantity: '9' },
            { symbol: 'QQQ', quantity: '1' },
          ],
          cash: '4000',
        },
        db,
        new Decimal(1),
      ),
    ).toEqual([
      { kind: 'position', symbol: 'GLD', broker: '9', db: '10' },
      { kind: 'position', symbol: 'QQQ', broker: '1', db: '0' },
      { kind: 'position', symbol: 'SPY', broker: '0', db: '2.5' },
      { kind: 'cash', broker: '4000', db: '5000.00' },
    ]);
  });

  it('refuses a live Alpaca endpoint in the configuration', () => {
    const base = { DB_HOST: 'h', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' };
    expect(envValidationSchema.validate(base).error).toBeUndefined();
    const live = envValidationSchema.validate({
      ...base,
      ALPACA_BASE_URL: 'https://api.alpaca.markets',
    });
    expect(live.error?.message).toContain('live trading is disabled');
  });
});
