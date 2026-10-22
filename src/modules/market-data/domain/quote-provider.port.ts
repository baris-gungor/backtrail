export const QUOTE_PROVIDER = Symbol('QUOTE_PROVIDER');

export interface Quote {
  price: number;
  /** When the provider last traded or updated this price. */
  asOf: Date;
}

/**
 * Source of near-live prices, used only to mark positions to market for display and snapshots.
 * Trading decisions keep using closed bars. Symbols the provider does not know are left out.
 */
export interface QuoteProvider {
  getQuotes(symbols: string[]): Promise<Map<string, Quote>>;
}
