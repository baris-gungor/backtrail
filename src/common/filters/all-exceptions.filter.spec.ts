import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { EntityNotFoundError, QueryFailedError } from 'typeorm';
import { AlpacaApiError } from '../../integrations/alpaca/alpaca-client.port';
import { NotFoundError } from '../errors/domain.error';
import { AllExceptionsFilter } from './all-exceptions.filter';

function respond(exception: unknown): { status: number; body: { message: unknown } } {
  const result = { status: 0, body: { message: undefined as unknown } };
  const response = {
    status(code: number) {
      result.status = code;
      return this;
    },
    json(body: { message: unknown }) {
      result.body = body;
    },
  };
  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => ({ method: 'GET', originalUrl: '/api/x' }),
    }),
  } as unknown as ArgumentsHost;
  new AllExceptionsFilter().catch(exception, host);
  return result;
}

function pgError(code: string): QueryFailedError {
  return new QueryFailedError('INSERT ...', [], Object.assign(new Error('pg'), { code }));
}

describe('AllExceptionsFilter', () => {
  let logError: ReturnType<typeof vi.spyOn>;
  let logWarn: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    logError = vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    logWarn = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => vi.restoreAllMocks());

  it('maps domain errors to their status', () => {
    expect(respond(new NotFoundError('nope'))).toMatchObject({
      status: 404,
      body: { message: 'nope' },
    });
  });

  it('answers Alpaca failures with 502 and the broker message', () => {
    expect(respond(new AlpacaApiError(403, 'forbidden'))).toMatchObject({
      status: 502,
      body: { message: 'Alpaca: forbidden' },
    });
  });

  it('maps constraint and format errors from Postgres to client errors', () => {
    expect(respond(pgError('23505')).status).toBe(409);
    expect(respond(pgError('23503')).status).toBe(409);
    expect(respond(pgError('22P02')).status).toBe(422);
    expect(respond(new EntityNotFoundError('Portfolio', {})).status).toBe(404);
  });

  it('hides unexpected errors and logs them', () => {
    const result = respond(pgError('57P01'));
    expect(result).toMatchObject({ status: 500, body: { message: 'Internal server error' } });
    expect(logError).toHaveBeenCalled();
  });

  it('keeps validation messages and logs client errors as one warning', () => {
    const result = respond(new BadRequestException(['name must be a string', 'age is required']));
    expect(result).toMatchObject({ status: 400 });
    expect(logError).not.toHaveBeenCalled();
    expect(logWarn).toHaveBeenCalledOnce();
    expect(logWarn).toHaveBeenCalledWith({
      msg: 'GET /api/x 400: name must be a string; age is required',
    });
  });

  it('logs a Postgres client error once, with the database message', () => {
    respond(pgError('23505'));
    expect(logWarn).toHaveBeenCalledOnce();
    expect(logWarn).toHaveBeenCalledWith({
      msg: 'GET /api/x 409: A record with these values already exists',
      cause: 'pg',
    });
  });
});
