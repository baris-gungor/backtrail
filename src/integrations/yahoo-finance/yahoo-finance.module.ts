import { Module } from '@nestjs/common';
import YahooFinance from 'yahoo-finance2';

export const YAHOO_FINANCE = Symbol('YAHOO_FINANCE');
export type YahooFinanceClient = InstanceType<typeof YahooFinance>;

/**
 * Shares one Yahoo Finance client. Module-specific adapters (symbol resolver,
 * market data provider) live in the modules that own the ports.
 */
@Module({
  providers: [
    {
      provide: YAHOO_FINANCE,
      useFactory: (): YahooFinanceClient => new YahooFinance({ suppressNotices: ['yahooSurvey'] }),
    },
  ],
  exports: [YAHOO_FINANCE],
})
export class YahooFinanceModule {}
