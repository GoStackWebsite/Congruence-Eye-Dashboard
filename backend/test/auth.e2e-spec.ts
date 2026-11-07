import { bearer, createTestApp, Ctx } from './helpers';

describe('Auth', () => {
  let c: Ctx;
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());

  it('health is public', async () => {
    const r = await c.http().get('/api/health').expect(200);
    expect(r.body).toMatchObject({ status: 'ok', db: 'up' });
    expect(typeof r.body.time).toBe('string');
  });

  it('login ok returns token + user', async () => {
    const r = await c.http().post('/api/auth/login').send({ email: 'admin@congruence.in', password: 'Password@123' }).expect(200);
    expect(r.body.accessToken).toBeTruthy();
    expect(r.body.user).toMatchObject({ email: 'admin@congruence.in', role: 'SUPER_ADMIN', isActive: true });
    expect(Array.isArray(r.body.user.storeIds)).toBe(true);
    expect(r.body.user.passwordHash).toBeUndefined();
  });

  it('login with bad password → 401', async () => {
    const r = await c.http().post('/api/auth/login').send({ email: 'admin@congruence.in', password: 'nope' }).expect(401);
    expect(r.body.statusCode).toBe(401);
  });

  it('login validation → 400', async () => {
    await c.http().post('/api/auth/login').send({ email: 'not-an-email' }).expect(400);
  });

  it('me returns current user', async () => {
    const r = await c.http().get('/api/auth/me').set(bearer(c.tokens.manager)).expect(200);
    expect(r.body).toMatchObject({ email: 'manager.tnagar@congruence.in', role: 'STORE_MANAGER', storeIds: [c.seed.stores.tnagar] });
    expect(Object.keys(r.body).sort()).toEqual(['createdAt', 'email', 'id', 'isActive', 'name', 'role', 'storeIds']);
  });

  it('401 without / with bad token', async () => {
    await c.http().get('/api/auth/me').expect(401);
    await c.http().get('/api/stores').set(bearer('garbage')).expect(401);
  });

  it('change password', async () => {
    await c.http().post('/api/auth/change-password').set(bearer(c.tokens.staff)).send({ currentPassword: 'wrong', newPassword: 'NewPass@1' }).expect(400);
    const r = await c.http().post('/api/auth/change-password').set(bearer(c.tokens.staff)).send({ currentPassword: 'Password@123', newPassword: 'NewPass@1' }).expect(200);
    expect(r.body).toEqual({ ok: true });
    await c.http().post('/api/auth/login').send({ email: 'staff.tnagar@congruence.in', password: 'NewPass@1' }).expect(200);
  });

  it('deactivated user cannot use token', async () => {
    const u = await c.http().post('/api/users').set(bearer(c.tokens.admin)).send({ email: 'temp@congruence.in', name: 'Temp', role: 'STAFF', password: 'Password@123', storeIds: [c.seed.stores.tnagar] }).expect(201);
    const login = await c.http().post('/api/auth/login').send({ email: 'temp@congruence.in', password: 'Password@123' }).expect(200);
    await c.http().delete(`/api/users/${u.body.id}`).set(bearer(c.tokens.admin)).expect(200);
    await c.http().get('/api/auth/me').set(bearer(login.body.accessToken)).expect(401);
    await c.http().post('/api/auth/login').send({ email: 'temp@congruence.in', password: 'Password@123' }).expect(401);
  });
});
