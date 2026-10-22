import request from 'supertest';
import { createTestApp, TestContext } from './setup/create-test-app';

describe('Health (e2e)', () => {
  let ctx: TestContext;

  beforeAll(async () => {
    ctx = await createTestApp();
  });

  afterAll(async () => {
    await ctx.app.close();
  });

  it('GET /api/health reports database up', async () => {
    const res = await request(ctx.app.getHttpServer()).get('/api/health').expect(200);
    expect(res.body).toMatchObject({ status: 'ok', info: { database: { status: 'up' } } });
  });
});
