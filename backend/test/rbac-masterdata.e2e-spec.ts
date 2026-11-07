import { bearer, createTestApp, Ctx } from './helpers';

describe('RBAC, store scoping and master data CRUD', () => {
  let c: Ctx;
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());
  const as = (role: string) => ({
    get: (p: string) => c.http().get(p).set(bearer(c.tokens[role])),
    post: (p: string, b?: unknown) => c.http().post(p).set(bearer(c.tokens[role])).send(b as object),
    patch: (p: string, b?: unknown) => c.http().patch(p).set(bearer(c.tokens[role])).send(b as object),
    put: (p: string, b?: unknown) => c.http().put(p).set(bearer(c.tokens[role])).send(b as object),
    del: (p: string) => c.http().delete(p).set(bearer(c.tokens[role])),
  });

  describe('scoping', () => {
    it('STORE_MANAGER sees only T Nagar', async () => {
      const r = await as('manager').get('/api/stores').expect(200);
      expect(r.body.map((s: { id: number }) => s.id)).toEqual([c.seed.stores.tnagar]);
      await as('manager').get(`/api/stores/${c.seed.stores.annanagar}`).expect(403);
      await as('manager').get(`/api/analytics/live?storeId=${c.seed.stores.annanagar}`).expect(403);
      await as('manager').get(`/api/analytics/journey?storeId=${c.seed.stores.annanagar}`).expect(403);
      const cams = await as('manager').get(`/api/cameras?storeId=${c.seed.stores.annanagar}`).expect(200);
      expect(cams.body).toEqual([]);
      const b = await as('manager').get('/api/analytics/benchmark').expect(200);
      expect(b.body.map((x: { storeId: number }) => x.storeId)).toEqual([c.seed.stores.tnagar]);
      const regions = await as('manager').get('/api/regions').expect(200);
      expect(regions.body).toEqual([{ id: c.seed.regions.chennai, name: 'Chennai' }]);
    });

    it('REGIONAL_MANAGER sees Chennai stores, admin sees all', async () => {
      const r = await as('regional').get('/api/stores').expect(200);
      expect(r.body.map((s: { id: number }) => s.id)).toEqual([c.seed.stores.tnagar, c.seed.stores.annanagar]);
      const a = await as('admin').get('/api/stores').expect(200);
      expect(a.body).toHaveLength(3);
      expect(a.body[0]).toMatchObject({ code: 'CNG-TNR', regionName: 'Chennai', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:30', isActive: true });
    });

    it('STAFF cannot create store / camera / region (403)', async () => {
      await as('staff').post('/api/stores', { code: 'X', name: 'X', regionId: c.seed.regions.chennai }).expect(403);
      await as('staff').post('/api/regions', { name: 'X' }).expect(403);
      await as('manager').post('/api/cameras', { storeId: c.seed.stores.tnagar, name: 'X', type: 'ZONE' }).expect(403);
      await as('manager').put('/api/settings', { bounceSec: 10 }).expect(403);
      await as('manager').get('/api/audit-logs').expect(403);
    });

    it('STORE_MANAGER can manage staff only in own store', async () => {
      await as('manager').post('/api/staff', { storeId: c.seed.stores.annanagar, code: 'S1', name: 'X' }).expect(403);
      await as('staff').post('/api/staff', { storeId: c.seed.stores.tnagar, code: 'S1', name: 'X' }).expect(403);
    });
  });

  describe('CRUD', () => {
    it('regions', async () => {
      const r = await as('admin').post('/api/regions', { name: 'Madurai' }).expect(201);
      expect(r.body).toEqual({ id: expect.any(Number), name: 'Madurai' });
      await as('admin').post('/api/regions', { name: 'Madurai' }).expect(409);
      const u = await as('admin').patch(`/api/regions/${r.body.id}`, { name: 'Madurai South' }).expect(200);
      expect(u.body.name).toBe('Madurai South');
      await as('admin').del(`/api/regions/${c.seed.regions.chennai}`).expect(409);
      await as('admin').del(`/api/regions/${r.body.id}`).expect(200);
      await as('admin').post('/api/regions', {}).expect(400);
    });

    let storeId: number;
    it('stores', async () => {
      const r = await as('admin').post('/api/stores', {
        code: 'CNG-TST', name: 'Test Store', regionId: c.seed.regions.chennai, city: 'Chennai', address: '1 Test Rd', openTime: '09:30', closeTime: '22:00', areaSqft: 3000, latitude: 13.0, longitude: 80.2, extraneous: 'stripped',
      }).expect(201);
      storeId = r.body.id;
      expect(r.body).toMatchObject({ code: 'CNG-TST', regionName: 'Chennai', timezone: 'Asia/Kolkata', openTime: '09:30', isActive: true, latitude: 13, areaSqft: 3000 });
      expect(r.body.extraneous).toBeUndefined();
      await as('admin').post('/api/stores', { code: 'CNG-TST', name: 'Dup', regionId: c.seed.regions.chennai }).expect(409);
      await as('admin').post('/api/stores', { code: 'BAD', name: 'Bad', regionId: c.seed.regions.chennai, openTime: '25:00' }).expect(400);
      const p = await as('admin').patch(`/api/stores/${storeId}`, { name: 'Test Store 2', closeTime: '21:00' }).expect(200);
      expect(p.body).toMatchObject({ name: 'Test Store 2', closeTime: '21:00' });
      const g = await as('admin').get(`/api/stores/${c.seed.stores.tnagar}`).expect(200);
      expect(g.body.cameras).toHaveLength(3);
      expect(g.body.zones.length).toBeGreaterThanOrEqual(6);
      expect(g.body.cameras[0]).toEqual({ id: expect.any(Number), storeId: c.seed.stores.tnagar, name: 'Entrance', rtspUrl: expect.any(String), type: 'ENTRANCE', status: 'UNKNOWN', lastHeartbeatAt: null, isActive: true, fps: null, recorderId: null, channel: null, streamProfile: null });
      await as('admin').get('/api/stores/9999').expect(404);
    });

    let cameraId: number;
    it('cameras', async () => {
      const r = await as('admin').post('/api/cameras', { storeId, name: 'Entrance', type: 'ENTRANCE', rtspUrl: 'rtsp://x/1', fps: 15 }).expect(201);
      cameraId = r.body.id;
      expect(r.body).toMatchObject({ storeId, status: 'UNKNOWN', fps: 15 });
      await as('admin').post('/api/cameras', { storeId, name: 'X', type: 'NOPE' }).expect(400);
      const p = await as('admin').patch(`/api/cameras/${cameraId}`, { name: 'Main Entrance' }).expect(200);
      expect(p.body.name).toBe('Main Entrance');
      expect((await as('admin').get(`/api/cameras/${cameraId}`).expect(200)).body.name).toBe('Main Entrance');
      await as('admin').del(`/api/cameras/${cameraId}`).expect(200);
      expect((await as('admin').get(`/api/cameras/${cameraId}`).expect(200)).body.isActive).toBe(false);
    });

    it('zones', async () => {
      const r = await as('admin').post('/api/zones', { storeId, cameraId, name: 'Door', type: 'ENTRY_LINE', polygon: [[0.1, 0.5], [0.9, 0.5]], inDirection: 'DOWN' }).expect(201);
      expect(r.body).toMatchObject({ type: 'ENTRY_LINE', inDirection: 'DOWN', engagedDwellSec: 30, polygon: [[0.1, 0.5], [0.9, 0.5]] });
      await as('admin').post('/api/zones', { storeId, cameraId, name: 'Bad', type: 'ENTRY_LINE', polygon: [[0.1, 0.5], [0.9, 0.5], [0.5, 0.5]] }).expect(400);
      await as('admin').post('/api/zones', { storeId, cameraId, name: 'Bad', type: 'SECTION', polygon: [[0.1, 0.5], [1.9, 0.5], [0.5, 0.5]] }).expect(400);
      await as('admin').post('/api/zones', { storeId, cameraId: c.seed.cameras.entrance, name: 'Bad', type: 'SECTION', polygon: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]] }).expect(400);
      const q = await as('admin').post('/api/zones', { storeId, cameraId, name: 'Counter', type: 'QUEUE', polygon: [[0.1, 0.1], [0.2, 0.1], [0.2, 0.2]], queueAlertLength: 5 }).expect(201);
      const p = await as('admin').patch(`/api/zones/${q.body.id}`, { queueAlertWaitSec: 240, engagedDwellSec: 45 }).expect(200);
      expect(p.body).toMatchObject({ queueAlertLength: 5, queueAlertWaitSec: 240, engagedDwellSec: 45 });
      const list = await as('admin').get(`/api/zones?storeId=${storeId}&cameraId=${cameraId}`).expect(200);
      expect(list.body).toHaveLength(2);
      await as('admin').del(`/api/zones/${q.body.id}`).expect(200);
    });

    it('edge devices: create shows key once, key works, rotate invalidates old', async () => {
      const r = await as('admin').post('/api/edge-devices', { storeId, name: 'Edge 1' }).expect(201);
      expect(r.body.apiKey).toMatch(/^ce_/);
      expect(r.body.apiKeyPrefix).toBe(r.body.apiKey.slice(0, 8));
      const list = await as('admin').get(`/api/edge-devices?storeId=${storeId}`).expect(200);
      expect(list.body[0].apiKey).toBeUndefined();
      await c.http().get('/api/ingest/config').set('X-Api-Key', r.body.apiKey).expect(200);
      const rot = await as('admin').post(`/api/edge-devices/${r.body.id}/rotate-key`).expect(200);
      expect(rot.body.apiKey).not.toBe(r.body.apiKey);
      await c.http().get('/api/ingest/config').set('X-Api-Key', r.body.apiKey).expect(401);
      const cfg = await c.http().get('/api/ingest/config').set('X-Api-Key', rot.body.apiKey).expect(200);
      expect(cfg.body.store.id).toBe(storeId);
      await as('admin').del(`/api/edge-devices/${r.body.id}`).expect(200);
      await c.http().get('/api/ingest/config').set('X-Api-Key', rot.body.apiKey).expect(401);
    });

    it('users', async () => {
      const r = await as('admin').post('/api/users', { email: 'New.User@Congruence.in', name: 'New User', role: 'STORE_MANAGER', password: 'Secret@123', storeIds: [storeId] }).expect(201);
      expect(r.body).toEqual({ id: expect.any(Number), email: 'new.user@congruence.in', name: 'New User', role: 'STORE_MANAGER', isActive: true, storeIds: [storeId], createdAt: expect.any(String) });
      await as('admin').post('/api/users', { email: 'new.user@congruence.in', name: 'Dup', role: 'STAFF', password: 'Secret@123' }).expect(409);
      await as('admin').post('/api/users', { email: 'x@congruence.in', name: 'Bad', role: 'KING', password: 'Secret@123' }).expect(400);
      await as('admin').post('/api/users', { email: 'y@congruence.in', name: 'Bad', role: 'STAFF', password: 'Secret@123', storeIds: [999] }).expect(400);
      const p = await as('admin').patch(`/api/users/${r.body.id}`, { role: 'REGIONAL_MANAGER', storeIds: [storeId, c.seed.stores.tnagar] }).expect(200);
      expect(p.body).toMatchObject({ role: 'REGIONAL_MANAGER', storeIds: [c.seed.stores.tnagar, storeId].sort((a, b) => a - b) });
      const d = await as('admin').del(`/api/users/${r.body.id}`).expect(200);
      expect(d.body.isActive).toBe(false);
      await as('manager').post('/api/users', { email: 'z@congruence.in', name: 'Z', role: 'STAFF', password: 'Secret@123' }).expect(403);
      const mine = await as('manager').get('/api/users').expect(200);
      expect(mine.body.every((u: { storeIds: number[] }) => u.storeIds.includes(c.seed.stores.tnagar))).toBe(true);
    });

    it('staff roster', async () => {
      const r = await as('manager').post('/api/staff', { storeId: c.seed.stores.tnagar, code: 'TNR-S01', name: 'Ravi', designation: 'Cashier', shiftStart: '09:30', shiftEnd: '18:30' }).expect(201);
      expect(r.body).toEqual({ id: expect.any(Number), storeId: c.seed.stores.tnagar, code: 'TNR-S01', name: 'Ravi', designation: 'Cashier', shiftStart: '09:30', shiftEnd: '18:30', isActive: true });
      await as('manager').post('/api/staff', { storeId: c.seed.stores.tnagar, code: 'TNR-S01', name: 'Dup' }).expect(409);
      await as('manager').patch(`/api/staff/${r.body.id}`, { designation: 'Senior Cashier' }).expect(200);
      const l = await as('staff').get(`/api/staff?storeId=${c.seed.stores.tnagar}`).expect(200);
      expect(l.body[0].designation).toBe('Senior Cashier');
      await as('manager').del(`/api/staff/${r.body.id}`).expect(200);
      expect((await as('manager').get('/api/staff').expect(200)).body).toHaveLength(0);
    });

    it('store soft delete', async () => {
      await as('admin').del(`/api/stores/${storeId}`).expect(200);
      expect((await as('admin').get(`/api/stores/${storeId}`).expect(200)).body.isActive).toBe(false);
    });
  });

  describe('settings', () => {
    it('get defaults and update', async () => {
      const g = await as('staff').get('/api/settings').expect(200);
      expect(g.body).toEqual({ engagedStoreDwellSec: 300, bounceSec: 60, repeatWindowDays: 30, currency: 'INR', companyName: 'Congruence', alertEmailEnabled: false, aiServiceUrl: 'http://localhost:8000', checklistReminderMinutes: 60 });
      const p = await as('admin').put('/api/settings', { bounceSec: 45, smtpHost: 'smtp.example.com', smtpPort: 587, smtpPassword: 'secret', alertEmailEnabled: true }).expect(200);
      expect(p.body).toMatchObject({ bounceSec: 45, smtpHost: 'smtp.example.com', smtpPort: 587, alertEmailEnabled: true });
      expect(p.body.smtpPassword).toBeUndefined();
      await as('admin').put('/api/settings', { bounceSec: -1 }).expect(400);
      await as('admin').put('/api/settings', { bounceSec: 60, smtpHost: '', alertEmailEnabled: false }).expect(200);
    });
  });

  describe('audit log', () => {
    it('records create/update/delete with paged format', async () => {
      const r = await as('admin').get('/api/audit-logs?pageSize=5').expect(200);
      expect(Object.keys(r.body).sort()).toEqual(['items', 'page', 'pageSize', 'total']);
      expect(r.body.page).toBe(1);
      expect(r.body.pageSize).toBe(5);
      expect(r.body.items).toHaveLength(5);
      expect(r.body.total).toBeGreaterThan(10);
      const stores = await as('admin').get('/api/audit-logs?entity=stores&pageSize=50').expect(200);
      const actions = stores.body.items.map((i: { action: string }) => i.action);
      expect(actions).toEqual(expect.arrayContaining(['CREATE', 'UPDATE', 'DELETE']));
      const item = stores.body.items.find((i: { action: string }) => i.action === 'CREATE');
      expect(item).toMatchObject({ userId: c.seed.users.get('admin@congruence.in'), userName: expect.stringContaining('Admin'), entity: 'stores', entityId: expect.any(Number) });
      const users = await as('admin').get('/api/audit-logs?entity=users&pageSize=50').expect(200);
      expect(users.body.items.some((i: { details: string }) => i.details.includes('"password":"***"'))).toBe(true);
      const logins = await as('admin').get(`/api/audit-logs?entity=auth&userId=${c.seed.users.get('admin@congruence.in')}`).expect(200);
      expect(logins.body.items[0].action).toBe('LOGIN');
      const big = await as('admin').get('/api/audit-logs?pageSize=100000&page=0').expect(200);
      expect(big.body.pageSize).toBe(500);
      expect(big.body.page).toBe(1);
    });
  });
});
