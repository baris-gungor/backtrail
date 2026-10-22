import { Logger as NestLogger } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { appConfig } from './config';
import { setupSwagger } from './swagger';

const logger = new NestLogger('Process');

// Background work (syncs, broker updates) catches its own errors; anything that slips through
// is logged instead of crashing the process. A synchronous uncaught exception leaves the process
// in an unknown state, so it exits and lets the supervisor restart it.
process.on('unhandledRejection', (reason) => {
  logger.error({ msg: 'Unhandled promise rejection', err: reason });
});
process.on('uncaughtException', (error) => {
  logger.fatal({ msg: 'Uncaught exception, exiting', err: error });
  process.exit(1);
});

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));
  configureApp(app);
  setupSwagger(app);

  const { port, host } = app.get<ConfigType<typeof appConfig>>(appConfig.KEY);
  await app.listen(port, host);
  app.get(Logger).log(`Listening on http://${host}:${port}/api (Swagger: /api/docs)`, 'Bootstrap');
}

bootstrap().catch((error: unknown) => {
  // Logs may still be buffered for the pino logger; print directly so the reason is visible.
  console.error('Startup failed:', error instanceof Error ? (error.stack ?? error.message) : error);
  process.exit(1);
});
