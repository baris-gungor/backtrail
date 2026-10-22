import { randomUUID } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Params } from 'nestjs-pino';

export interface LoggerSettings {
  level: string;
  /** Human-readable single-line output (development) instead of JSON. */
  pretty: boolean;
  /** Per-request access logs. */
  httpLogs: boolean;
}

/**
 * Nest bootstrap contexts that print one line per module and route at info level.
 * Swagger already lists the routes, so they are logged only at trace level.
 */
const BOOT_NOISE = new Set(['InstanceLoader', 'RoutesResolver', 'RouterExplorer']);

/** Paths that are polled and not worth an access log line. */
const QUIET_PATHS = ['/api/health', '/api/docs'];

const PINO_INFO = 30;

export function loggerOptions(settings: LoggerSettings): Params {
  return {
    pinoHttp: {
      level: settings.level,
      transport: settings.pretty
        ? {
            target: 'pino-pretty',
            options: {
              singleLine: true,
              translateTime: 'SYS:HH:MM:ss.l',
              ignore: 'pid,hostname,context,req,res,reqId,responseTime',
              messageFormat: '{if context}[{context}] {end}{msg}',
            },
          }
        : undefined,
      hooks: {
        logMethod(args, method, level) {
          const context = (args[0] as { context?: unknown } | undefined)?.context;
          if (level <= PINO_INFO && typeof context === 'string' && BOOT_NOISE.has(context)) {
            if (this.isLevelEnabled('trace')) method.apply(this, args);
            return;
          }
          method.apply(this, args);
        },
      },
      autoLogging: settings.httpLogs
        ? { ignore: (req) => QUIET_PATHS.some((p) => req.url?.startsWith(p)) }
        : false,
      // Logs written while handling a request carry only `reqId`, not the whole request.
      quietReqLogger: true,
      genReqId: (req: IncomingMessage, res: ServerResponse) => {
        const header = req.headers['x-request-id'];
        const id = typeof header === 'string' && header ? header : randomUUID();
        res.setHeader('x-request-id', id);
        return id;
      },
      customLogLevel: (_req, res, error) => {
        if (error || res.statusCode >= 500) return 'error';
        if (res.statusCode >= 400) return 'warn';
        return 'info';
      },
      customSuccessMessage: (req, res, responseTime) =>
        `${req.method} ${req.url} ${res.statusCode} ${Math.round(responseTime)}ms`,
      customErrorMessage: (req, res, error) =>
        `${req.method} ${req.url} ${res.statusCode} ${error.message}`,
      // Keep JSON access logs small: no headers, no remote address.
      serializers: {
        req: (req: { id: unknown; method: string; url: string }) => ({
          id: req.id,
          method: req.method,
          url: req.url,
        }),
        res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
      },
    },
  };
}
