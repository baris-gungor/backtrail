import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { YahooFinanceModule } from '../../integrations/yahoo-finance/yahoo-finance.module';
import { AssetsService } from './application/assets.service';
import { SYMBOL_RESOLVER } from './domain/symbol-resolver.port';
import { AssetEntity } from './infrastructure/asset.entity';
import { YahooSymbolResolver } from './infrastructure/yahoo-symbol.resolver';
import { AssetsController } from './presentation/assets.controller';

@Module({
  imports: [TypeOrmModule.forFeature([AssetEntity]), YahooFinanceModule],
  controllers: [AssetsController],
  providers: [AssetsService, { provide: SYMBOL_RESOLVER, useClass: YahooSymbolResolver }],
  exports: [AssetsService],
})
export class AssetsModule {}
