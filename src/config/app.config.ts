import { registerAs } from '@nestjs/config';

export interface AppConfig {
  env: string;
  port: number;
  /** Interface the HTTP server binds to. */
  host: string;
  logLevel: string;
  /** One access log line per HTTP request. Off by default; errors are logged either way. */
  logHttp: boolean;
}

export const appConfig = registerAs('app', (): AppConfig => ({
  env: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '127.0.0.1',
  logLevel: process.env.LOG_LEVEL ?? 'info',
  logHttp: process.env.LOG_HTTP === 'true',
}));
