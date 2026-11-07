import { JwtService } from '@nestjs/jwt';
import { DataSource } from 'typeorm';
import { AiDetection } from '../src/modules/ai-manager/entities/ai-detection.entity';
import { Alert } from '../src/modules/alerts/entities/alert.entity';
import { bearer, createTestApp, Ctx, istDate } from './helpers';
import { listRoutes } from './routes';

/**
 * QA edge-case plan §4 (RBAC matrix). Every route registered in the Nest router must appear in ROLE_GATE
 * (so a new endpoint cannot ship without an explicit authorization decision), and every route × 6 roles is
 * called: a role outside the gate gets 403, a role inside never gets 401/403/5xx. A second matrix checks
 * store scope (own store vs another store) for single-record and single-store endpoints.
 */
type Who = 'admin' | 'opsadmin' | 'regional' | 'manager' | 'auditor' | 'staff';
const ROLES: Who[] = ['admin', 'opsadmin', 'regional', 'manager', 'auditor', 'staff'];
const ALL = ROLES;
const ADM: Who[] = ['admin', 'opsadmin'];
const MGR: Who[] = ['admin', 'opsadmin', 'regional', 'manager'];
const TPL: Who[] = ['admin', 'opsadmin', 'regional', 'auditor'];
const ASG: Who[] = ['admin', 'opsadmin', 'regional', 'manager', 'auditor'];
const RULEW: Who[] = ['admin', 'opsadmin', 'regional'];
const RECW: Who[] = ['admin', 'opsadmin', 'manager'];

/** 'PUBLIC' = no auth; 'EDGE' = X-Api-Key only (a user JWT gets 401); otherwise the roles that pass the gate. */
const ROLE_GATE: Record<string, Who[] | 'PUBLIC' | 'EDGE'> = {
  'GET /api/health': 'PUBLIC',
  'POST /api/auth/login': 'PUBLIC',
  'GET /api/stream': 'PUBLIC', // authenticates with ?token= itself
  'GET /api/auth/me': ALL,
  'POST /api/auth/change-password': ALL,
  // master data
  'GET /api/users': ALL, 'POST /api/users': ADM, 'GET /api/users/:id': ALL, 'PATCH /api/users/:id': ADM, 'DELETE /api/users/:id': ADM,
  'GET /api/regions': ALL, 'POST /api/regions': ADM, 'PATCH /api/regions/:id': ADM, 'DELETE /api/regions/:id': ADM,
  'GET /api/stores': ALL, 'POST /api/stores': ADM, 'GET /api/stores/:id': ALL, 'PATCH /api/stores/:id': ADM, 'DELETE /api/stores/:id': ADM,
  'GET /api/cameras': ALL, 'POST /api/cameras': ADM, 'GET /api/cameras/:id': ALL, 'PATCH /api/cameras/:id': ADM, 'DELETE /api/cameras/:id': ADM,
  'GET /api/cameras/:id/snapshot': ALL, 'POST /api/cameras/:id/test': RECW,
  'GET /api/zones': ALL, 'POST /api/zones': ADM, 'PATCH /api/zones/:id': ADM, 'DELETE /api/zones/:id': ADM,
  'GET /api/edge-devices': ALL, 'POST /api/edge-devices': ADM, 'DELETE /api/edge-devices/:id': ADM, 'POST /api/edge-devices/:id/rotate-key': ADM,
  'GET /api/staff': ALL, 'POST /api/staff': MGR, 'PATCH /api/staff/:id': MGR, 'DELETE /api/staff/:id': MGR,
  'GET /api/settings': ALL, 'PUT /api/settings': ADM,
  'GET /api/audit-logs': ADM,
  // recorders / probes (contract v3)
  'GET /api/recorders/brands': ALL, 'GET /api/recorders/discovered': ALL, 'GET /api/recorders': ALL, 'POST /api/recorders': RECW,
  'GET /api/recorders/:id': ALL, 'PATCH /api/recorders/:id': RECW, 'DELETE /api/recorders/:id': RECW,
  'POST /api/recorders/:id/generate-cameras': RECW, 'POST /api/recorders/:id/test': RECW,
  'GET /api/probes': ALL, 'GET /api/probes/:id': ALL,
  // edge
  'GET /api/ingest/config': 'EDGE', 'POST /api/ingest/events': 'EDGE', 'POST /api/ingest/queue': 'EDGE', 'POST /api/ingest/heatmap': 'EDGE',
  'POST /api/ingest/heartbeat': 'EDGE', 'POST /api/ingest/storeops': 'EDGE', 'POST /api/ingest/snapshot': 'EDGE', 'POST /api/ingest/detections': 'EDGE',
  'GET /api/ingest/probes': 'EDGE', 'POST /api/ingest/probes/:id': 'EDGE', 'POST /api/ingest/discovered': 'EDGE',
  // POS (JWT STORE_MANAGER+ or X-Api-Key)
  'POST /api/pos/transactions': MGR, 'POST /api/pos/import': MGR, 'GET /api/pos/transactions': ALL,
  // analytics
  'GET /api/analytics/overview': ALL, 'GET /api/analytics/traffic': ALL, 'GET /api/analytics/demographics': ALL, 'GET /api/analytics/zones': ALL,
  'GET /api/analytics/heatmap': ALL, 'GET /api/analytics/journey': ALL, 'GET /api/analytics/traffic-density': ALL, 'GET /api/analytics/benchmark': ALL,
  'GET /api/analytics/benchmark/groups': ALL, 'GET /api/analytics/conversion': ALL, 'GET /api/analytics/queue': ALL, 'GET /api/analytics/storeops': ALL,
  'GET /api/analytics/live': ALL, 'GET /api/infra/health': ALL,
  // alerts / notifications
  'GET /api/alert-rules': ALL, 'POST /api/alert-rules': ADM, 'PATCH /api/alert-rules/:id': ADM, 'DELETE /api/alert-rules/:id': ADM,
  'GET /api/alerts': ALL, 'PATCH /api/alerts/:id/ack': ALL, 'PATCH /api/alerts/:id/resolve': ALL, 'POST /api/alerts/:id/ticket': ALL, 'POST /api/alerts/evaluate': ADM,
  'GET /api/notifications': ALL, 'PATCH /api/notifications/:id/read': ALL, 'POST /api/notifications/read-all': ALL,
  // AI Manager
  'GET /api/ai-manager/rules': ALL, 'POST /api/ai-manager/rules': RULEW, 'PATCH /api/ai-manager/rules/:id': RULEW, 'DELETE /api/ai-manager/rules/:id': RULEW,
  'GET /api/ai-manager/detections': ALL, 'PATCH /api/ai-manager/detections/:id/review': MGR, 'GET /api/ai-manager/summary': ALL, 'GET /api/ai-manager/open-close': ALL,
  // media
  'GET /api/image-directory': ALL, 'GET /api/recaps': ALL, 'POST /api/recaps/generate': MGR, 'GET /api/recaps/:id': ALL, 'POST /api/uploads': ALL,
  // Trax checklists
  'GET /api/checklists/templates': ALL, 'POST /api/checklists/templates': TPL, 'GET /api/checklists/templates/:id': ALL,
  'PUT /api/checklists/templates/:id': TPL, 'DELETE /api/checklists/templates/:id': TPL,
  'GET /api/checklists/assignments': ALL, 'POST /api/checklists/assignments': ASG, 'GET /api/checklists/assignments/:id': ALL, 'POST /api/checklists/assignments/:id/draft': ALL,
  'GET /api/checklists/submissions': ALL, 'POST /api/checklists/submissions': ALL, 'GET /api/checklists/submissions/:id': ALL, 'PATCH /api/checklists/submissions/:id/review': ASG,
  'GET /api/checklists/compliance': ALL, 'GET /api/checklists/dashboard': ALL,
  'GET /api/checklists/schedules': ALL, 'POST /api/checklists/schedules': ASG, 'PATCH /api/checklists/schedules/:id': ASG, 'DELETE /api/checklists/schedules/:id': ASG,
  'POST /api/checklists/schedules/:id/generate': ASG, 'POST /api/checklists/nudges/run': ADM, 'POST /api/checklists/answers/:answerId/task': ASG, 'POST /api/checklists/ai-check': ALL,
  // tasks / tickets / documents / vendors / reports
  'GET /api/tasks': ALL, 'POST /api/tasks': MGR, 'GET /api/tasks/:id': ALL, 'PATCH /api/tasks/:id': ALL, 'DELETE /api/tasks/:id': MGR,
  'PATCH /api/tasks/:id/status': ALL, 'PATCH /api/tasks/:id/verify': MGR, 'POST /api/tasks/bulk': MGR,
  'GET /api/tickets': ALL, 'POST /api/tickets': ALL, 'GET /api/tickets/:id': ALL, 'PATCH /api/tickets/:id': ALL, 'PATCH /api/tickets/:id/status': ALL, 'POST /api/tickets/:id/comments': ALL,
  'GET /api/documents': ALL, 'POST /api/documents': MGR, 'GET /api/documents/:id/download': ALL, 'DELETE /api/documents/:id': MGR,
  'GET /api/vendors': ALL, 'POST /api/vendors': MGR, 'PATCH /api/vendors/:id': MGR, 'DELETE /api/vendors/:id': MGR,
  'GET /api/vendor-visits': ALL, 'POST /api/vendor-visits': MGR, 'PATCH /api/vendor-visits/:id': MGR,
  'PATCH /api/vendor-visits/:id/check-in': MGR, 'PATCH /api/vendor-visits/:id/check-out': MGR,
  'GET /api/reports/export': ALL, 'GET /api/reports/schedules': ALL, 'POST /api/reports/schedules': MGR, 'PATCH /api/reports/schedules/:id': MGR,
  'DELETE /api/reports/schedules/:id': MGR, 'POST /api/reports/schedules/:id/run': MGR,
};

/** Routes whose "allowed" call must not be made for real by every role in turn (state-changing on the caller). */
const SKIP_CALL = new Set(['POST /api/auth/change-password', 'GET /api/stream']);
/** Query strings that make a GET valid (otherwise allowed roles may legitimately get 400). */
const QUERY: Record<string, string> = {
  'GET /api/reports/export': '?type=traffic&format=csv',
};

describe('QA §4 RBAC matrix (every route × 6 roles × own/other store)', () => {
  let c: Ctx;
  const tokens = {} as Record<Who, string>;
  const MISSING = 999999;

  beforeAll(async () => {
    c = await createTestApp();
    Object.assign(tokens, c.tokens);
    await c.http().post('/api/users').set(bearer(c.tokens.admin)).send({ email: 'ops.admin@congruence.in', name: 'Ops Admin', role: 'ADMIN', password: 'Password@123' }).expect(201);
    tokens.opsadmin = (await c.http().post('/api/auth/login').send({ email: 'ops.admin@congruence.in', password: 'Password@123' }).expect(200)).body.accessToken;
  });
  afterAll(async () => c.app.close());

  it('every registered route has an explicit authorization decision (and no stale entries)', () => {
    const actual = listRoutes(c.app).map((r) => `${r.method} ${r.path}`);
    expect(actual.filter((k) => !(k in ROLE_GATE))).toEqual([]);
    expect(Object.keys(ROLE_GATE).filter((k) => !actual.includes(k))).toEqual([]);
  });

  it('role gate: denied roles get 403, allowed roles pass (never 401/403/5xx); no token → 401', async () => {
    const failures: string[] = [];
    for (const r of listRoutes(c.app)) {
      const key = `${r.method} ${r.path}`;
      const gate = ROLE_GATE[key];
      if (!gate || SKIP_CALL.has(key)) continue;
      const path = r.path.replace(/:(id|answerId)/g, String(MISSING)) + (QUERY[key] ?? '');
      const call = (t?: string) => {
        const req = c.http()[r.method.toLowerCase() as 'get' | 'post' | 'put' | 'patch' | 'delete'](path);
        if (t) req.set(bearer(t));
        return ['POST', 'PUT', 'PATCH'].includes(r.method) ? req.send({}) : req;
      };
      if (gate === 'PUBLIC') continue;
      const anon = await call();
      if (anon.status !== 401) failures.push(`${key} without token → ${anon.status} (want 401)`);
      if (gate === 'EDGE') {
        const res = await call(tokens.admin);
        if (res.status !== 401) failures.push(`${key} with a user JWT → ${res.status} (want 401)`);
        continue;
      }
      for (const who of ROLES) {
        const res = await call(tokens[who]);
        const allowed = gate.includes(who);
        // an unknown id outside the caller's stores is answered "outside your scope" (no existence oracle) —
        // that is the scope check, which runs after the role gate passed
        const scopeDenial = res.status === 403 && /outside your scope/.test(String(res.body?.message));
        if (!allowed && (res.status !== 403 || scopeDenial)) failures.push(`${key} as ${who} → ${res.status} (want 403)`);
        if (allowed && !scopeDenial && (res.status === 401 || res.status === 403 || res.status >= 500)) failures.push(`${key} as ${who} → ${res.status} ${JSON.stringify(res.body).slice(0, 120)} (want allowed)`);
      }
    }
    expect(failures).toEqual([]);
  }, 120000);

  describe('store scope: own store vs another store', () => {
    // fixtures in T Nagar (own store of manager/staff/regional) and Coimbatore (outside their scope)
    const fx: Record<'own' | 'other', Record<string, number>> = { own: {}, other: {} };
    const pdf = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n');

    beforeAll(async () => {
      const A = (m: 'post' | 'patch', p: string, b: object) => c.http()[m](p).set(bearer(c.tokens.admin)).send(b);
      const ds = c.app.get(DataSource);
      const s = { own: c.seed.stores.tnagar, other: c.seed.stores.coimbatore };
      const tpl = (await A('post', '/api/checklists/templates', { name: 'Scope audit', category: 'AUDIT', frequency: 'ADHOC', questions: [{ text: 'Clean?', type: 'YES_NO' }] }).expect(201)).body;
      for (const k of ['own', 'other'] as const) {
        const storeId = s[k];
        fx[k].store = storeId;
        fx[k].camera = (await A('post', '/api/cameras', { storeId, name: `Scope cam ${k}`, type: 'ZONE', rtspUrl: 'rtsp://10.9.9.9/x' }).expect(201)).body.id;
        fx[k].task = (await A('post', '/api/tasks', { storeId, title: `Task ${k}` }).expect(201)).body.id;
        fx[k].ticket = (await A('post', '/api/tickets', { storeId, title: `Ticket ${k}`, category: 'OTHER', priority: 'LOW' }).expect(201)).body.id;
        fx[k].assignment = (await A('post', '/api/checklists/assignments', { templateId: tpl.id, storeId, assigneeId: c.seed.users.get('admin@congruence.in'), dueDate: istDate(1) }).expect(201)).body.id;
        fx[k].submission = (await A('post', '/api/checklists/submissions', { templateId: tpl.id, storeId, answers: [{ questionId: tpl.questions[0].id, value: 'YES' }] }).expect(201)).body.id;
        fx[k].document = (await c.http().post('/api/documents').set(bearer(c.tokens.admin)).field('title', `Doc ${k}`).field('category', 'SOP').field('storeId', String(storeId)).attach('file', pdf, { filename: 'sop.pdf', contentType: 'application/pdf' }).expect(201)).body.id;
        fx[k].recorder = (await A('post', '/api/recorders', { storeId, name: `DVR ${k}`, kind: 'DVR', brand: 'HIKVISION', host: `10.0.${storeId}.20`, rtspPort: 554, httpPort: 80, username: 'admin', password: 'x', channels: 4, stream: 'MAIN' }).expect(201)).body.id;
        fx[k].probe = (await A('post', `/api/recorders/${fx[k].recorder}/test`, { channels: [1] }).expect(201)).body[0].id;
        fx[k].alert = (await ds.getRepository(Alert).save({ ruleId: null, ruleName: 'Scope', storeId, metric: 'QUEUE_LENGTH', severity: 'LOW', message: 'm', value: 1, status: 'OPEN' })).id;
        fx[k].detection = (await ds.getRepository(AiDetection).save({ ruleId: null, type: 'MOBILE_USAGE', storeId, cameraId: fx[k].camera, ts: new Date(), date: istDate(0), status: 'BREACHED' })).id;
      }
    });

    type Case = { name: string; roles?: Who[]; call: (f: Record<string, number>, t: string) => PromiseLike<{ status: number }>; ok: number[]; otherScoped?: number[] };
    const cases: Case[] = [
      { name: 'GET store', call: (f, t) => c.http().get(`/api/stores/${f.store}`).set(bearer(t)), ok: [200] },
      { name: 'GET camera', call: (f, t) => c.http().get(`/api/cameras/${f.camera}`).set(bearer(t)), ok: [200] },
      { name: 'GET camera snapshot', call: (f, t) => c.http().get(`/api/cameras/${f.camera}/snapshot`).set(bearer(t)), ok: [204] },
      { name: 'GET live', call: (f, t) => c.http().get(`/api/analytics/live?storeId=${f.store}`).set(bearer(t)), ok: [200] },
      { name: 'GET journey', call: (f, t) => c.http().get(`/api/analytics/journey?storeId=${f.store}`).set(bearer(t)), ok: [200] },
      { name: 'GET heatmap by camera', call: (f, t) => c.http().get(`/api/analytics/heatmap?cameraId=${f.camera}`).set(bearer(t)), ok: [200] },
      { name: 'GET task', call: (f, t) => c.http().get(`/api/tasks/${f.task}`).set(bearer(t)), ok: [200] },
      { name: 'POST task', roles: MGR, call: (f, t) => c.http().post('/api/tasks').set(bearer(t)).send({ storeId: f.store, title: 'x' }), ok: [201] },
      { name: 'GET ticket', call: (f, t) => c.http().get(`/api/tickets/${f.ticket}`).set(bearer(t)), ok: [200] },
      { name: 'POST ticket', call: (f, t) => c.http().post('/api/tickets').set(bearer(t)).send({ storeId: f.store, title: 'x', category: 'OTHER', priority: 'LOW' }), ok: [201] },
      { name: 'comment ticket', call: (f, t) => c.http().post(`/api/tickets/${f.ticket}/comments`).set(bearer(t)).send({ body: 'hi' }), ok: [201] },
      { name: 'GET assignment', call: (f, t) => c.http().get(`/api/checklists/assignments/${f.assignment}`).set(bearer(t)), ok: [200] },
      { name: 'GET submission', call: (f, t) => c.http().get(`/api/checklists/submissions/${f.submission}`).set(bearer(t)), ok: [200] },
      { name: 'download document', call: (f, t) => c.http().get(`/api/documents/${f.document}/download`).set(bearer(t)), ok: [200] },
      { name: 'GET recorder', call: (f, t) => c.http().get(`/api/recorders/${f.recorder}`).set(bearer(t)), ok: [200] },
      { name: 'PATCH recorder', roles: RECW, call: (f, t) => c.http().patch(`/api/recorders/${f.recorder}`).set(bearer(t)).send({ name: `DVR renamed` }), ok: [200] },
      { name: 'GET probe', call: (f, t) => c.http().get(`/api/probes/${f.probe}`).set(bearer(t)), ok: [200] },
      { name: 'ack alert', call: (f, t) => c.http().patch(`/api/alerts/${f.alert}/ack`).set(bearer(t)), ok: [200] },
      { name: 'review detection', roles: MGR, call: (f, t) => c.http().patch(`/api/ai-manager/detections/${f.detection}/review`).set(bearer(t)).send({ reviewStatus: 'VALID' }), ok: [200] },
      { name: 'generate recap', roles: MGR, call: (f, t) => c.http().post('/api/recaps/generate').set(bearer(t)).send({ storeId: f.store, date: istDate(-1) }), ok: [422] },
      // list endpoints silently filter out-of-scope stores (200, nothing from the other store)
      { name: 'overview other store', call: (f, t) => c.http().get(`/api/analytics/overview?storeIds=${f.store}`).set(bearer(t)), ok: [200], otherScoped: [200] },
      { name: 'zones list', call: (f, t) => c.http().get(`/api/zones?storeId=${f.store}`).set(bearer(t)), ok: [200], otherScoped: [200] },
    ];
    const scoped: Who[] = ['regional', 'manager', 'staff'];

    it.each(cases.map((x) => [x.name, x] as const))('%s', async (_n, cse) => {
      const failures: string[] = [];
      for (const who of ROLES) {
        for (const where of ['own', 'other'] as const) {
          const res = await cse.call(fx[where], tokens[who]);
          let want: number[];
          if (cse.roles && !cse.roles.includes(who)) want = [403];
          else if (where === 'other' && scoped.includes(who)) want = cse.otherScoped ?? [403];
          else want = cse.ok;
          if (!want.includes(res.status)) failures.push(`${who} @ ${where} → ${res.status} (want ${want.join('/')})`);
        }
      }
      expect(failures).toEqual([]);
    });

    it('a scoped list never leaks another store (overview for the other store is empty for scoped roles)', async () => {
      const r = await c.http().get(`/api/tasks?storeIds=${fx.other.store}`).set(bearer(tokens.manager)).expect(200);
      expect(r.body).toEqual([]);
      const t = await c.http().get('/api/tickets').set(bearer(tokens.staff)).expect(200);
      expect(t.body.every((x: { storeId: number }) => x.storeId === fx.own.store)).toBe(true);
      const d = await c.http().get('/api/ai-manager/detections').set(bearer(tokens.regional)).expect(200);
      expect(d.body.items.every((x: { storeId: number }) => x.storeId !== fx.other.store)).toBe(true);
    });
  });

  describe('token edge cases', () => {
    it('deactivated user: existing token rejected (401), login refused', async () => {
      const u = (await c.http().post('/api/users').set(bearer(c.tokens.admin)).send({ email: 'temp.staff@congruence.in', name: 'Temp', role: 'STAFF', password: 'Password@123', storeIds: [c.seed.stores.tnagar] }).expect(201)).body;
      const tok = (await c.http().post('/api/auth/login').send({ email: 'temp.staff@congruence.in', password: 'Password@123' }).expect(200)).body.accessToken;
      await c.http().get('/api/auth/me').set(bearer(tok)).expect(200);
      await c.http().delete(`/api/users/${u.id}`).set(bearer(c.tokens.admin)).expect(200);
      await c.http().get('/api/auth/me').set(bearer(tok)).expect(401);
      await c.http().get('/api/tasks').set(bearer(tok)).expect(401);
      await c.http().post('/api/auth/login').send({ email: 'temp.staff@congruence.in', password: 'Password@123' }).expect(401);
    });

    it('expired, tampered, wrongly signed and alg=none tokens are rejected (401)', async () => {
      const jwt = c.app.get(JwtService);
      const adminId = c.seed.users.get('admin@congruence.in');
      const expired = await jwt.signAsync({ sub: adminId, email: 'admin@congruence.in', role: 'SUPER_ADMIN' }, { expiresIn: -10 });
      await c.http().get('/api/auth/me').set(bearer(expired)).expect(401);
      const [h, p, s] = c.tokens.staff.split('.');
      const claims = JSON.parse(Buffer.from(p, 'base64url').toString());
      const forged = `${h}.${Buffer.from(JSON.stringify({ ...claims, sub: adminId, role: 'SUPER_ADMIN' })).toString('base64url')}.${s}`;
      await c.http().get('/api/auth/me').set(bearer(forged)).expect(401);
      const otherKey = new JwtService({ secret: 'not-the-server-secret' });
      await c.http().get('/api/auth/me').set(bearer(await otherKey.signAsync({ sub: adminId, role: 'SUPER_ADMIN' }))).expect(401);
      const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: adminId, role: 'SUPER_ADMIN' })).toString('base64url')}.`;
      await c.http().get('/api/auth/me').set(bearer(none)).expect(401);
      await c.http().get('/api/auth/me').set('Authorization', 'Basic YWRtaW46eA==').expect(401);
      await c.http().get('/api/auth/me').set('Authorization', 'Bearer ').expect(401);
    });

    it('role comes from the database, not the token: a demoted admin loses admin routes immediately', async () => {
      const u = (await c.http().post('/api/users').set(bearer(c.tokens.admin)).send({ email: 'temp.admin@congruence.in', name: 'Temp admin', role: 'ADMIN', password: 'Password@123' }).expect(201)).body;
      const tok = (await c.http().post('/api/auth/login').send({ email: 'temp.admin@congruence.in', password: 'Password@123' }).expect(200)).body.accessToken;
      await c.http().get('/api/audit-logs').set(bearer(tok)).expect(200);
      await c.http().patch(`/api/users/${u.id}`).set(bearer(c.tokens.admin)).send({ role: 'STAFF', storeIds: [c.seed.stores.tnagar] }).expect(200);
      await c.http().get('/api/audit-logs').set(bearer(tok)).expect(403);
      await c.http().get(`/api/stores/${c.seed.stores.coimbatore}`).set(bearer(tok)).expect(403);
    });

    it('edge API key of one store cannot read or write another store; revoked key is rejected', async () => {
      const k = c.seed.keys.annanagar;
      const cfg = await c.http().get('/api/ingest/config').set('X-Api-Key', k).expect(200);
      expect(cfg.body.store.id).toBe(c.seed.stores.annanagar);
      await c.http().post('/api/ingest/events').set('X-Api-Key', k).send({ events: [{ cameraId: c.seed.cameras.entrance, type: 'ENTRY', ts: new Date().toISOString(), trackId: 't', visitorId: 'v' }] }).expect(403);
      const dev = (await c.http().post('/api/edge-devices').set(bearer(c.tokens.admin)).send({ storeId: c.seed.stores.coimbatore, name: 'Temp edge' }).expect(201)).body;
      await c.http().get('/api/ingest/config').set('X-Api-Key', dev.apiKey).expect(200);
      const rotated = (await c.http().post(`/api/edge-devices/${dev.id}/rotate-key`).set(bearer(c.tokens.admin)).expect(200)).body;
      await c.http().get('/api/ingest/config').set('X-Api-Key', dev.apiKey).expect(401);
      await c.http().get('/api/ingest/config').set('X-Api-Key', rotated.apiKey).expect(200);
      await c.http().delete(`/api/edge-devices/${dev.id}`).set(bearer(c.tokens.admin)).expect(200);
      await c.http().get('/api/ingest/config').set('X-Api-Key', rotated.apiKey).expect(401);
    });
  });
});
