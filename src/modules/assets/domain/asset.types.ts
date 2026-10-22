export enum AssetClass {
  Equity = 'equity',
  Etf = 'etf',
  Future = 'future',
  Index = 'index',
  Currency = 'currency',
  Crypto = 'crypto',
}

/**
 * Trading session model. Drives which bars are kept and how 4h buckets are aligned.
 * - us_equity: 09:30-16:00 America/New_York, regular hours only.
 * - continuous: (near) 24h markets such as futures, FX and crypto. UTC-aligned buckets.
 */
export enum SessionType {
  UsEquity = 'us_equity',
  Continuous = 'continuous',
}

export interface SymbolMetadata {
  symbol: string;
  name: string;
  assetClass: AssetClass;
  exchange: string | null;
  currency: string;
  sessionType: SessionType;
  provider: string;
}
