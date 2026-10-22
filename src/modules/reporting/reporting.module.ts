import { Module } from '@nestjs/common';
import { AnalysisModule } from '../analysis/analysis.module';
import { AssetsModule } from '../assets/assets.module';
import { MarketDataModule } from '../market-data/market-data.module';
import { TradingModule } from '../trading/trading.module';
import { ReportService } from './application/report.service';
import { ReportQueries } from './infrastructure/report.queries';
import { ReportsController } from './presentation/reports.controller';

/** Read-only reports over backtests, paper portfolios and signals. */
@Module({
  imports: [AssetsModule, MarketDataModule, AnalysisModule, TradingModule],
  controllers: [ReportsController],
  providers: [ReportService, ReportQueries],
})
export class ReportingModule {}
