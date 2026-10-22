export type Timeframe = '1h' | '4h';

/** OHLCV bar as delivered by a provider, before session filtering. */
export interface RawBar {
  openTime: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface Bar extends RawBar {
  /** False while the bar period has not ended yet. Incomplete bars are refreshed on the next sync. */
  isComplete: boolean;
}
