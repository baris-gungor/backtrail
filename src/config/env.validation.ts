import * as Joi from 'joi';
import { ALPACA_PAPER_BASE_URL, ALPACA_PAPER_STREAM_URL } from './alpaca.config';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().port().default(3000),
  // Interface the HTTP server binds to. Loopback by default; use 0.0.0.0 only behind a proxy or tunnel.
  HOST: Joi.string().default('127.0.0.1'),
  LOG_LEVEL: Joi.string()
    .valid('fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent')
    .default('info'),
  LOG_HTTP: Joi.boolean().default(false),

  // HTTP Basic Auth for the API and Swagger. Set both or neither (empty = open, warned at startup).
  AUTH_USERNAME: Joi.string().allow('').default(''),
  AUTH_PASSWORD: Joi.string().allow('').default(''),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().port().default(5432),
  DB_USER: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_LOGGING: Joi.boolean().default(false),

  MARKET_DATA_SYNC_ON_STARTUP: Joi.boolean().default(true),
  MARKET_DATA_HISTORY_DAYS: Joi.number().integer().min(1).max(729).default(720),
  MARKET_DATA_SYNC_SCHEDULE: Joi.boolean().default(true),
  MARKET_DATA_SYNC_DELAY_MINUTES: Joi.number().integer().min(0).max(25).default(5),
  // SEC EDGAR (earnings dates) asks for a descriptive User-Agent, ideally with a contact.
  SEC_USER_AGENT: Joi.string().allow('').default(''),

  // Alpaca demo (paper) account. Only the paper endpoints are valid: live trading is not supported.
  ALPACA_KEY_ID: Joi.string().allow('').default(''),
  ALPACA_SECRET_KEY: Joi.string().allow('').default(''),
  ALPACA_BASE_URL: Joi.string()
    .valid(ALPACA_PAPER_BASE_URL)
    .default(ALPACA_PAPER_BASE_URL)
    .messages({
      'any.only': 'ALPACA_BASE_URL must be the paper endpoint; live trading is disabled',
    }),
  ALPACA_STREAM_URL: Joi.string().valid(ALPACA_PAPER_STREAM_URL).default(ALPACA_PAPER_STREAM_URL),
  ALPACA_RECONCILE_MINUTES: Joi.number().integer().min(0).max(1440).default(15),

  // Telegram notifications. Leave empty to disable.
  TELEGRAM_BOT_TOKEN: Joi.string().allow('').default(''),
  TELEGRAM_CHAT_ID: Joi.string().allow('').default(''),
  NOTIFY_LOCALE: Joi.string().valid('tr', 'en').default('tr'),
}).custom(
  (
    env: { NODE_ENV: string; AUTH_USERNAME: string; AUTH_PASSWORD: string; ALPACA_KEY_ID: string },
    helpers,
  ) => {
    const { AUTH_USERNAME: user, AUTH_PASSWORD: pass } = env;
    // Broker keys let the API place orders, so the API must not run open (e2e runs without auth).
    if (env.ALPACA_KEY_ID !== '' && pass === '' && env.NODE_ENV !== 'test') {
      return helpers.message({
        custom:
          'Set AUTH_USERNAME and AUTH_PASSWORD when ALPACA_KEY_ID is set: the API can place orders',
      });
    }
    if ((user === '') !== (pass === '')) {
      return helpers.message({ custom: 'Set both AUTH_USERNAME and AUTH_PASSWORD, or neither' });
    }
    if (pass !== '' && pass.length < 8) {
      return helpers.message({ custom: 'AUTH_PASSWORD must be at least 8 characters' });
    }
    return env;
  },
);
