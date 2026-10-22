import type { Request, Response } from 'express';
import { basicAuth, parseBasicAuth } from './basic-auth.middleware';

const header = (user: string, pass: string) =>
  `Basic ${Buffer.from(`${user}:${pass}`).toString('base64')}`;

function run(path: string, authorization?: string) {
  const result = { next: false, status: 0, headers: {} as Record<string, string> };
  const res = {
    status(code: number) {
      result.status = code;
      return this;
    },
    setHeader(name: string, value: string) {
      result.headers[name] = value;
      return this;
    },
    json() {
      return this;
    },
  };
  const req = { path, originalUrl: path, headers: { authorization } };
  basicAuth('admin', 's3cret:pw')(req as unknown as Request, res as unknown as Response, () => {
    result.next = true;
  });
  return result;
}

describe('basicAuth', () => {
  it('passes with the right credentials (password may contain a colon)', () => {
    expect(run('/api/assets', header('admin', 's3cret:pw')).next).toBe(true);
  });

  it.each([
    ['missing header', undefined],
    ['wrong password', header('admin', 'nope')],
    ['wrong user', header('root', 's3cret:pw')],
    ['other scheme', 'Bearer abc'],
  ])('rejects %s with 401 and a Basic challenge', (_name, authorization) => {
    const result = run('/api/assets', authorization);
    expect(result.next).toBe(false);
    expect(result.status).toBe(401);
    expect(result.headers['WWW-Authenticate']).toMatch(/^Basic realm="backtrail"/);
  });

  it('keeps the health check public', () => {
    expect(run('/api/health').next).toBe(true);
  });

  it('protects Swagger', () => {
    expect(run('/api/docs').status).toBe(401);
  });
});

describe('parseBasicAuth', () => {
  it('returns null for malformed values', () => {
    expect(parseBasicAuth('Basic')).toBeNull();
    expect(parseBasicAuth(`Basic ${Buffer.from('nocolon').toString('base64')}`)).toBeNull();
  });
});
