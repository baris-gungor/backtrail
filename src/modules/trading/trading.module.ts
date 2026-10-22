import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AlpacaModule } from '../../integrations/alpaca/alpaca.module';
import { AnalysisModule } from '../analysis/analysis.module';
import { AssetsModule } from '../assets/assets.module';
import { AuditModule } from '../audit/audit.module';
import { BacktestingModule } from '../backtesting/backtesting.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { BrokerRouter } from './application/broker-router.service';
import { OrderService } from './application/order.service';
import { PaperTradingListener } from './application/paper-trading.listener';
import { PortfolioValuationService } from './application/portfolio-valuation.service';
import { PortfolioService } from './application/portfolio.service';
import { TradingControlService } from './application/trading-control.service';
import { StrategyHealthService } from './application/strategy-health.service';
import { TradingQueryService } from './application/trading-query.service';
import { BROKER } from './domain/broker.port';
import { AlpacaBroker } from './infrastructure/alpaca-broker';
import { BrokerAccountEntity } from './infrastructure/broker-account.entity';
import { ClosedTradeEntity } from './infrastructure/closed-trade.entity';
import { FillEntity } from './infrastructure/fill.entity';
import { OrderEntity } from './infrastructure/order.entity';
import { PaperBroker } from './infrastructure/paper-broker';
import { PerformanceSnapshotEntity } from './infrastructure/performance-snapshot.entity';
import { PortfolioSubscriptionEntity } from './infrastructure/portfolio-subscription.entity';
import { PortfolioEntity } from './infrastructure/portfolio.entity';
import { PositionEntity } from './infrastructure/position.entity';
import { ReconciliationRunEntity } from './infrastructure/reconciliation-run.entity';
import { TradingStateEntity } from './infrastructure/trading-state.entity';
import { PortfoliosController } from './presentation/portfolios.controller';
import { TradingController } from './presentation/trading.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PortfolioEntity,
      PortfolioSubscriptionEntity,
      OrderEntity,
      FillEntity,
      PositionEntity,
      ClosedTradeEntity,
      PerformanceSnapshotEntity,
      TradingStateEntity,
      BrokerAccountEntity,
      ReconciliationRunEntity,
    ]),
    AssetsModule,
    MarketDataModule,
    AnalysisModule,
    AuditModule,
    BacktestingModule,
    NotificationsModule,
    AlpacaModule,
  ],
  controllers: [PortfoliosController, TradingController],
  providers: [
    { provide: BROKER, useClass: PaperBroker },
    AlpacaBroker,
    BrokerRouter,
    OrderService,
    TradingControlService,
    PortfolioService,
    PortfolioValuationService,
    TradingQueryService,
    StrategyHealthService,
    PaperTradingListener,
  ],
  exports: [BROKER, AlpacaBroker, TradingQueryService],
})
export class TradingModule {}
