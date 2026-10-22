/** Earnings report times of a US-listed company. */
export interface EarningsProvider {
  /**
   * Past reports (when the results became public) and the next scheduled one, if known.
   * Empty for symbols without reports (ETFs, unknown tickers).
   */
  fetchReports(symbol: string): Promise<EarningsReport[]>;
}

export interface EarningsReport {
  reportedAt: Date;
  /** `sec`: 8-K item 2.02 filing time. `yahoo`: scheduled date of an upcoming report. */
  source: 'sec' | 'yahoo';
}

export const EARNINGS_PROVIDER = Symbol('EARNINGS_PROVIDER');
