import { fillLogText } from './trade-log';

describe('fillLogText', () => {
  it('describes a fill on one line with rounded numbers', () => {
    expect(
      fillLogText('Demo', 'AAPL', {
        side: 'BUY',
        quantity: '10.123456789',
        price: '187.254999',
        source: 'signal',
      }),
    ).toBe('Demo: BUY 10.1235 AAPL @ 187.255 filled (signal)');
  });

  it('accepts numeric prices', () => {
    expect(
      fillLogText('Demo', 'GLD', { side: 'SELL', quantity: '3', price: 201.5, source: 'manual' }),
    ).toBe('Demo: SELL 3 GLD @ 201.5 filled (manual)');
  });
});
