import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AssetsModule } from '../assets/assets.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { AnalysisQueryService } from './application/analysis-query.service';
import { SignalGenerationService } from './application/signal-generation.service';
import { StrategyCatalogService } from './application/strategy-catalog.service';
import { SignalEntity } from './infrastructure/signal.entity';
import { StrategyConfigEntity } from './infrastructure/strategy-config.entity';
import { StrategyEntity } from './infrastructure/strategy.entity';
import { AnalysisController } from './presentation/analysis.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([StrategyEntity, StrategyConfigEntity, SignalEntity]),
    AssetsModule,
    MarketDataModule,
    AuditModule,
    NotificationsModule,
  ],
  controllers: [AnalysisController],
  providers: [StrategyCatalogService, SignalGenerationService, AnalysisQueryService],
  exports: [AnalysisQueryService, SignalGenerationService, StrategyCatalogService],
})
export class AnalysisModule {}
