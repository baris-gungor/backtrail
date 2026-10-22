import Decimal from 'decimal.js';
import type { OrderSide } from './order';

export interface FillLogEntry {
  side: OrderSide;
  quantity: string;
  price: number | string;
  source: string;
}

/** Rounded for reading; the stored values stay exact. */
const rounded = (value: number | string) => new Decimal(value).toDecimalPlaces(4).toString();

/** Console line for a fill, shared by both brokers: `Demo: BUY 10 AAPL @ 187.25 filled (signal)`. */
export function fillLogText(portfolio: string, symbol: string, fill: FillLogEntry): string {
  return `${portfolio}: ${fill.side} ${rounded(fill.quantity)} ${symbol} @ ${rounded(fill.price)} filled (${fill.source})`;
}
