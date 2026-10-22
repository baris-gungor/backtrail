import request from 'supertest';
import { createTestApp, TestContext } from './setup/create-test-app';

describe('Basic Auth (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    // Config factories read the environment when the app module compiles.
    process.env.AUTH_USERNAME = 'admin';
    process.env.AUTH_PASSWORD = 'correct-horse';
    ctx = await createTestApp();
  });

  afterAll(async () => {
    process.env.AUTH_USERNAME = '';
    process.env.AUTH_PASSWORD = '';
    await ctx.app.close();
  });

  const api = () => request(ctx.app.getHttpServer());

  it('rejects requests without credentials with a Basic challenge', async () => {
    const res = await api().get('/api/assets').expect(401);
    expect(res.headers['www-authenticate']).toMatch(/^Basic realm="backtrail"/);
    expect(res.body).toMatchObject({ statusCode: 401, error: 'Unauthorized' });
  });

  it('rejects a wrong password', async () => {
    await api().get('/api/assets').auth('admin', 'wrong-password').expect(401);
  });

  it('accepts the configured credentials', async () => {
    await api().get('/api/assets').auth('admin', 'correct-horse').expect(200);
  });

  it('keeps the health check public', async () => {
    await api().get('/api/health').expect(200);
  });
});
