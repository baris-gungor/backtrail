import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config.mts';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['test/**/*.e2e-spec.ts'],
    globalSetup: ['test/setup/global-setup.ts'],
    setupFiles: ['dotenv/config'],
    // Overrides .env for e2e runs; global-setup reads the same values.
    env: {
      NODE_ENV: 'test',
      DB_NAME: 'fin_agent_test',
      LOG_LEVEL: 'silent',
      MARKET_DATA_SYNC_ON_STARTUP: 'false',
      MARKET_DATA_SYNC_SCHEDULE: 'false',
      // The fake Alpaca client is enabled in e2e; periodic order sync and reconciliation stay off.
      ALPACA_RECONCILE_MINUTES: '0',
      // Auth and notifications are off unless a test turns them on (auth.e2e-spec.ts).
      AUTH_USERNAME: '',
      AUTH_PASSWORD: '',
      TELEGRAM_BOT_TOKEN: '',
      TELEGRAM_CHAT_ID: '',
      NOTIFY_LOCALE: 'tr',
    },
    fileParallelism: false,
    hookTimeout: 60_000,
    // DB-backed tests take ~1.5s; the 5s default is too tight when the machine is busy.
    testTimeout: 20_000,
  },
});
