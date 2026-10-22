import { RawBar } from './bar';

export const MARKET_DATA_PROVIDER = Symbol('MARKET_DATA_PROVIDER');

/**
 * Source of historical OHLCV data. Implementations must return bars on the
 * provider's 1h grid only (no partial ticks) and skip rows with missing prices.
 */
export interface MarketDataProvider {
  readonly name: string;
  fetchHourlyBars(symbol: string, from: Date, to: Date): Promise<RawBar[]>;
}
