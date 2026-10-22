import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { DomainError, DomainErrorKind } from '../errors/domain.error';

interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path: string;
  timestamp: string;
}

const DOMAIN_ERROR_STATUS: Record<DomainErrorKind, HttpStatus> = {
  not_found: HttpStatus.NOT_FOUND,
  conflict: HttpStatus.CONFLICT,
  invalid: HttpStatus.UNPROCESSABLE_ENTITY,
  upstream: HttpStatus.BAD_GATEWAY,
};

/**
 * Postgres errors that a request can cause on its own (a race the service checks did not catch,
 * a malformed value). They get a client status instead of a 500.
 */
const PG_ERROR_STATUS: Record<string, { status: number; message: string }> = {
  '23505': { status: HttpStatus.CONFLICT, message: 'A record with these values already exists' },
  '23503': {
    status: HttpStatus.CONFLICT,
    message: 'A referenced record does not exist or is still in use',
  },
  '22P02': { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Invalid value format' },
  '22003': { status: HttpStatus.UNPROCESSABLE_ENTITY, message: 'Value out of range' },
};

/**
 * Normalizes every error into one response shape and hides internals of unexpected errors.
 * Client errors (4xx) are logged as one warning line; 5xx and upstream failures as errors, since
 * HTTP access logs are off by default.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();
    const route = `${request.method} ${request.originalUrl}`;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Internal server error';
    let cause: string | undefined;

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const res = exception.getResponse();
      message =
        typeof res === 'string'
          ? res
          : ((res as { message?: string | string[] }).message ?? exception.message);
      if (status >= 500) {
        this.logger.error({ msg: `${route} failed`, err: exception });
      }
    } else if (exception instanceof DomainError) {
      status = DOMAIN_ERROR_STATUS[exception.kind];
      message = exception.message;
      if (exception.kind === 'upstream') {
        this.logger.warn({ msg: `${route}: ${exception.message}`, cause: causeText(exception) });
      }
    } else if (exception instanceof EntityNotFoundError) {
      status = HttpStatus.NOT_FOUND;
      message = 'Record not found';
    } else if (exception instanceof QueryFailedError && pgCode(exception) in PG_ERROR_STATUS) {
      const code = pgCode(exception);
      ({ status, message } = PG_ERROR_STATUS[code]);
      cause = exception.message;
    } else {
      this.logger.error(
        exception instanceof Error
          ? { msg: `${route} failed: ${exception.message}`, err: exception }
          : { msg: `${route} failed: ${String(exception)}` },
      );
    }

    if (status < 500) {
      const text = Array.isArray(message) ? message.join('; ') : message;
      this.logger.warn({ msg: `${route} ${status}: ${text}`, ...(cause ? { cause } : {}) });
    }

    const body: ErrorBody = {
      statusCode: status,
      error: HttpStatus[status] ?? 'Error',
      message,
      path: request.originalUrl,
      timestamp: new Date().toISOString(),
    };

    response.status(status).json(body);
  }
}

function pgCode(error: { driverError?: unknown }): string {
  const code = (error.driverError as { code?: unknown } | undefined)?.code;
  return typeof code === 'string' ? code : '';
}

function causeText(error: Error): string | undefined {
  const cause = error.cause;
  if (cause === undefined) return undefined;
  if (cause instanceof Error) return cause.message;
  return typeof cause === 'string' ? cause : JSON.stringify(cause);
}
