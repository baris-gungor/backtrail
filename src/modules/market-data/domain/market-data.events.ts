export const MARKET_DATA_SYNCED = 'market-data.synced';

/** Emitted after a successful sync, so consumers (analysis) can process the new bars. */
export class MarketDataSyncedEvent {
  constructor(
    readonly assetId: string,
    readonly symbol: string,
  ) {}
}
