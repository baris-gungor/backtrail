import { registerAs } from '@nestjs/config';

export interface MarketDataConfig {
  syncOnStartup: boolean;
  historyDays: number;
  /** Sync each asset shortly after its 1h bars close. */
  syncSchedule: boolean;
  /** Minutes after a bar close before the scheduled sync runs. */
  syncDelayMinutes: number;
  /** User-Agent for SEC EDGAR requests (earnings dates); SEC asks clients to identify themselves. */
  secUserAgent: string;
}

export const marketDataConfig = registerAs('marketData', (): MarketDataConfig => ({
  syncOnStartup: process.env.MARKET_DATA_SYNC_ON_STARTUP !== 'false',
  historyDays: Number(process.env.MARKET_DATA_HISTORY_DAYS ?? 720),
  syncSchedule: process.env.MARKET_DATA_SYNC_SCHEDULE !== 'false',
  syncDelayMinutes: Number(process.env.MARKET_DATA_SYNC_DELAY_MINUTES ?? 5),
  secUserAgent: process.env.SEC_USER_AGENT || 'backtrail personal research tool',
}));
