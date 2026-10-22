/**
 * US ETFs that track commodity futures. Alpaca does not trade futures, and the
 * continuous futures series has roll jumps; the ETF is the tradable stand-in. The link is stored
 * on the ETF (`assets.proxy_for_id`) and made automatically when both symbols are registered.
 */
export const COMMODITY_PROXIES: Readonly<Record<string, { etf: string; name: string }>> = {
  'GC=F': { etf: 'GLD', name: 'Gold' },
  'SI=F': { etf: 'SLV', name: 'Silver' },
  'CL=F': { etf: 'USO', name: 'Crude oil (WTI)' },
  'BZ=F': { etf: 'BNO', name: 'Brent crude' },
  'NG=F': { etf: 'UNG', name: 'Natural gas' },
  'HG=F': { etf: 'CPER', name: 'Copper' },
};

/** Futures symbol an ETF stands in for, if it is a known proxy. */
export function futuresForEtf(etf: string): string | undefined {
  return Object.entries(COMMODITY_PROXIES).find(([, p]) => p.etf === etf)?.[0];
}
