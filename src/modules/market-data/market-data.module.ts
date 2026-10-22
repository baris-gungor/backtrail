import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YahooFinanceModule } from '../../integrations/yahoo-finance/yahoo-finance.module';
import { AssetsModule } from '../assets/assets.module';
import { MarkPriceService } from './application/mark-price.service';
import { MarketDataQueryService } from './application/market-data-query.service';
import { MarketDataSyncService } from './application/market-data-sync.service';
import { MarketDataSyncTriggers } from './application/market-data-sync.triggers';
import { EarningsService } from './application/earnings.service';
import { EARNINGS_PROVIDER } from './domain/earnings-provider.port';
import { MARKET_DATA_PROVIDER } from './domain/market-data-provider.port';
import { QUOTE_PROVIDER } from './domain/quote-provider.port';
import { EarningsEventEntity } from './infrastructure/earnings-event.entity';
import { SecYahooEarningsProvider } from './infrastructure/sec-yahoo-earnings.provider';
import { IngestionRunEntity } from './infrastructure/ingestion-run.entity';
import { PriceBarEntity } from './infrastructure/price-bar.entity';
import { PriceBarRepository } from './infrastructure/price-bar.repository';
import { YahooQuoteProvider } from './infrastructure/yahoo-quote.provider';
import { YahooMarketDataProvider } from './infrastructure/yahoo-market-data.provider';
import { MarketDataController } from './presentation/market-data.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([PriceBarEntity, IngestionRunEntity, EarningsEventEntity]),
    AssetsModule,
    YahooFinanceModule,
  ],
  controllers: [MarketDataController],
  providers: [
    PriceBarRepository,
    MarketDataSyncService,
    MarketDataQueryService,
    MarkPriceService,
    MarketDataSyncTriggers,
    { provide: MARKET_DATA_PROVIDER, useClass: YahooMarketDataProvider },
    { provide: QUOTE_PROVIDER, useClass: YahooQuoteProvider },
    EarningsService,
    { provide: EARNINGS_PROVIDER, useClass: SecYahooEarningsProvider },
  ],
  exports: [MarketDataQueryService, MarkPriceService, MarketDataSyncService, EarningsService],
})
export class MarketDataModule {}
