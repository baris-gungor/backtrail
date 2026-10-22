import { assessHealth, returnsDrawdown, type HealthExpectation, type LiveTrades } from './health';

const DAY = 24 * 60 * 60 * 1000;
const now = new Date('2026-10-10T00:00:00Z');
const live = (returns: number[], lastExitDaysAgo = 1): LiveTrades => ({
  returns,
  since: new Date(now.getTime() - 60 * DAY),
  lastExit: new Date(now.getTime() - lastExitDaysAgo * DAY),
  now,
});
// 60% winners, mild drawdown, 20 trades over 200 days: one every 10 days.
const expected: HealthExpectation = {
  returns: Array.from({ length: 20 }, (_, i) => (i % 5 < 3 ? 0.03 : -0.02)),
  periodDays: 200,
};
const check = (r: ReturnType<typeof assessHealth>, code: string) =>
  r.checks.find((c) => c.code === code);

describe('returnsDrawdown', () => {
  it('compounds returns from a running peak', () => {
    expect(returnsDrawdown([0.1, -0.1, -0.1, 0.5])).toBeCloseTo(0.19, 10);
    expect(returnsDrawdown([0.1, 0.2])).toBe(0);
  });
});

describe('assessHealth', () => {
  it('is unknown without a backtest', () => {
    const r = assessHealth(live([0.01]), null);
    expect(r.level).toBe('unknown');
    expect(r.checks[0].code).toBe('no_backtest');
  });

  it('is ok when live trades look like the backtest', () => {
    const r = assessHealth(live([0.03, -0.02, 0.03, 0.03, -0.02]), expected);
    expect(r.level).toBe('ok');
    expect(r.checks.every((c) => c.level === 'ok')).toBe(true);
  });

  it('warns on a drawdown beyond 1.5× the backtest (and at least 5%)', () => {
    const r = assessHealth(live([0.03, -0.04, -0.04, 0.05]), expected);
    expect(check(r, 'drawdown')?.level).toBe('warning');
    expect(r.level).toBe('warning');
  });

  it('warns on a loss streak that is unlikely under the backtest win rate', () => {
    // 0.4^4 = 2.6% < 5%; 0.4^3 = 6.4% is not.
    expect(
      check(assessHealth(live([0.03, -0.001, -0.001, -0.001, -0.001]), expected), 'loss_streak')
        ?.level,
    ).toBe('warning');
    expect(
      check(assessHealth(live([0.03, -0.001, -0.001, -0.001]), expected), 'loss_streak')?.level,
    ).toBe('ok');
  });

  it('compares win rate only from 10 trades', () => {
    const losers = (n: number) =>
      Array.from({ length: n }, (_, i) => (i % 5 === 0 ? 0.001 : -0.0001));
    expect(check(assessHealth(live(losers(9)), expected), 'win_rate')).toBeUndefined();
    // 20% wins over 10 trades, below 60% − 1.96 × √(0.24 / 10) ≈ 29.6%.
    expect(
      check(assessHealth(live([...losers(10).slice(0, 8), -0.0001, -0.0001]), expected), 'win_rate')
        ?.level,
    ).toBe('warning');
  });

  it('reports silence after 3× the average gap as info', () => {
    const r = assessHealth(live([0.03], 31), expected);
    expect(check(r, 'silence')?.level).toBe('info');
    expect(r.level).toBe('info');
    expect(check(assessHealth(live([0.03], 29), expected), 'silence')).toBeUndefined();
  });
});
