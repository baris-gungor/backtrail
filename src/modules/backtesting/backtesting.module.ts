import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AnalysisModule } from '../analysis/analysis.module';
import { AssetsModule } from '../assets/assets.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { BacktestQueryService } from './application/backtest-query.service';
import { BacktestRunnerService } from './application/backtest-runner.service';
import { BacktestRunEntity } from './infrastructure/backtest-run.entity';
import { BacktestTradeEntity } from './infrastructure/backtest-trade.entity';
import { BacktestsController } from './presentation/backtests.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([BacktestRunEntity, BacktestTradeEntity]),
    AssetsModule,
    MarketDataModule,
    AnalysisModule,
  ],
  controllers: [BacktestsController],
  providers: [BacktestRunnerService, BacktestQueryService],
  exports: [BacktestQueryService],
})
export class BacktestingModule {}
