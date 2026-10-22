import Decimal from 'decimal.js';

export type TradeSource = 'backtest' | 'paper';

/** A closed round trip from a backtest run or a paper portfolio, in one shape. */
export interface TradeRecord {
  source: TradeSource;
  id: string;
  /** Backtest run or paper portfolio the trade belongs to. */
  runId: string | null;
  portfolioId: string | null;
  /** Paper subscription that traded it; null for backtests and manual trades. */
  subscriptionId: string | null;
  strategyCode: string | null;
  configName: string | null;
  symbol: string;
  assetId: string;
  entryTime: Date;
  entryPrice: number;
  exitTime: Date;
  exitPrice: number;
  /** Decimal strings. */
  quantity: string;
  fees: string;
  pnl: string;
  returnPct: number;
  side: 'long' | 'short';
  exitReason: string;
  barsHeld: number | null;
}

export interface TradeStats {
  trades: number;
  wins: number;
  losses: number;
  winRate: number | null;
  /** Decimal string, net of fees. */
  totalPnl: string;
  /** Mean return per trade. */
  avgReturn: number | null;
  profitFactor: number | null;
  /** Mean PnL per trade. */
  expectancy: number | null;
  avgWin: number | null;
  avgLoss: number | null;
  maxWinStreak: number;
  maxLossStreak: number;
  avgHoldingHours: number | null;
}

/** Longest runs of consecutive winning and losing trades (break-even trades end both). */
export function streaks(pnls: number[]): { maxWin: number; maxLoss: number } {
  let maxWin = 0;
  let maxLoss = 0;
  let win = 0;
  let loss = 0;
  for (const pnl of pnls) {
    win = pnl > 0 ? win + 1 : 0;
    loss = pnl < 0 ? loss + 1 : 0;
    maxWin = Math.max(maxWin, win);
    maxLoss = Math.max(maxLoss, loss);
  }
  return { maxWin, maxLoss };
}

export function tradeStats(trades: TradeRecord[]): TradeStats {
  const ordered = [...trades].sort((a, b) => a.exitTime.getTime() - b.exitTime.getTime());
  const pnls = ordered.map((t) => Number(t.pnl));
  const wins = pnls.filter((p) => p > 0);
  const losses = pnls.filter((p) => p < 0).map((p) => -p);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = losses.reduce((a, b) => a + b, 0);
  const n = ordered.length;
  const { maxWin, maxLoss } = streaks(pnls);
  return {
    trades: n,
    wins: wins.length,
    losses: losses.length,
    winRate: n ? wins.length / n : null,
    totalPnl: ordered.reduce((acc, t) => acc.plus(t.pnl), new Decimal(0)).toFixed(2),
    avgReturn: n ? ordered.reduce((a, t) => a + t.returnPct, 0) / n : null,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : null,
    expectancy: n ? pnls.reduce((a, b) => a + b, 0) / n : null,
    avgWin: wins.length ? grossWin / wins.length : null,
    avgLoss: losses.length ? grossLoss / losses.length : null,
    maxWinStreak: maxWin,
    maxLossStreak: maxLoss,
    avgHoldingHours: n
      ? ordered.reduce((a, t) => a + (t.exitTime.getTime() - t.entryTime.getTime()), 0) /
        n /
        3_600_000
      : null,
  };
}

/** The `n` trades with the highest and the lowest return. */
export function bestAndWorst(
  trades: TradeRecord[],
  n: number,
): { best: TradeRecord[]; worst: TradeRecord[] } {
  const sorted = [...trades].sort((a, b) => b.returnPct - a.returnPct);
  return { best: sorted.slice(0, n), worst: sorted.slice(-n).reverse() };
}
