import { Module } from '@nestjs/common';
import { ConfigModule, ConfigType } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { LoggerModule } from 'nestjs-pino';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { loggerOptions } from './common/logging/logger.options';
import {
  alpacaConfig,
  appConfig,
  authConfig,
  databaseConfig,
  envValidationSchema,
  marketDataConfig,
  notificationsConfig,
} from './config';
import { DatabaseModule } from './database/database.module';
import { HealthModule } from './health/health.module';
import { AnalysisModule } from './modules/analysis/analysis.module';
import { AuditModule } from './modules/audit/audit.module';
import { AssetsModule } from './modules/assets/assets.module';
import { BacktestingModule } from './modules/backtesting/backtesting.module';
import { MarketDataModule } from './modules/market-data/market-data.module';
import { NotificationsModule } from './modules/notifications/notifications.module';
import { ReportingModule } from './modules/reporting/reporting.module';
import { TradingModule } from './modules/trading/trading.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      load: [
        appConfig,
        authConfig,
        databaseConfig,
        marketDataConfig,
        alpacaConfig,
        notificationsConfig,
      ],
      validationSchema: envValidationSchema,
    }),
    LoggerModule.forRootAsync({
      inject: [appConfig.KEY],
      useFactory: (app: ConfigType<typeof appConfig>) =>
        loggerOptions({
          level: app.logLevel,
          pretty: app.env === 'development',
          httpLogs: app.logHttp && app.env !== 'test',
        }),
    }),
    EventEmitterModule.forRoot(),
    DatabaseModule,
    HealthModule,
    AuditModule,
    NotificationsModule,
    AssetsModule,
    MarketDataModule,
    AnalysisModule,
    BacktestingModule,
    TradingModule,
    ReportingModule,
  ],
  providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }],
})
export class AppModule {}
