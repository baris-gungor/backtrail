/**
 * Strategy health: does a live (paper or demo) subscription behave like its
 * backtest? Pure rules on closed trades. Returns are per-trade returns on cost (`returnPct`), so
 * the comparison does not depend on position sizing, which differs between backtest and portfolio.
 */

export type HealthLevel = 'ok' | 'info' | 'warning' | 'unknown';
export type HealthCheckCode = 'drawdown' | 'loss_streak' | 'win_rate' | 'silence' | 'no_backtest';

export interface HealthCheck {
  code: HealthCheckCode;
  level: Exclude<HealthLevel, 'unknown'> | 'unknown';
  /** Turkish, shown in the UI and in notifications. */
  message: string;
}

export interface HealthResult {
  level: HealthLevel;
  checks: HealthCheck[];
}

export interface HealthExpectation {
  /** Per-trade returns of the backtest, in exit order. */
  returns: number[];
  /** Days covered by the backtest's trading window. */
  periodDays: number;
}

export interface LiveTrades {
  /** Per-trade returns since the subscription started, in exit order. */
  returns: number[];
  /** When the subscription started trading. */
  since: Date;
  lastExit: Date | null;
  now: Date;
}

/** Live drawdown above the backtest's × this is a warning. */
export const DRAWDOWN_FACTOR = 1.5;
/** Small drawdowns are noise whatever the backtest says. */
export const MIN_WARNING_DRAWDOWN = 0.05;
/** A loss streak less likely than this under the backtest's win rate is a warning. */
export const STREAK_PROBABILITY = 0.05;
/** Win rate is compared only from this many live trades. */
export const MIN_WIN_RATE_TRADES = 10;
/** No trade for this many times the backtest's average gap is reported (info). */
export const SILENCE_FACTOR = 3;

const DAY_MS = 24 * 60 * 60 * 1000;
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Deepest drop of compounded returns from a running peak. */
export function returnsDrawdown(returns: number[]): number {
  let equity = 1;
  let peak = 1;
  let max = 0;
  for (const r of returns) {
    equity *= 1 + r;
    peak = Math.max(peak, equity);
    max = Math.max(max, 1 - equity / peak);
  }
  return max;
}

const winRate = (returns: number[]) =>
  returns.length ? returns.filter((r) => r > 0).length / returns.length : null;

/** Losses at the end of the sequence. */
function currentLossStreak(returns: number[]): number {
  let n = 0;
  for (let i = returns.length - 1; i >= 0 && returns[i] <= 0; i--) n++;
  return n;
}

export function assessHealth(live: LiveTrades, expected: HealthExpectation | null): HealthResult {
  if (!expected || expected.returns.length === 0) {
    return {
      level: 'unknown',
      checks: [
        {
          code: 'no_backtest',
          level: 'unknown',
          message:
            'No backtest to compare with: run a full-period backtest for this asset and parameter set.',
        },
      ],
    };
  }

  const checks: HealthCheck[] = [];
  const expectedWin = winRate(expected.returns) ?? 0;

  const liveDrawdown = returnsDrawdown(live.returns);
  const expectedDrawdown = returnsDrawdown(expected.returns);
  const limit = Math.max(expectedDrawdown * DRAWDOWN_FACTOR, MIN_WARNING_DRAWDOWN);
  checks.push(
    liveDrawdown > limit
      ? {
          code: 'drawdown',
          level: 'warning',
          message: `Drawdown ${pct(liveDrawdown)} is more than ${DRAWDOWN_FACTOR}× the backtest's ${pct(expectedDrawdown)}.`,
        }
      : {
          code: 'drawdown',
          level: 'ok',
          message: `Drawdown ${pct(liveDrawdown)} (backtest ${pct(expectedDrawdown)}).`,
        },
  );

  const streak = currentLossStreak(live.returns);
  const streakChance = (1 - expectedWin) ** streak;
  checks.push(
    streak > 0 && streakChance < STREAK_PROBABILITY
      ? {
          code: 'loss_streak',
          level: 'warning',
          message: `${streak} losses in a row: ${pct(streakChance)} likely at the backtest's win rate (${pct(expectedWin)}).`,
        }
      : {
          code: 'loss_streak',
          level: 'ok',
          message: streak ? `Last ${streak} trades lost (normal).` : 'No losing streak.',
        },
  );

  const liveWin = winRate(live.returns);
  if (liveWin !== null && live.returns.length >= MIN_WIN_RATE_TRADES) {
    // Normal approximation of the binomial: lower end of the 95% range for this many trades.
    const n = live.returns.length;
    const lower = expectedWin - 1.96 * Math.sqrt((expectedWin * (1 - expectedWin)) / n);
    checks.push(
      liveWin < lower
        ? {
            code: 'win_rate',
            level: 'warning',
            message: `Win rate ${pct(liveWin)} over ${n} trades: below the expected minimum of ${pct(Math.max(lower, 0))} for the backtest's ${pct(expectedWin)}.`,
          }
        : {
            code: 'win_rate',
            level: 'ok',
            message: `Win rate ${pct(liveWin)} (backtest ${pct(expectedWin)}).`,
          },
    );
  }

  const avgGapDays = expected.periodDays / expected.returns.length;
  const quietDays = (live.now.getTime() - (live.lastExit ?? live.since).getTime()) / DAY_MS;
  if (avgGapDays > 0 && quietDays > SILENCE_FACTOR * avgGapDays) {
    checks.push({
      code: 'silence',
      level: 'info',
      message: `No closed trade for ${Math.floor(quietDays)} days; the backtest closed one every ${avgGapDays.toFixed(1)} days on average.`,
    });
  }

  const level: HealthLevel = checks.some((c) => c.level === 'warning')
    ? 'warning'
    : checks.some((c) => c.level === 'info')
      ? 'info'
      : 'ok';
  return { level, checks };
}
