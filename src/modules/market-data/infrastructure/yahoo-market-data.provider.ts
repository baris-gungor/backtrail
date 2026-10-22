import { Inject, Injectable } from '@nestjs/common';
import { UpstreamError } from '../../../common/errors/domain.error';
import {
  YAHOO_FINANCE,
  type YahooFinanceClient,
} from '../../../integrations/yahoo-finance/yahoo-finance.module';
import { RawBar } from '../domain/bar';
import { MarketDataProvider } from '../domain/market-data-provider.port';

/**
 * Yahoo returns the latest live tick as an extra quote with an off-grid timestamp
 * (e.g. 20:08:49). Hourly bars always start on :00 or :30.
 */
function isOnHourlyGrid(date: Date): boolean {
  return (
    date.getUTCSeconds() === 0 && date.getUTCMilliseconds() === 0 && date.getUTCMinutes() % 30 === 0
  );
}

@Injectable()
export class YahooMarketDataProvider implements MarketDataProvider {
  readonly name = 'yahoo';

  constructor(@Inject(YAHOO_FINANCE) private readonly yf: YahooFinanceClient) {}

  async fetchHourlyBars(symbol: string, from: Date, to: Date): Promise<RawBar[]> {
    const chart = await this.yf
      .chart(symbol, { period1: from, period2: to, interval: '1h', includePrePost: false })
      .catch((error: unknown) => {
        throw new UpstreamError(`Yahoo Finance chart request failed for ${symbol}`, error);
      });

    const bars: RawBar[] = [];
    for (const q of chart.quotes) {
      if (q.open == null || q.high == null || q.low == null || q.close == null) continue;
      if (!isOnHourlyGrid(q.date)) continue;
      bars.push({
        openTime: q.date,
        open: q.open,
        high: q.high,
        low: q.low,
        close: q.close,
        volume: q.volume ?? 0,
      });
    }
    return bars;
  }
}
