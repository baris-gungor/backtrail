import type { BacktestResult, EquityPoint } from './engine';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

/** Results with fewer closed trades are flagged as statistically weak. */
export const MIN_TRADES = 10;

export interface ReturnMetrics {
  totalReturn: number;
  cagr: number | null;
  maxDrawdown: number;
}

export interface BacktestMetrics extends ReturnMetrics {
  /** Annualized standard deviation of bar returns. */
  volatility: number | null;
  sharpe: number | null;
  sortino: number | null;
  maxDrawdownBars: number;
  maxDrawdownDays: number;
  calmar: number | null;
  trades: number;
  winRate: number | null;
  profitFactor: number | null;
  /** Average PnL of winning trades, account currency. */
  avgWin: number | null;
  /** Average loss of losing trades as a positive amount. */
  avgLoss: number | null;
  payoff: number | null;
  /** Expected PnL per trade. */
  expectancy: number | null;
  /** Share of bars that closed with an open position. */
  exposure: number;
  avgHoldingBars: number | null;
  avgHoldingHours: number | null;
  totalFees: number;
  /** Bars per year measured from the data, used for annualization. */
  barsPerYear: number | null;
  lowSample: boolean;
  benchmark: ReturnMetrics;
  /** Strategy CAGR minus benchmark CAGR. */
  alpha: number | null;
}

export interface MetricsOptions {
  /** Annual risk-free rate, e.g. 0.04. Default 0. */
  riskFreeRate?: number;
}

export function computeMetrics(
  result: BacktestResult,
  options: MetricsOptions = {},
): BacktestMetrics {
  const { equity, trades } = result;
  const curve = returnMetrics(equity);
  const benchmark = returnMetrics(result.benchmark);

  const years = spanYears(equity);
  const barsPerYear = years > 0 ? result.bars / years : null;
  const returns = barReturns(equity);
  const rfBar = barsPerYear ? (options.riskFreeRate ?? 0) / barsPerYear : 0;
  const annualize = barsPerYear ? Math.sqrt(barsPerYear) : null;

  const sd = stdDev(returns);
  const excess = mean(returns.map((r) => r - rfBar));
  const downside =
    returns.length > 0 ? Math.sqrt(mean(returns.map((r) => Math.min(r - rfBar, 0) ** 2))) : 0;

  const pnls = trades.map((t) => t.pnl.toNumber());
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0).map((p) => -p);
  const grossWin = sum(wins);
  const grossLoss = sum(losses);
  const winRate = trades.length ? wins.length / trades.length : null;
  const avgWin = wins.length ? grossWin / wins.length : null;
  const avgLoss = losses.length ? grossLoss / losses.length : null;
  const avgHoldingBars = trades.length ? mean(trades.map((t) => t.barsHeld)) : null;
  const avgHoldingHours = trades.length
    ? mean(trades.map((t) => (t.exitTime.getTime() - t.entryTime.getTime()) / 3_600_000))
    : null;
  const drawdown = drawdownStats(equity);

  return {
    ...curve,
    volatility: annualize && sd !== null ? sd * annualize : null,
    sharpe: annualize && sd ? (excess / sd) * annualize : null,
    sortino: annualize && downside ? (excess / downside) * annualize : null,
    maxDrawdownBars: drawdown.bars,
    maxDrawdownDays: drawdown.days,
    calmar: curve.cagr !== null && curve.maxDrawdown > 0 ? curve.cagr / curve.maxDrawdown : null,
    trades: trades.length,
    winRate,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    avgWin,
    avgLoss,
    payoff: avgWin !== null && avgLoss ? avgWin / avgLoss : null,
    expectancy: winRate !== null ? winRate * (avgWin ?? 0) - (1 - winRate) * (avgLoss ?? 0) : null,
    exposure: result.bars ? result.barsInMarket / result.bars : 0,
    avgHoldingBars,
    avgHoldingHours,
    totalFees: result.totalFees.toNumber(),
    barsPerYear,
    lowSample: trades.length < MIN_TRADES,
    benchmark,
    alpha: curve.cagr !== null && benchmark.cagr !== null ? curve.cagr - benchmark.cagr : null,
  };
}

export function returnMetrics(equity: EquityPoint[]): ReturnMetrics {
  if (equity.length < 2) return { totalReturn: 0, cagr: null, maxDrawdown: 0 };
  const first = equity[0].equity;
  const last = equity[equity.length - 1].equity;
  const totalReturn = last / first - 1;
  const years = spanYears(equity);
  return {
    totalReturn,
    cagr: years > 0 && last > 0 ? (last / first) ** (1 / years) - 1 : null,
    maxDrawdown: drawdownStats(equity).depth,
  };
}

/** Deepest drop from a running peak, and how long that episode lasted until recovery (or the end). */
export function drawdownStats(equity: EquityPoint[]): {
  depth: number;
  bars: number;
  days: number;
} {
  let peak = 0;
  let peakIndex = 0;
  let best = { depth: 0, start: 0, end: 0 };
  let current: { depth: number; start: number } | null = null;

  const finish = (end: number): void => {
    if (current && current.depth > best.depth) best = { ...current, end };
  };

  equity.forEach((point, i) => {
    if (point.equity >= peak) {
      finish(i);
      current = null;
      peak = point.equity;
      peakIndex = i;
      return;
    }
    const depth = 1 - point.equity / peak;
    if (!current) current = { depth, start: peakIndex };
    else current.depth = Math.max(current.depth, depth);
  });
  finish(equity.length - 1);

  if (best.depth === 0) return { depth: 0, bars: 0, days: 0 };
  return {
    depth: best.depth,
    bars: best.end - best.start,
    days: (equity[best.end].time.getTime() - equity[best.start].time.getTime()) / DAY_MS,
  };
}

function barReturns(equity: EquityPoint[]): number[] {
  const out: number[] = [];
  for (let i = 1; i < equity.length; i++) {
    out.push(equity[i].equity / equity[i - 1].equity - 1);
  }
  return out;
}

function spanYears(points: EquityPoint[]): number {
  if (points.length < 2) return 0;
  return (points[points.length - 1].time.getTime() - points[0].time.getTime()) / YEAR_MS;
}

const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);
const mean = (xs: number[]): number => (xs.length ? sum(xs) / xs.length : 0);

/** Sample standard deviation, null with fewer than two values. */
function stdDev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) ** 2)) / (xs.length - 1));
}
