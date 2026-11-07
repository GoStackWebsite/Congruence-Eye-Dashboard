import { EventBusService, BusEvent } from '../src/common/event-bus.service';
import { bearer, createTestApp, Ctx } from './helpers';

describe('Alerts, notifications, alert → ticket', () => {
  let c: Ctx;
  let ruleId: number;
  const events: BusEvent[] = [];
  beforeAll(async () => {
    c = await createTestApp();
    c.app.get(EventBusService).events$.subscribe((e) => events.push(e));
  });
  afterAll(async () => c.app.close());
  const adm = () => bearer(c.tokens.admin);

  it('alert rule CRUD (ADMIN+ writes)', async () => {
    await c.http().post('/api/alert-rules').set(bearer(c.tokens.manager)).send({ name: 'x', metric: 'QUEUE_LENGTH', threshold: 1, severity: 'LOW', channels: ['IN_APP'] }).expect(403);
    await c.http().post('/api/alert-rules').set(adm()).send({ name: 'x', metric: 'NOPE', threshold: 1, severity: 'LOW', channels: ['IN_APP'] }).expect(400);
    const r = await c.http().post('/api/alert-rules').set(adm()).send({ name: 'Queue too long', storeId: c.seed.stores.tnagar, metric: 'QUEUE_LENGTH', threshold: 6, severity: 'HIGH', channels: ['IN_APP'], cooldownMin: 30 }).expect(201);
    ruleId = r.body.id;
    expect(r.body).toEqual({ id: ruleId, name: 'Queue too long', storeId: c.seed.stores.tnagar, metric: 'QUEUE_LENGTH', threshold: 6, severity: 'HIGH', channels: ['IN_APP'], emails: null, webhookUrl: null, cooldownMin: 30, autoTicket: false, isActive: true });
    const p = await c.http().patch(`/api/alert-rules/${ruleId}`).set(adm()).send({ severity: 'CRITICAL' }).expect(200);
    expect(p.body.severity).toBe('CRITICAL');
    await c.http().patch(`/api/alert-rules/${ruleId}`).set(adm()).send({ severity: 'HIGH' }).expect(200);
    const list = await c.http().get('/api/alert-rules').set(bearer(c.tokens.manager)).expect(200);
    expect(list.body).toHaveLength(1);
  });

  it('queue snapshot above threshold fires the rule on ingest', async () => {
    const now = new Date().toISOString();
    const z = c.seed.zones.queue1;
    await c.http().post('/api/ingest/queue').set('X-Api-Key', c.seed.keys.tnagar).send({ snapshots: [{ zoneId: z, ts: now, queueLength: 5, avgWaitSec: 100, counterStaffed: true }] }).expect(200);
    let a = await c.http().get('/api/alerts').set(adm()).expect(200);
    expect(a.body.total).toBe(0);
    await c.http().post('/api/ingest/queue').set('X-Api-Key', c.seed.keys.tnagar).send({ snapshots: [{ zoneId: z, ts: new Date().toISOString(), queueLength: 9, avgWaitSec: 200, counterStaffed: true }] }).expect(200);
    a = await c.http().get('/api/alerts?status=OPEN').set(adm()).expect(200);
    expect(a.body.total).toBe(1);
    expect(a.body.items[0]).toMatchObject({ ruleId, ruleName: 'Queue too long', storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', metric: 'QUEUE_LENGTH', severity: 'HIGH', value: 9, status: 'OPEN', acknowledgedAt: null, acknowledgedByName: null, resolvedAt: null, ticketId: null });
    expect(a.body.items[0].message).toContain('Billing Counter 1');
    expect(events.some((e) => e.type === 'alert' && e.storeId === c.seed.stores.tnagar)).toBe(true);
    expect(events.some((e) => e.type === 'live')).toBe(true);
    // cooldown: a second breach does not create another alert
    await c.http().post('/api/ingest/queue').set('X-Api-Key', c.seed.keys.tnagar).send({ snapshots: [{ zoneId: z, ts: new Date().toISOString(), queueLength: 12, avgWaitSec: 200, counterStaffed: true }] }).expect(200);
    const ev = await c.http().post('/api/alerts/evaluate').set(adm()).expect(200);
    expect(ev.body).toEqual({ created: 0 });
    expect((await c.http().get('/api/alerts').set(adm()).expect(200)).body.total).toBe(1);
  });

  it('notifications go to admins + managers of the store, not staff/other stores', async () => {
    const m = await c.http().get('/api/notifications').set(bearer(c.tokens.manager)).expect(200);
    expect(m.body).toHaveLength(1);
    expect(m.body[0]).toMatchObject({ title: '[HIGH] Queue too long', isRead: false, link: expect.stringContaining('/alerts/') });
    expect((await c.http().get('/api/notifications').set(adm()).expect(200)).body).toHaveLength(1);
    expect((await c.http().get('/api/notifications').set(bearer(c.tokens.regional)).expect(200)).body).toHaveLength(1);
    expect((await c.http().get('/api/notifications').set(bearer(c.tokens.staff)).expect(200)).body).toHaveLength(0);
    expect(events.filter((e) => e.type === 'notification').length).toBe(3);
    const read = await c.http().patch(`/api/notifications/${m.body[0].id}/read`).set(bearer(c.tokens.manager)).expect(200);
    expect(read.body.isRead).toBe(true);
    await c.http().patch(`/api/notifications/${m.body[0].id}/read`).set(bearer(c.tokens.staff)).expect(404);
    await c.http().post('/api/notifications/read-all').set(adm()).expect(200);
    expect((await c.http().get('/api/notifications').set(adm()).expect(200)).body[0].isRead).toBe(true);
  });

  it('ack, ticket, resolve', async () => {
    const a = (await c.http().get('/api/alerts').set(adm()).expect(200)).body.items[0];
    await c.http().patch(`/api/alerts/${a.id}/ack`).set(bearer(c.tokens.staff)).expect(200);
    const acked = (await c.http().get('/api/alerts').set(adm())).body.items[0];
    expect(acked).toMatchObject({ status: 'ACKNOWLEDGED', acknowledgedByName: 'Divya Murugan' });
    const t = await c.http().post(`/api/alerts/${a.id}/ticket`).set(bearer(c.tokens.manager)).expect(201);
    expect(t.body).toMatchObject({ alertId: a.id, storeId: c.seed.stores.tnagar, status: 'OPEN', priority: 'HIGH', number: expect.stringMatching(/^TKT-\d{5}$/), reporterName: 'Karthik Subramanian' });
    const again = await c.http().post(`/api/alerts/${a.id}/ticket`).set(bearer(c.tokens.manager)).expect(201);
    expect(again.body.id).toBe(t.body.id);
    const res = await c.http().patch(`/api/alerts/${a.id}/resolve`).set(bearer(c.tokens.manager)).expect(200);
    expect(res.body).toMatchObject({ status: 'RESOLVED', ticketId: t.body.id });
    expect(res.body.resolvedAt).toBeTruthy();
    const filtered = await c.http().get('/api/alerts?status=RESOLVED&severity=HIGH&page=1&pageSize=10').set(adm()).expect(200);
    expect(filtered.body).toMatchObject({ total: 1, page: 1, pageSize: 10 });
    const other = await c.http().get(`/api/alerts?storeIds=${c.seed.stores.annanagar}`).set(adm()).expect(200);
    expect(other.body.total).toBe(0);
  });

  it('manager cannot touch alerts of other stores; overview counts open alerts', async () => {
    const rule = await c.http().post('/api/alert-rules').set(adm()).send({ name: 'Counter unattended', metric: 'COUNTER_UNATTENDED', threshold: 1, severity: 'MEDIUM', channels: ['IN_APP', 'EMAIL', 'WEBHOOK'], webhookUrl: 'http://127.0.0.1:9/hook', cooldownMin: 10 }).expect(201);
    await c.http().post('/api/ingest/storeops').set('X-Api-Key', c.seed.keys.annanagar).send({ events: [{ type: 'COUNTER_UNATTENDED', ts: new Date().toISOString() }] }).expect(200);
    const a = await c.http().get(`/api/alerts?storeIds=${c.seed.stores.annanagar}`).set(adm()).expect(200);
    expect(a.body.items[0]).toMatchObject({ metric: 'COUNTER_UNATTENDED', value: 1, status: 'OPEN', ruleId: rule.body.id });
    await c.http().patch(`/api/alerts/${a.body.items[0].id}/ack`).set(bearer(c.tokens.manager)).expect(403);
    const mgr = await c.http().get('/api/alerts').set(bearer(c.tokens.manager)).expect(200);
    expect(mgr.body.items.every((x: { storeId: number }) => x.storeId === c.seed.stores.tnagar)).toBe(true);
    const ov = await c.http().get(`/api/analytics/overview?storeIds=${c.seed.stores.annanagar}`).set(adm()).expect(200);
    expect(ov.body.kpis.openAlerts.value).toBe(1);
    await c.http().delete(`/api/alert-rules/${rule.body.id}`).set(adm()).expect(200);
    const after = await c.http().get(`/api/alerts?storeIds=${c.seed.stores.annanagar}`).set(adm()).expect(200);
    expect(after.body.items[0].ruleId).toBeNull();
  });

  it('camera offline rule', async () => {
    const r = await c.http().post('/api/alert-rules').set(adm()).send({ name: 'Camera offline', metric: 'CAMERA_OFFLINE', threshold: 10, severity: 'CRITICAL', channels: ['IN_APP'] }).expect(201);
    await c.http().post('/api/ingest/heartbeat').set('X-Api-Key', c.seed.keys.tnagar).send({ cameras: [{ cameraId: c.seed.cameras.floor, status: 'OFFLINE' }] }).expect(200);
    // just went offline: below the 10 minute threshold
    expect((await c.http().post('/api/alerts/evaluate').set(adm()).expect(200)).body.created).toBe(0);
    // backdate the offline interval by 15 minutes
    await c.ds.query(`UPDATE camera_status_log SET startedAt = ? WHERE cameraId = ? AND endedAt IS NULL`, [new Date(Date.now() - 15 * 60000).toISOString().replace('T', ' ').replace('Z', ''), c.seed.cameras.floor]);
    expect((await c.http().post('/api/alerts/evaluate').set(adm()).expect(200)).body.created).toBe(1);
    const a = await c.http().get('/api/alerts?severity=CRITICAL').set(adm()).expect(200);
    expect(a.body.items[0]).toMatchObject({ metric: 'CAMERA_OFFLINE', ruleId: r.body.id, value: 15 });
    expect(a.body.items[0].message).toContain('Floor 1');
  });

  it('SSE stream requires a valid token', async () => {
    await c.http().get('/api/stream').expect(401);
    await c.http().get('/api/stream?token=bad').expect(401);
  });

  it('SSE stream delivers scoped live events', async () => {
    const server = c.app.getHttpServer();
    await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const ac = new AbortController();
    const res = await fetch(`http://127.0.0.1:${port}/api/stream?token=${c.tokens.manager}`, { signal: ac.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/event-stream');
    const reader = res.body!.getReader();
    const bus = c.app.get(EventBusService);
    setTimeout(() => {
      bus.emit({ type: 'live', storeId: c.seed.stores.annanagar, data: { storeId: c.seed.stores.annanagar } }); // out of scope
      bus.emit({ type: 'live', storeId: c.seed.stores.tnagar, data: { storeId: c.seed.stores.tnagar } });
    }, 50);
    let text = '';
    while (!text.includes('\n\n')) text += new TextDecoder().decode((await reader.read()).value);
    ac.abort();
    expect(text).toContain('event: live');
    expect(text).toContain(`"storeId":${c.seed.stores.tnagar}`);
    expect(text).not.toContain(`"storeId":${c.seed.stores.annanagar}`);
  });

  it('SSE stream: STAFF receive no alert events (alerts / AI Manager breaches are manager-only)', async () => {
    const server = c.app.getHttpServer();
    if (!server.listening) await new Promise<void>((r) => server.listen(0, r));
    const port = (server.address() as { port: number }).port;
    const read = async (token: string) => {
      const ac = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/api/stream?token=${token}`, { signal: ac.signal });
      const reader = res.body!.getReader();
      return { ac, reader };
    };
    const staff = await read(c.tokens.staff);
    const mgr = await read(c.tokens.manager);
    const bus = c.app.get(EventBusService);
    setTimeout(() => {
      bus.emit({ type: 'alert', storeId: c.seed.stores.tnagar, data: { id: 999, metric: 'AI_MANAGER_BREACH' } });
      bus.emit({ type: 'live', storeId: c.seed.stores.tnagar, data: { storeId: c.seed.stores.tnagar } });
    }, 50);
    const until = async (r: ReadableStreamDefaultReader<Uint8Array>, marker: string) => {
      let text = '';
      while (!text.includes(marker)) text += new TextDecoder().decode((await r.read()).value);
      return text;
    };
    const staffText = await until(staff.reader, 'event: live');
    const mgrText = await until(mgr.reader, 'event: live');
    staff.ac.abort();
    mgr.ac.abort();
    expect(staffText).not.toContain('event: alert');
    expect(mgrText).toContain('event: alert');
  });
});
