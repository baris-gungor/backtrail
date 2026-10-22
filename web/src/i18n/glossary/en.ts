import type { GlossaryEntry } from '../../glossary';
import type { GlossaryKey } from './tr';

const glossary: Record<GlossaryKey, GlossaryEntry> = {
  totalReturn: {
    title: 'Total return',
    text: 'Percent change of capital from the start to the end of the period (after fees and slippage).',
  },
  cagr: {
    title: 'CAGR (compound annual growth)',
    text: 'Total return turned into a yearly average. Makes periods of different length comparable.',
  },
  alpha: {
    title: 'Alpha',
    text: "Difference between the strategy's CAGR and buy & hold's CAGR over the same period. Positive means the strategy beat passive investing.",
    scale: ['> 0 good', '−5%–0 fair', '< −5% weak'],
  },
  sharpe: {
    title: 'Sharpe ratio',
    text: 'Return per unit of risk: annual return divided by volatility. Higher is better.',
    scale: ['> 1 good', '0–1 fair', '< 0 weak'],
  },
  sortino: {
    title: 'Sortino ratio',
    text: 'Like Sharpe, but only downside volatility counts as risk. Upward jumps are not penalized.',
    scale: ['> 1.5 good', '0–1.5 fair', '< 0 weak'],
  },
  calmar: {
    title: 'Calmar ratio',
    text: 'Annual return (CAGR) divided by the largest drawdown. Shows how deep a loss was endured for the return.',
    scale: ['> 1 good', '0.3–1 fair', '< 0.3 weak'],
  },
  maxDrawdown: {
    title: 'Max drawdown',
    text: 'The largest percent loss of capital after a peak. Smaller is better.',
    scale: ['< 10% good', '10–25% fair', '> 25% weak'],
  },
  volatility: {
    title: 'Volatility',
    text: 'Annualized fluctuation of returns (standard deviation). Higher means a bumpier equity curve.',
  },
  ulcer: {
    title: 'Ulcer index',
    text: 'Measures both the depth and the length of drawdowns. Smaller is better.',
  },
  trades: {
    title: 'Trades',
    text: 'Number of closed trades. Below 10, results may depend heavily on luck.',
  },
  winRate: {
    title: 'Win rate',
    text: 'Share of trades closed with a profit. Not enough on its own: a strategy that wins small and loses big can lose money with a high win rate.',
  },
  profitFactor: {
    title: 'Profit factor',
    text: 'Total profit divided by total loss. Above 1 means profitable.',
    scale: ['> 1.5 good', '1–1.5 fair', '< 1 weak'],
  },
  payoff: {
    title: 'Payoff',
    text: 'Average win divided by average loss.',
  },
  expectancy: {
    title: 'Expectancy',
    text: 'Average profit or loss per trade, in currency.',
  },
  exposure: {
    title: 'Exposure (time in market)',
    text: 'Share of the period with an open position. Low means the capital mostly sat in cash.',
  },
  fees: {
    title: 'Fees',
    text: 'Total commission paid on trades (from the fee bps setting).',
  },
  benchmark: {
    title: 'Buy & hold (benchmark)',
    text: 'Buying on the first bar of the same period and never selling, without fees. Shows whether the strategy beat passive investing.',
  },
  segment: {
    title: 'Segment (full / train / test)',
    text: 'A parameter sweep splits the data in two: parameters are chosen on the train part, and the test part checks the result on unseen data.',
  },
  sweep: {
    title: 'Parameter sweep',
    text: "Tries a strategy's parameter combinations on the train period and re-runs the best ones on the test period.",
  },
  health: {
    title: 'Strategy health',
    text: "The subscription's closed trades are compared with the latest full-period backtest of the same asset and parameter set. It warns when the drawdown exceeds 1.5× the backtest's, when a losing streak is very unlikely at the backtest's win rate (under 5%), or when the win rate over 10+ trades is below the expected range. A long time without trades is only informational. Without a backtest to compare with, health shows as unknown.",
  },
  earnings: {
    title: 'Earnings filter',
    text: 'Stocks often gap at the open after an earnings report, and a stop does not help in that gap. When on, the position is closed at the last chance before the report and no new entry is made in that window; the entry block can be extended a few days earlier. Dates come from SEC filings (8-K item 2.02) and the Yahoo calendar; it has no effect on ETFs and futures.',
  },
  short: {
    title: 'Short selling',
    text: 'Selling a borrowed asset and buying it back later to profit from a falling price. The stop is above the entry and the target below; losses grow if the price rises. Only strategies with short rules (Trend, Breakout) go short. Short proceeds do not fund new positions (no leverage). The borrow cost is a yearly percent of the entry amount, charged for the time held. Stored signals are long-only, so short subscriptions run on the strategy rules.',
  },
  monteCarlo: {
    title: 'Monte Carlo (luck test)',
    text: "The run's trades are resampled at random (a trade can appear more than once) to build thousands of alternative histories. A wide range and a high chance of loss show that the result depends on a few lucky trades. Drawdowns are measured at trade closes, so they are smaller than the bar-by-bar max drawdown.",
  },
  proxy: {
    title: 'Commodity ETF proxy',
    text: 'A US ETF (e.g. GLD) that tracks a futures contract (e.g. GC=F gold). Alpaca does not trade futures; the ETF is tradable and has no price jumps at contract rolls. The ETF trades in the US session, so its 4h bars differ from the futures.',
  },
  rollAdjust: {
    title: 'Roll adjustment',
    text: 'Continuous futures series have fake price jumps on contract roll days (over 3 ATR, on weekdays). When on, prices before these points are scaled by ratio and the jump disappears; returns are kept, but old price levels are no longer the real prices. Not needed for stocks and ETFs.',
  },
  walkForward: {
    title: 'Walk-forward analysis',
    text: 'The data is split into consecutive windows. In each window, parameters are chosen on the train part and tried on the following, unseen test part. Joining the test parts gives a realistic result for "re-choosing the parameters regularly".',
  },
  oos: {
    title: 'Out-of-sample (OOS)',
    text: 'The result on data not used to choose the parameters. If it is clearly worse than the train result, the strategy may be overfitted to the past.',
  },
  wfe: {
    title: 'Walk-forward efficiency (WFE)',
    text: 'The combined annual return of the test periods (OOS CAGR) divided by the average annual return of the train periods. Close to 1 means the success in training carried over to unseen data.',
    scale: ['> 0.5 good', '0–0.5 fair', '< 0 weak'],
  },
  anchored: {
    title: 'Anchored',
    text: "When on, each window's train part starts at the beginning of the data and keeps growing. When off (rolling), the train part slides with a fixed length and adapts faster to market changes.",
  },
  profitableWindows: {
    title: 'Profitable windows',
    text: 'In how many test parts the return was positive. Shows whether the result depends on a single lucky period.',
    scale: ['> 60% good', '40–60% fair', '< 40% weak'],
  },
  bps: {
    title: 'bps (basis points)',
    text: '1 bps = 0.01%. A 5 bps fee is $5 on a $10,000 trade.',
  },
  slippage: {
    title: 'Slippage',
    text: 'An order filling at a slightly worse price than expected. Deducted from every fill in backtests and simulation.',
  },
  stopLoss: {
    title: 'Stop-loss',
    text: 'If the price falls to this level, the position is closed to limit the loss.',
  },
  takeProfit: {
    title: 'Take-profit (target)',
    text: 'If the price rises to this level, the position is closed with a profit.',
  },
  source: {
    title: 'Subscription source',
    text: 'strategy: the strategy rules run on every new bar, and the results match the backtest exactly. signals: only stored signals (active config) are followed.',
  },
  signalHit: {
    title: 'Signal hit rate',
    text: 'Is the price N bars after the signal in the expected direction (up after BUY, down after SELL)?',
  },
  correlation: {
    title: 'Correlation',
    text: 'How much the returns of two strategies move together (between −1 and 1). Low correlation gives diversification.',
  },
  divergence: {
    title: 'Backtest vs paper',
    text: "The difference between a backtest run on the same bars and the portfolio's actual result. It should be 0 for strategy-sourced subscriptions.",
  },
  paper: {
    title: 'Simulation (paper)',
    text: "Orders are filled with virtual money by the system's own fill rules. No real money is used.",
  },
  alpacaPaper: {
    title: 'Alpaca demo',
    text: "Orders go to Alpaca's demo (paper) account: a real broker, fake money.",
  },
  killSwitch: {
    title: 'Kill switch',
    text: 'Stops all automatic trading with one button. Manual buys are rejected; sells and position closes stay allowed.',
  },
  reconciliation: {
    title: 'Reconciliation',
    text: "Comparing the broker account's positions and cash with the database. A difference halts the portfolio.",
  },
  equity: {
    title: 'Equity',
    text: 'Cash plus the current value of open positions.',
  },
  realizedPnl: {
    title: 'Realized P&L',
    text: 'Profit or loss from closed trades. Paper gains of open positions are not included.',
  },
};

export default glossary;
