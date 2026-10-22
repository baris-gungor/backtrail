import { registerAs } from '@nestjs/config';

/** The only Alpaca endpoints the app accepts: the paper (demo) environment. */
export const ALPACA_PAPER_BASE_URL = 'https://paper-api.alpaca.markets';
export const ALPACA_PAPER_STREAM_URL = 'wss://paper-api.alpaca.markets/stream';

export interface AlpacaConfig {
  keyId: string;
  secretKey: string;
  baseUrl: string;
  streamUrl: string;
  /** Both keys are set. Without them demo-broker portfolios are disabled. */
  enabled: boolean;
  /** Minutes between scheduled reconciliations; 0 disables the schedule. */
  reconcileMinutes: number;
}

export const alpacaConfig = registerAs('alpaca', (): AlpacaConfig => {
  const keyId = process.env.ALPACA_KEY_ID ?? '';
  const secretKey = process.env.ALPACA_SECRET_KEY ?? '';
  return {
    keyId,
    secretKey,
    baseUrl: process.env.ALPACA_BASE_URL || ALPACA_PAPER_BASE_URL,
    streamUrl: process.env.ALPACA_STREAM_URL || ALPACA_PAPER_STREAM_URL,
    enabled: keyId !== '' && secretKey !== '',
    reconcileMinutes: Number(process.env.ALPACA_RECONCILE_MINUTES ?? 15),
  };
});
