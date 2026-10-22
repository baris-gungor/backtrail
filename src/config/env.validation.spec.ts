import { envValidationSchema } from './env.validation';

const base = { DB_HOST: 'localhost', DB_USER: 'u', DB_PASSWORD: 'p', DB_NAME: 'n' };
const check = (env: Record<string, string>) => envValidationSchema.validate({ ...base, ...env });

describe('envValidationSchema', () => {
  it('binds to loopback by default', () => {
    expect(check({}).value).toMatchObject({ HOST: '127.0.0.1' });
  });

  it('refuses broker keys without API auth', () => {
    const { error } = check({ ALPACA_KEY_ID: 'PKTEST', NODE_ENV: 'production' });
    expect(error?.message).toMatch(/AUTH_USERNAME and AUTH_PASSWORD/);
  });

  it('accepts broker keys with API auth', () => {
    const env = { ALPACA_KEY_ID: 'PKTEST', AUTH_USERNAME: 'me', AUTH_PASSWORD: 'longenough' };
    expect(check(env).error).toBeUndefined();
  });

  it('allows an open API without broker keys', () => {
    expect(check({}).error).toBeUndefined();
  });
});
