import { DataSource } from 'typeorm';
import { AiDetection } from '../src/modules/ai-manager/entities/ai-detection.entity';
import { bearer, createTestApp, Ctx, istDate } from './helpers';

/** Regression tests for the backend-owned items of docs/qa/FINDINGS.md. */
describe('QA findings regressions (backend)', () => {
  let c: Ctx;
  const A = () => bearer(c.tokens.admin);
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());

  it('F-AUDIT updates and deletes store the previous values (changed fields only, secrets never included)', async () => {
    const st = (await c.http().post('/api/stores').set(A()).send({ code: 'AUD-1', name: 'Audit Store', regionId: c.seed.regions.chennai, openTime: '10:00' }).expect(201)).body;
    await c.http().patch(`/api/stores/${st.id}`).set(A()).send({ name: 'Audit Store Renamed', openTime: '09:30' }).expect(200);
    const logs = (await c.http().get(`/api/audit-logs?entity=stores&pageSize=50`).set(A()).expect(200)).body.items;
    const upd = logs.find((l: { action: string; entityId: number }) => l.action === 'UPDATE' && l.entityId === st.id);
    const d = JSON.parse(upd.details);
    expect(d.before).toEqual({ name: 'Audit Store', openTime: '10:00' });
    expect(d.after).toEqual({ name: 'Audit Store Renamed', openTime: '09:30' });
    // settings (no id) and a user update (password never stored, not even masked)
    await c.http().put('/api/settings').set(A()).send({ bounceSec: 75 }).expect(200);
    const s = JSON.parse((await c.http().get('/api/audit-logs?entity=settings&pageSize=5').set(A()).expect(200)).body.items[0].details);
    expect(s.before.bounceSec).toBe(60);
    expect(s.after.bounceSec).toBe(75);
    const uid = c.seed.users.get('staff.tnagar@congruence.in');
    await c.http().patch(`/api/users/${uid}`).set(A()).send({ name: 'Divya M', password: 'NewPassword@1' }).expect(200);
    const u = (await c.http().get('/api/audit-logs?entity=users&pageSize=5').set(A()).expect(200)).body.items[0];
    expect(u.details).not.toMatch(/passwordHash|NewPassword/);
    expect(JSON.parse(u.details).before).toEqual({ name: 'Divya Murugan' });
    // soft delete: before/after show the isActive flip; a hard delete keeps the whole previous row
    await c.http().delete(`/api/stores/${st.id}`).set(A()).expect(200);
    const del = (await c.http().get('/api/audit-logs?entity=stores&pageSize=5').set(A()).expect(200)).body.items[0];
    expect(JSON.parse(del.details)).toMatchObject({ before: { isActive: true }, after: { isActive: false } });
    const r = (await c.http().post('/api/regions').set(A()).send({ name: 'Temp region' }).expect(201)).body;
    await c.http().delete(`/api/regions/${r.id}`).set(A()).expect(200);
    const rd = JSON.parse((await c.http().get('/api/audit-logs?entity=regions&pageSize=5').set(A()).expect(200)).body.items[0].details);
    expect(rd).toMatchObject({ before: { id: r.id, name: 'Temp region' }, after: null });
  });

  it('F-DETECTIONS summary totals.detections equals the list total (same scope, false positives counted separately)', async () => {
    const ds = c.app.get(DataSource);
    const D = istDate(-1);
    const mk = (storeId: number, cameraId: number, status: string, reviewStatus: string | null) => ds.getRepository(AiDetection).save({ ruleId: null, type: 'MOBILE_USAGE', storeId, cameraId, ts: new Date(Date.now() - 86400_000), date: D, status, reviewStatus });
    await mk(c.seed.stores.tnagar, c.seed.cameras.floor, 'BREACHED', null);
    await mk(c.seed.stores.tnagar, c.seed.cameras.floor, 'BREACHED', 'FALSE_POSITIVE');
    await mk(c.seed.stores.tnagar, c.seed.cameras.floor, 'COMPLIED', null);
    // a detection of a store that is later deactivated still shows in the list — and now in the summary too
    await mk(c.seed.stores.annanagar, c.seed.cameras.entrance2, 'COMPLIED', null);
    await ds.query('UPDATE stores SET isActive = 0 WHERE id = ?', [c.seed.stores.annanagar]);
    try {
      const list = (await c.http().get(`/api/ai-manager/detections?from=${D}&to=${D}`).set(A()).expect(200)).body;
      const sum = (await c.http().get(`/api/ai-manager/summary?from=${D}&to=${D}`).set(A()).expect(200)).body;
      expect(sum.totals).toEqual({ detections: list.total, falsePositives: 1, breached: 1, complied: 2, compliancePct: 66.67 });
      expect(list.total).toBe(4);
    } finally {
      await ds.query('UPDATE stores SET isActive = 1 WHERE id = ?', [c.seed.stores.annanagar]);
    }
  });
});
