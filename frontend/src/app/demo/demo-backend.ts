/* eslint-disable @typescript-eslint/no-explicit-any */
import { Question } from '../core/models/api.models';
import { parseMulti, scoreAnswer } from '../core/utils/checklist-score';
import { DemoDb, nextId } from './demo-db';
import { PresetKey, inDateRange, makeDemoToken, paginate, parseIds, presetFor, readDemoToken, scopeKey, toCsvText } from './demo-utils';

type Any = any;
export const DEMO_PASSWORD = 'Password@123';

export interface DemoRequest {
  method: string;
  /** path after /api, e.g. "/tasks/3/status" */
  path: string;
  params: URLSearchParams;
  body: unknown;
  auth: string | null;
}

export interface DemoResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export class DemoError extends Error {
  constructor(
    readonly status: number,
    message: string,
    /** Extra error-body fields (contract v4: missingQuestionIds, invalidAnswers). */
    readonly extra?: Record<string, unknown>,
  ) {
    super(message);
  }
}

const ok = (body: unknown, headers?: Record<string, string>): DemoResponse => ({ status: 200, body, headers });
const created = (body: unknown): DemoResponse => ({ status: 201, body });
const fail = (status: number, message: string): never => {
  throw new DemoError(status, message);
};
const nowIso = () => new Date().toISOString();
/** Identity of an uploaded file across FormData copies (FormData re-wraps File objects). */
const fileKey = (f: File) => `${f.name}|${f.size}|${f.lastModified ?? 0}`;
const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const SM_PLUS = ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER'];
/** Contract v4: every upload endpoint accepts up to 50 MB. */
const MAX_UPLOAD = 50 * 1024 * 1024;
const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

type Handler = (req: DemoRequest, m: string[], user: Any) => Promise<DemoResponse> | DemoResponse;
interface Route {
  method: string;
  re: RegExp;
  public?: boolean;
  fn: Handler;
}

/**
 * Audit `details` as the real interceptor writes them (contract v4): the request plus `before` / `after` holding
 * only the fields that changed.
 */
export function auditDetails(method: string, path: string, body: Record<string, any>, before: Record<string, any> | null, after: Record<string, any> | null): Any {
  const out: Any = { method, path, body };
  if (!before || !after) return out;
  const b: Record<string, unknown> = {};
  const a: Record<string, unknown> = {};
  for (const k of Object.keys(body)) {
    if (k === 'password') continue;
    if (JSON.stringify(before[k]) !== JSON.stringify(after[k])) {
      b[k] = before[k] ?? null;
      a[k] = after[k] ?? null;
    }
  }
  return { ...out, before: b, after: a };
}

/** Turns the request body (JSON object or FormData) into a plain record. */
function bodyOf(req: DemoRequest): Record<string, any> {
  const b = req.body;
  if (b instanceof FormData) {
    const o: Record<string, any> = {};
    b.forEach((v, k) => (o[k] = v));
    return o;
  }
  return (b && typeof b === 'object' ? b : {}) as Record<string, any>;
}

/**
 * In-browser implementation of docs/API_CONTRACT.md + V2 for the online demo.
 * Reads come from captured responses (date-shifted); writes mutate in-memory collections.
 */
export class DemoBackend {
  private routes: Route[] = [];

  constructor(readonly db: DemoDb) {
    this.register();
  }

  // ---------------------------------------------------------------- dispatch
  async handle(req: DemoRequest): Promise<DemoResponse> {
    await this.db.init();
    for (const r of this.routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(req.path);
      if (!m) continue;
      const user = r.public ? null : this.currentUser(req);
      const res = await r.fn(req, m, user);
      return { ...res, body: await this.db.rewriteMedia(res.body) };
    }
    return fail(404, `Cannot ${req.method} /api${req.path} (not available in the online demo)`);
  }

  private currentUser(req: DemoRequest): Any {
    const id = readDemoToken(req.auth);
    const u = id !== null ? this.db.master.users.find((x: Any) => x.id === id) : null;
    if (!u || u.isActive === false) fail(401, 'Unauthorized');
    return u;
  }

  private on(method: string, pattern: string, fn: Handler, isPublic = false) {
    const re = new RegExp('^' + pattern.replace(/:\w+/g, '([^/]+)') + '/?$');
    this.routes.push({ method, re, fn, public: isPublic });
  }

  // ---------------------------------------------------------------- scope helpers
  private isAdmin(u: Any) {
    return ADMINS.includes(u?.role);
  }
  private scope(u: Any): number[] {
    return this.isAdmin(u) ? this.db.meta.storeIds : (u.storeIds ?? []);
  }
  /** Store ids requested (storeIds or storeId param) intersected with the user's scope. */
  private storesFor(req: DemoRequest, u: Any): number[] {
    const scope = this.scope(u);
    const asked = parseIds(req.params.get('storeIds') ?? req.params.get('storeId'));
    return asked.length ? asked.filter((id) => scope.includes(id)) : scope;
  }
  private inScope<T extends Any>(list: T[], stores: number[], key = 'storeId'): T[] {
    return list.filter((x: Any) => x[key] === null || x[key] === undefined || stores.includes(x[key]));
  }
  private requireRole(u: Any, roles: string[]) {
    if (!roles.includes(u.role)) fail(403, 'Forbidden resource');
  }
  private storeName(id: number | null) {
    return this.db.master.stores.find((s: Any) => s.id === id)?.name ?? null;
  }
  private userName(id: number | null) {
    return this.db.master.users.find((u: Any) => u.id === id)?.name ?? null;
  }
  private managerOf(storeId: number): Any {
    const users = this.db.master.users.filter((u: Any) => u.isActive !== false);
    return users.find((u: Any) => u.role === 'STORE_MANAGER' && (u.storeIds ?? []).includes(storeId)) ?? users.find((u: Any) => this.isAdmin(u));
  }
  /** Contract v4: an assignee must exist, be active and work at the store (admins work everywhere). */
  private checkAssignee(assigneeId: unknown, storeId: unknown) {
    if (assigneeId === null || assigneeId === undefined || assigneeId === '') return;
    const a = this.db.master.users.find((x: Any) => x.id === Number(assigneeId));
    if (!a || a.isActive === false) fail(400, 'assigneeId: the assignee does not exist or is inactive');
    if (!this.isAdmin(a) && !(a.storeIds ?? []).includes(Number(storeId))) fail(400, `assigneeId: ${a.name} does not work at this store`);
  }
  private audit(u: Any, action: string, entity: string, entityId: number | string | null, details: unknown = null) {
    const e = { userId: u?.id ?? null, userName: u?.name ?? null, action, entity, entityId, details, createdAt: nowIso() };
    if (!this.db.misc) this.db.pendingAudit.push(e);
    else this.db.misc.auditLogs.unshift({ id: nextId(this.db.misc.auditLogs), ...e });
  }
  private notify(userId: number, title: string, body: string, link: string | null) {
    const list = this.db.notifications.get(userId) ?? [];
    const id = Math.max(0, ...[...this.db.notifications.values()].flat().map((n: Any) => n.id)) + 1;
    list.unshift({ id, title, body, link, isRead: false, createdAt: nowIso() });
    this.db.notifications.set(userId, list);
  }

  // ---------------------------------------------------------------- analytics helpers
  private preset(req: DemoRequest): PresetKey {
    const len = this.db.meta.presets.thisMonth ? Math.round((Date.parse(this.db.meta.presets.thisMonth.to) - Date.parse(this.db.meta.presets.thisMonth.from)) / 86_400_000) + 1 : 30;
    return presetFor(req.params.get('from'), req.params.get('to'), this.db.today, len);
  }
  private analyticsScope(req: DemoRequest, u: Any): { key: string; stores: number[] } {
    const stores = this.storesFor(req, u);
    return { key: scopeKey(stores, null, this.db.meta.storeIds), stores };
  }
  private async analytic(req: DemoRequest, u: Any, pick: (scope: Any) => Any, listFilter = false): Promise<DemoResponse> {
    const bundle = await this.db.analytics(this.preset(req));
    const { key, stores } = this.analyticsScope(req, u);
    let data = pick(bundle[key] ?? bundle.all);
    // a subset of stores (or a regional scope) served from 'all': filter list-shaped responses
    if (listFilter && key === 'all' && Array.isArray(data) && stores.length < this.db.meta.storeIds.length) {
      data = data.filter((r: Any) => stores.includes(r.storeId));
    }
    return ok(data);
  }

  // ---------------------------------------------------------------- routes
  private register(): void {
    const db = this.db;

    // ---- health & auth
    this.on('GET', '/health', () => ok({ status: 'ok', db: 'up', time: nowIso(), demo: true }), true);
    this.on(
      'POST',
      '/auth/login',
      (req) => {
        const b = bodyOf(req);
        const u = db.master.users.find((x: Any) => x.email?.toLowerCase() === String(b['email'] ?? '').toLowerCase());
        const expected = u ? (db.passwords.get(u.id) ?? DEMO_PASSWORD) : DEMO_PASSWORD;
        if (!u || u.isActive === false || b['password'] !== expected) fail(401, 'Invalid email or password');
        return created({ accessToken: makeDemoToken(u.id), user: u });
      },
      true,
    );
    this.on('GET', '/auth/me', (_r, _m, u) => ok(u));
    this.on('POST', '/auth/change-password', (req, _m, u) => {
      const b = bodyOf(req);
      if (b['currentPassword'] !== (db.passwords.get(u.id) ?? DEMO_PASSWORD)) fail(400, 'Current password is incorrect');
      if (String(b['newPassword'] ?? '').length < 8) fail(400, 'newPassword must be longer than or equal to 8 characters');
      db.passwords.set(u.id, b['newPassword']);
      return created({ ok: true });
    });

    // ---- users / regions / stores / cameras / zones
    this.on('GET', '/users', () => ok(db.master.users));
    this.on('GET', '/users/:id', (_r, m) => ok(db.master.users.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'User not found')));
    this.on('POST', '/users', (req, _m, u) => {
      this.requireRole(u, ADMINS);
      const b = bodyOf(req);
      if (db.master.users.some((x: Any) => x.email === b['email'])) fail(409, 'Email already exists');
      const nu = { id: nextId(db.master.users), email: b['email'], name: b['name'], role: b['role'], isActive: b['isActive'] ?? true, storeIds: b['storeIds'] ?? [], createdAt: nowIso() };
      db.master.users.push(nu);
      if (b['password']) db.passwords.set(nu.id, b['password']);
      this.audit(u, 'CREATE', 'user', nu.id);
      return created(nu);
    });
    this.on('PATCH', '/users/:id', (req, m, u) => {
      this.requireRole(u, ADMINS);
      const x = db.master.users.find((y: Any) => y.id === Number(m[1])) ?? fail(404, 'User not found');
      const { password, ...rest } = bodyOf(req);
      const before = { ...x };
      Object.assign(x, rest);
      if (password) db.passwords.set(x.id, password);
      this.audit(u, 'UPDATE', 'users', x.id, auditDetails('PATCH', `/api/users/${x.id}`, rest, before, x));
      return ok(x);
    });
    this.on('DELETE', '/users/:id', (_r, m, u) => {
      this.requireRole(u, ADMINS);
      const x = db.master.users.find((y: Any) => y.id === Number(m[1])) ?? fail(404, 'User not found');
      x.isActive = false;
      this.audit(u, 'DEACTIVATE', 'user', x.id);
      return ok(x);
    });

    this.crud('/regions', () => db.master.regions, 'region', ADMINS);

    this.on('GET', '/stores', (_r, _m, u) => ok(db.master.stores.filter((s: Any) => this.scope(u).includes(s.id))));
    this.on('GET', '/stores/:id', (_r, m, u) => {
      const id = Number(m[1]);
      if (!this.scope(u).includes(id)) fail(403, 'Forbidden store');
      const s = db.master.stores.find((x: Any) => x.id === id) ?? fail(404, 'Store not found');
      return ok({ ...s, cameras: db.master.cameras.filter((c: Any) => c.storeId === id), zones: db.master.zones.filter((z: Any) => z.storeId === id) });
    });
    this.on('POST', '/stores', (req, _m, u) => {
      this.requireRole(u, ADMINS);
      const b = bodyOf(req);
      const s = { id: nextId(db.master.stores), ...b, regionName: db.master.regions.find((r: Any) => r.id === b['regionId'])?.name ?? null, isActive: b['isActive'] ?? true, createdAt: nowIso() };
      db.master.stores.push(s);
      db.meta.storeIds = [...db.meta.storeIds, s.id];
      this.audit(u, 'CREATE', 'store', s.id);
      return created(s);
    });
    this.on('PATCH', '/stores/:id', (req, m, u) => {
      this.requireRole(u, ADMINS);
      const s = db.master.stores.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Store not found');
      const b = bodyOf(req);
      const before = { ...s };
      Object.assign(s, b);
      if (b['regionId']) s.regionName = db.master.regions.find((r: Any) => r.id === b['regionId'])?.name ?? s.regionName;
      this.audit(u, 'UPDATE', 'stores', s.id, auditDetails('PATCH', `/api/stores/${s.id}`, b, before, s));
      return ok(s);
    });
    this.on('DELETE', '/stores/:id', (_r, m, u) => {
      this.requireRole(u, ADMINS);
      db.master.stores = db.master.stores.filter((x: Any) => x.id !== Number(m[1]));
      this.audit(u, 'DELETE', 'store', Number(m[1]));
      return ok({ ok: true });
    });

    this.on('GET', '/cameras', (req, _m, u) => ok(this.inScope(db.master.cameras, this.storesFor(req, u))));
    this.on('GET', '/cameras/:id/snapshot', async (_r, m) => {
      if (!db.master.cameras.some((c: Any) => c.id === Number(m[1]))) fail(404, 'Camera not found');
      const blob = await db.mediaBlob(`snapshot/camera-${m[1]}`);
      // contract v4: a known camera without a snapshot yet answers 204 (the UI shows its own placeholder)
      return blob ? ok(blob, { 'Content-Type': blob.type }) : { status: 204, body: null, headers: { 'Cache-Control': 'no-cache' } };
    });
    this.on('GET', '/cameras/:id', (_r, m) => ok(db.master.cameras.find((c: Any) => c.id === Number(m[1])) ?? fail(404, 'Camera not found')));
    this.on('POST', '/cameras', (req, _m, u) => {
      this.requireRole(u, ADMINS);
      const c = { id: nextId(db.master.cameras), status: 'UNKNOWN', lastHeartbeatAt: null, isActive: true, ...bodyOf(req) };
      db.master.cameras.push(c);
      this.audit(u, 'CREATE', 'camera', c.id);
      return created(c);
    });
    this.on('PATCH', '/cameras/:id', (req, m, u) => {
      this.requireRole(u, ADMINS);
      const c = db.master.cameras.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Camera not found');
      Object.assign(c, bodyOf(req));
      return ok(c);
    });
    this.on('DELETE', '/cameras/:id', (_r, m, u) => {
      this.requireRole(u, ADMINS);
      const id = Number(m[1]);
      db.master.cameras = db.master.cameras.filter((x: Any) => x.id !== id);
      db.master.zones = db.master.zones.filter((z: Any) => z.cameraId !== id);
      this.audit(u, 'DELETE', 'camera', id);
      return ok({ ok: true });
    });

    this.on('GET', '/zones', (req, _m, u) => {
      const cam = Number(req.params.get('cameraId')) || null;
      return ok(this.inScope(db.master.zones, this.storesFor(req, u)).filter((z: Any) => !cam || z.cameraId === cam));
    });
    this.on('POST', '/zones', (req, _m, u) => {
      this.requireRole(u, ADMINS);
      const z = { id: nextId(db.master.zones), isActive: true, engagedDwellSec: 30, ...bodyOf(req) };
      db.master.zones.push(z);
      this.audit(u, 'CREATE', 'zone', z.id);
      return created(z);
    });
    this.on('PATCH', '/zones/:id', (req, m, u) => {
      this.requireRole(u, ADMINS);
      const z = db.master.zones.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Zone not found');
      Object.assign(z, bodyOf(req));
      return ok(z);
    });
    this.on('DELETE', '/zones/:id', (_r, m, u) => {
      this.requireRole(u, ADMINS);
      db.master.zones = db.master.zones.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });

    // ---- edge devices
    const apiKey = () => 'ce_' + Array.from(crypto.getRandomValues(new Uint8Array(20)), (b) => b.toString(16).padStart(2, '0')).join('');
    this.on('GET', '/edge-devices', (req, _m, u) => ok(this.inScope(db.master.edgeDevices, this.storesFor(req, u))));
    this.on('POST', '/edge-devices', (req, _m, u) => {
      this.requireRole(u, ADMINS);
      const key = apiKey();
      const d = { id: nextId(db.master.edgeDevices), lastSeenAt: null, version: null, createdAt: nowIso(), ...bodyOf(req), apiKeyPrefix: key.slice(0, 10) };
      db.master.edgeDevices.push(d);
      this.audit(u, 'CREATE', 'edge_device', d.id);
      return created({ ...d, apiKey: key });
    });
    this.on('POST', '/edge-devices/:id/rotate-key', (_r, m, u) => {
      this.requireRole(u, ADMINS);
      const d = db.master.edgeDevices.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Device not found');
      const key = apiKey();
      d.apiKeyPrefix = key.slice(0, 10);
      this.audit(u, 'ROTATE_KEY', 'edge_device', d.id);
      return created({ apiKey: key });
    });
    this.on('DELETE', '/edge-devices/:id', (_r, m, u) => {
      this.requireRole(u, ADMINS);
      db.master.edgeDevices = db.master.edgeDevices.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });

    // ---- staff, settings, audit
    this.on('GET', '/staff', (req, _m, u) => ok(this.inScope(db.master.staff, this.storesFor(req, u))));
    this.on('POST', '/staff', (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      const s = { id: nextId(db.master.staff), isActive: true, ...bodyOf(req) };
      db.master.staff.push(s);
      return created(s);
    });
    this.on('PATCH', '/staff/:id', (req, m, u) => {
      this.requireRole(u, SM_PLUS);
      const s = db.master.staff.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Staff not found');
      Object.assign(s, bodyOf(req));
      return ok(s);
    });
    this.on('DELETE', '/staff/:id', (_r, m, u) => {
      this.requireRole(u, SM_PLUS);
      db.master.staff = db.master.staff.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });
    this.on('GET', '/settings', () => ok(db.master.settings));
    this.on('PUT', '/settings', (req, _m, u) => {
      this.requireRole(u, ADMINS);
      const before = { ...db.master.settings };
      Object.assign(db.master.settings, bodyOf(req));
      this.audit(u, 'UPDATE', 'settings', null, auditDetails('PUT', '/api/settings', bodyOf(req), before, db.master.settings));
      return ok(db.master.settings);
    });
    this.on('GET', '/audit-logs', async (req, _m, u) => {
      this.requireRole(u, ADMINS);
      await db.ensureMisc();
      const userId = Number(req.params.get('userId')) || null;
      const entity = (req.params.get('entity') ?? '').toLowerCase();
      const rows = db.misc.auditLogs.filter((a: Any) => (!userId || a.userId === userId) && (!entity || String(a.entity).toLowerCase().includes(entity)));
      return ok(paginate(rows, req.params.get('page'), req.params.get('pageSize'), 50));
    });

    // ---- POS
    this.on('GET', '/pos/transactions', async (req, _m, u) => {
      await db.ensureMisc();
      const stores = this.storesFor(req, u);
      const rows = db.misc.posTransactions.filter((t: Any) => stores.includes(t.storeId) && inDateRange(t.ts, req.params.get('from'), req.params.get('to')));
      return ok(paginate(rows, req.params.get('page'), req.params.get('pageSize')));
    });
    this.on('POST', '/pos/transactions', (req) => {
      const tx = (bodyOf(req)['transactions'] as Any[]) ?? [];
      return created({ accepted: tx.length, duplicates: 0 });
    });
    this.on('POST', '/pos/import', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      const file = bodyOf(req)['file'] as File | undefined;
      const text = file ? await file.text() : '';
      const lines = text.split(/\r?\n/).filter((l) => l.trim());
      const header = (lines[0] ?? '').toLowerCase();
      const errors = header.includes('storecode') ? [] : ['Missing header storeCode,billNo,ts,amount,itemsCount,staffCode'];
      return created({ accepted: errors.length ? 0 : Math.max(0, lines.length - 1), duplicates: 0, errors });
    });

    // ---- analytics (captured per preset × scope)
    this.on('GET', '/analytics/overview', (req, _m, u) => this.analytic(req, u, (s) => (req.params.get('compare') === 'true' ? s.overviewCompare : s.overview)));
    this.on('GET', '/analytics/traffic', (req, _m, u) => this.analytic(req, u, (s) => s.traffic));
    this.on('GET', '/analytics/traffic-density', (req, _m, u) => this.analytic(req, u, (s) => s.trafficDensity));
    this.on('GET', '/analytics/demographics', (req, _m, u) => this.analytic(req, u, (s) => s.demographics));
    this.on('GET', '/analytics/zones', (req, _m, u) => this.analytic(req, u, (s) => s.zones, true));
    this.on('GET', '/analytics/conversion', (req, _m, u) => this.analytic(req, u, (s) => s.conversion));
    this.on('GET', '/analytics/queue', (req, _m, u) => this.analytic(req, u, (s) => s.queue));
    this.on('GET', '/analytics/storeops', (req, _m, u) => this.analytic(req, u, (s) => s.storeops));
    this.on('GET', '/analytics/benchmark/groups', (req, _m, u) => this.analytic(req, u, (s) => s.groups[req.params.get('groupBy') ?? 'region'] ?? s.groups.region));
    this.on('GET', '/analytics/benchmark', (req, _m, u) => this.analytic(req, u, (s) => (req.params.get('compare') === 'true' ? s.benchmarkCompare : s.benchmark), true));
    this.on('GET', '/ai-manager/summary', (req, _m, u) => this.analytic(req, u, (s) => s.aiSummary));
    this.on('GET', '/ai-manager/open-close', (req, _m, u) => this.analytic(req, u, (s) => s.openClose, true));
    this.on('GET', '/checklists/dashboard', (req, _m, u) => this.analytic(req, u, (s) => s.traxDashboard));
    this.on('GET', '/checklists/compliance', (req, _m, u) => this.analytic(req, u, (s) => s.compliance, true));
    this.on('GET', '/analytics/heatmap', async (req) => {
      const all = await db.heatmaps();
      const p = all[this.preset(req)] ?? all.last7;
      const h = p[req.params.get('cameraId') ?? ''];
      return ok(h ?? { cameraId: Number(req.params.get('cameraId')), width: 32, height: 18, grid: new Array(576).fill(0), max: 0 });
    });
    this.on('GET', '/analytics/journey', async (req, _m, u) => {
      const all = await db.journeys();
      const p = all[this.preset(req)] ?? all.last7;
      const { key } = this.analyticsScope(req, u);
      return ok(p[key] ?? p.all);
    });
    this.on('GET', '/analytics/live', async (req) => {
      const { live } = await db.liveAndInfra();
      const l = live[req.params.get('storeId') ?? ''] ?? fail(404, 'Store not found');
      return ok({ ...l, asOf: nowIso() });
    });
    this.on('GET', '/infra/health', async (req, _m, u) => {
      const { infra } = await db.liveAndInfra();
      const { key, stores } = this.analyticsScope(req, u);
      const h = infra[key] ?? infra.all;
      if (key === 'all' && stores.length < db.meta.storeIds.length) return ok({ ...h, stores: h.stores.filter((s: Any) => stores.includes(s.storeId)) });
      return ok(h);
    });

    // ---- alerts, rules, notifications
    this.on('GET', '/alerts', async (req, _m, u) => {
      await db.ensureOps();
      const st = req.params.get('status');
      const sev = req.params.get('severity');
      const rows = this.inScope(db.ops.alerts, this.storesFor(req, u))
        .filter((a: Any) => (!st || a.status === st) && (!sev || a.severity === sev))
        .sort((a: Any, b: Any) => b.createdAt.localeCompare(a.createdAt));
      return ok(paginate(rows, req.params.get('page'), req.params.get('pageSize')));
    });
    const alertById = async (id: string) => {
      await db.ensureOps();
      return db.ops.alerts.find((a: Any) => a.id === Number(id)) ?? fail(404, 'Alert not found');
    };
    this.on('PATCH', '/alerts/:id/ack', async (_r, m, u) => {
      const a = await alertById(m[1]);
      Object.assign(a, { status: 'ACKNOWLEDGED', acknowledgedAt: nowIso(), acknowledgedByName: u.name });
      return ok(a);
    });
    this.on('PATCH', '/alerts/:id/resolve', async (_r, m, u) => {
      const a = await alertById(m[1]);
      Object.assign(a, { status: 'RESOLVED', resolvedAt: nowIso(), acknowledgedAt: a.acknowledgedAt ?? nowIso(), acknowledgedByName: a.acknowledgedByName ?? u.name });
      return ok(a);
    });
    this.on('POST', '/alerts/:id/ticket', async (_r, m, u) => {
      const a = await alertById(m[1]);
      if (a.ticketId) return created(db.ops.tickets.find((t: Any) => t.id === a.ticketId));
      const cat = /CAMERA/.test(a.metric) ? 'CAMERA' : /EDGE/.test(a.metric) ? 'NETWORK' : 'OTHER';
      const t = this.createTicket(u, { title: a.ruleName, description: a.message, storeId: a.storeId, category: cat, priority: a.severity === 'CRITICAL' ? 'URGENT' : a.severity, alertId: a.id });
      a.ticketId = t.id;
      return created(t);
    });
    this.on('POST', '/alerts/evaluate', () => created({ created: 0 }));
    this.crud('/alert-rules', () => db.master.alertRules, 'alert_rule', ADMINS, { autoTicket: false, isActive: true });

    this.on('GET', '/notifications', (_r, _m, u) => ok((db.notifications.get(u.id) ?? []).slice(0, 100)));
    this.on('PATCH', '/notifications/:id/read', (_r, m, u) => {
      const n = (db.notifications.get(u.id) ?? []).find((x: Any) => x.id === Number(m[1]));
      if (n) n.isRead = true;
      return ok({ ok: true });
    });
    this.on('POST', '/notifications/read-all', (_r, _m, u) => {
      (db.notifications.get(u.id) ?? []).forEach((n: Any) => (n.isRead = true));
      return created({ ok: true });
    });

    // ---- checklists
    this.registerChecklists();

    // ---- recorders, probes, discovery (contract v3)
    this.registerRecorders();

    // ---- tasks
    this.on('GET', '/tasks', async (req, _m, u) => {
      await db.ensureOps();
      const st = req.params.get('status');
      const assignee = Number(req.params.get('assigneeId')) || null;
      const mine = req.params.get('mine') === 'true' || u.role === 'STAFF';
      const now = Date.now();
      const rows = this.inScope(db.ops.tasks, this.storesFor(req, u)).filter(
        (t: Any) =>
          (!st || t.status === st) &&
          (!assignee || t.assigneeId === assignee) &&
          (!mine || t.assigneeId === u.id) &&
          // scheduled tasks stay hidden from their assignee until startAt
          (!(u.role === 'STAFF') || !t.startAt || Date.parse(t.startAt) <= now),
      );
      return ok(rows);
    });
    const taskById = async (id: string) => {
      await db.ensureOps();
      return db.ops.tasks.find((t: Any) => t.id === Number(id)) ?? fail(404, 'Task not found');
    };
    this.on('GET', '/tasks/:id', async (_r, m) => ok(await taskById(m[1])));
    this.on('POST', '/tasks/bulk', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      const b = bodyOf(req);
      const ids = ((b['storeIds'] as number[]) ?? []).filter((id) => this.scope(u).includes(id));
      if (!ids.length) fail(400, 'storeIds must contain at least 1 elements');
      for (const id of ids) this.checkAssignee(b['assigneeId'], id);
      const out = ids.map((storeId) => this.createTask(u, { ...b, storeId, assigneeId: b['assigneeId'] ?? this.managerOf(storeId)?.id ?? null }));
      return created(out);
    });
    this.on('POST', '/tasks', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      const b = bodyOf(req);
      this.checkAssignee(b['assigneeId'], b['storeId']);
      return created(this.createTask(u, b));
    });
    this.on('PATCH', '/tasks/:id/status', async (req, m, u) => {
      const t = await taskById(m[1]);
      const b = bodyOf(req);
      if (!SM_PLUS.includes(u.role) && t.assigneeId !== u.id) fail(403, 'Only the assignee or a manager can change status');
      t.status = b['status'];
      if (b['status'] === 'DONE') t.completedAt = nowIso();
      if (b['proofUrl'] !== undefined) t.proofUrl = b['proofUrl'];
      if (b['remark'] !== undefined) t.remark = b['remark'];
      return ok(t);
    });
    this.on('PATCH', '/tasks/:id/verify', async (_r, m, u) => {
      this.requireRole(u, SM_PLUS);
      const t = await taskById(m[1]);
      if (t.status !== 'DONE') fail(400, 'Only DONE tasks can be verified');
      Object.assign(t, { status: 'VERIFIED', verifiedAt: nowIso() });
      return ok(t);
    });
    this.on('PATCH', '/tasks/:id', async (req, m) => {
      const t = await taskById(m[1]);
      const b = bodyOf(req);
      if ('assigneeId' in b || 'storeId' in b) this.checkAssignee('assigneeId' in b ? b['assigneeId'] : t.assigneeId, b['storeId'] ?? t.storeId);
      Object.assign(t, b);
      if (b['storeId']) t.storeName = this.storeName(b['storeId']);
      if ('assigneeId' in b) t.assigneeName = this.userName(b['assigneeId']);
      return ok(t);
    });
    this.on('DELETE', '/tasks/:id', async (_r, m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      db.ops.tasks = db.ops.tasks.filter((t: Any) => t.id !== Number(m[1]));
      return ok({ ok: true });
    });

    // ---- tickets
    this.on('GET', '/tickets', async (req, _m, u) => {
      await db.ensureOps();
      const f = (k: string) => req.params.get(k);
      return ok(
        this.inScope(db.ops.tickets, this.storesFor(req, u)).filter(
          (t: Any) => (!f('status') || t.status === f('status')) && (!f('category') || t.category === f('category')) && (!f('priority') || t.priority === f('priority')),
        ),
      );
    });
    const ticketById = async (id: string) => {
      await db.ensureOps();
      return db.ops.tickets.find((t: Any) => t.id === Number(id)) ?? fail(404, 'Ticket not found');
    };
    this.on('GET', '/tickets/:id', async (_r, m) => {
      const t = await ticketById(m[1]);
      return ok({ ...t, comments: db.ops.ticketDetails[t.id]?.comments ?? [] });
    });
    this.on('POST', '/tickets', async (req, _m, u) => {
      await db.ensureOps();
      const b = bodyOf(req);
      this.checkAssignee(b['assigneeId'], b['storeId']);
      return created(this.createTicket(u, b));
    });
    this.on('PATCH', '/tickets/:id/status', async (req, m) => {
      const t = await ticketById(m[1]);
      t.status = bodyOf(req)['status'];
      if (['RESOLVED', 'CLOSED'].includes(t.status)) t.resolvedAt = t.resolvedAt ?? nowIso();
      if (['OPEN', 'REOPENED', 'IN_PROGRESS'].includes(t.status)) t.resolvedAt = null;
      t.isSlaBreached = !!t.slaDueAt && Date.parse(t.resolvedAt ?? nowIso()) > Date.parse(t.slaDueAt);
      return ok(t);
    });
    this.on('PATCH', '/tickets/:id', async (req, m) => {
      const t = await ticketById(m[1]);
      const b = bodyOf(req);
      if ('assigneeId' in b || 'storeId' in b) this.checkAssignee('assigneeId' in b ? b['assigneeId'] : t.assigneeId, b['storeId'] ?? t.storeId);
      Object.assign(t, b);
      if (b['storeId']) t.storeName = this.storeName(b['storeId']);
      if ('assigneeId' in b) t.assigneeName = this.userName(b['assigneeId']);
      return ok(t);
    });
    this.on('POST', '/tickets/:id/comments', async (req, m, u) => {
      const t = await ticketById(m[1]);
      if (t.status === 'CLOSED') fail(409, 'This ticket is closed: reopen it to comment');
      const d = (db.ops.ticketDetails[t.id] ??= { ...t, comments: [] });
      d.comments ??= [];
      const c = { id: nextId(Object.values<Any>(db.ops.ticketDetails).flatMap((x) => x.comments ?? [])), userId: u.id, userName: u.name, body: bodyOf(req)['body'], createdAt: nowIso() };
      d.comments.push(c);
      return created(c);
    });

    // ---- documents
    this.on('GET', '/documents', async (req, _m, u) => {
      await db.ensureOps();
      const cat = req.params.get('category');
      const storeId = Number(req.params.get('storeId')) || null;
      return ok(this.inScope(db.ops.documents, this.scope(u)).filter((d: Any) => (!cat || d.category === cat) && (!storeId || d.storeId === storeId)));
    });
    this.on('POST', '/documents', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      const b = bodyOf(req);
      const file = b['file'] as File;
      if (!(file instanceof Blob)) fail(400, 'file is required');
      if (file.size > MAX_UPLOAD) fail(413, 'File too large (limit 50 MB)');
      const storeId = b['storeId'] ? Number(b['storeId']) : null;
      const d = {
        id: nextId(db.ops.documents),
        title: b['title'],
        category: b['category'],
        storeId,
        storeName: this.storeName(storeId),
        fileName: file?.name ?? 'file',
        mimeType: file?.type || 'application/octet-stream',
        size: file?.size ?? 0,
        uploadedByName: u.name,
        createdAt: nowIso(),
      };
      db.ops.documents.unshift(d);
      return created(d);
    });
    this.on('GET', '/documents/:id/download', async (_r, m) => {
      await db.ensureOps();
      const d = db.ops.documents.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Document not found');
      const blob = new Blob([JSON.stringify({ demoDocument: d })], { type: 'application/x-demo-document' });
      return ok(blob, { 'Content-Disposition': `attachment; filename="${d.fileName}"`, 'Content-Type': 'application/x-demo-document' });
    });
    this.on('DELETE', '/documents/:id', async (_r, m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      db.ops.documents = db.ops.documents.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });

    // ---- vendors & visits
    this.on('GET', '/vendors', async () => {
      await db.ensureOps();
      return ok(db.ops.vendors);
    });
    this.on('POST', '/vendors', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      const v = { id: nextId(db.ops.vendors), isActive: true, ...bodyOf(req) };
      db.ops.vendors.push(v);
      return created(v);
    });
    this.on('PATCH', '/vendors/:id', async (req, m) => {
      await db.ensureOps();
      const v = db.ops.vendors.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Vendor not found');
      Object.assign(v, bodyOf(req));
      return ok(v);
    });
    this.on('DELETE', '/vendors/:id', async (_r, m) => {
      await db.ensureOps();
      db.ops.vendors = db.ops.vendors.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });
    this.on('GET', '/vendor-visits', async (req, _m, u) => {
      await db.ensureOps();
      const st = req.params.get('status');
      const vendorId = Number(req.params.get('vendorId')) || null;
      return ok(
        this.inScope(db.ops.visits, this.storesFor(req, u)).filter(
          (v: Any) => (!st || v.status === st) && (!vendorId || v.vendorId === vendorId) && (!req.params.get('from') || inDateRange(v.scheduledAt, req.params.get('from'), req.params.get('to'))),
        ),
      );
    });
    const visitById = async (id: string) => {
      await db.ensureOps();
      return db.ops.visits.find((x: Any) => x.id === Number(id)) ?? fail(404, 'Visit not found');
    };
    this.on('POST', '/vendor-visits', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureOps();
      const b = bodyOf(req);
      const v = {
        id: nextId(db.ops.visits),
        vendorId: b['vendorId'],
        vendorName: db.ops.vendors.find((x: Any) => x.id === b['vendorId'])?.name ?? null,
        storeId: b['storeId'],
        storeName: this.storeName(b['storeId']),
        purpose: b['purpose'],
        scheduledAt: b['scheduledAt'],
        checkInAt: null,
        checkOutAt: null,
        status: 'SCHEDULED',
        rating: null,
        notes: null,
      };
      db.ops.visits.unshift(v);
      return created(v);
    });
    this.on('PATCH', '/vendor-visits/:id/check-in', async (_r, m) => {
      const v = await visitById(m[1]);
      Object.assign(v, { status: 'CHECKED_IN', checkInAt: nowIso() });
      return ok(v);
    });
    this.on('PATCH', '/vendor-visits/:id/check-out', async (req, m) => {
      const v = await visitById(m[1]);
      const b = bodyOf(req);
      Object.assign(v, { status: 'COMPLETED', checkOutAt: nowIso(), rating: b['rating'] ?? null, notes: b['notes'] ?? null });
      return ok(v);
    });
    this.on('PATCH', '/vendor-visits/:id', async (req, m) => {
      const v = await visitById(m[1]);
      const b = bodyOf(req);
      Object.assign(v, b);
      if (b['vendorId']) v.vendorName = db.ops.vendors.find((x: Any) => x.id === b['vendorId'])?.name ?? v.vendorName;
      if (b['storeId']) v.storeName = this.storeName(b['storeId']);
      return ok(v);
    });

    // ---- uploads (object URLs for the session)
    this.on('POST', '/uploads', (req) => {
      const f = bodyOf(req)['file'];
      if (!(f instanceof Blob)) fail(400, 'file is required');
      if ((f as Blob).size > MAX_UPLOAD) fail(413, 'File too large (limit 50 MB)');
      const url = URL.createObjectURL(f as Blob);
      db.uploadsByFile.set(fileKey(f as File), url);
      return created({ url });
    });

    // ---- reports
    this.on('GET', '/reports/export', (req, _m, u) => this.exportReport(req, u));
    this.crud('/reports/schedules', () => db.master.reportSchedules, 'report_schedule', ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR'], { isActive: true, lastRunAt: null, storeIds: [] });
    this.on('POST', '/reports/schedules/:id/run', (_r, m) => {
      const s = db.master.reportSchedules.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Schedule not found');
      s.lastRunAt = nowIso();
      return created({ ok: true, file: `reports/${s.type}_${db.today}.${s.format}` });
    });

    // ---- image directory, recaps
    this.on('GET', '/image-directory', async (req, _m, u) => {
      await db.ensureAi();
      const cam = Number(req.params.get('cameraId')) || null;
      const kind = req.params.get('kind');
      const rows = this.inScope(db.ai.imageDirectory, this.storesFor(req, u))
        .filter((i: Any) => (!cam || i.cameraId === cam) && (!kind || i.kind === kind) && inDateRange(i.ts, req.params.get('from'), req.params.get('to')))
        .sort((a: Any, b: Any) => b.ts.localeCompare(a.ts));
      return ok(paginate(rows, req.params.get('page'), req.params.get('pageSize'), 24));
    });
    this.on('GET', '/recaps', async (req, _m, u) => {
      await db.ensureAi();
      return ok(this.inScope(db.ai.recaps, this.storesFor(req, u)).filter((r: Any) => inDateRange(r.date, req.params.get('from'), req.params.get('to'))));
    });
    this.on('GET', '/recaps/:id', async (_r, m) => {
      await db.ensureAi();
      return ok(db.ai.recaps.find((r: Any) => r.id === Number(m[1])) ?? fail(404, 'Recap not found'));
    });
    this.on('POST', '/recaps/generate', async (req, _m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureAi();
      const b = bodyOf(req);
      const storeId = Number(b['storeId']);
      const date = String(b['date']);
      const template = db.ai.recaps.find((r: Any) => r.status === 'READY');
      if (!template) fail(422, 'No snapshots for this store and date');
      const existing = db.ai.recaps.find((r: Any) => r.storeId === storeId && r.date === date);
      const r = { ...template, id: existing?.id ?? nextId(db.ai.recaps), storeId, storeName: this.storeName(storeId), date, createdAt: nowIso() };
      db.ai.recaps = [r, ...db.ai.recaps.filter((x: Any) => x.id !== r.id)];
      return created(r);
    });

    // ---- AI manager
    const RULE_WRITERS = ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER'];
    this.on('GET', '/ai-manager/rules', async () => {
      await db.ensureAi();
      return ok(db.ai.rules);
    });
    this.on('POST', '/ai-manager/rules', async (req, _m, u) => {
      this.requireRole(u, RULE_WRITERS);
      await db.ensureAi();
      const r = { id: nextId(db.ai.rules), ...bodyOf(req) };
      db.ai.rules.push(r);
      this.audit(u, 'CREATE', 'ai_manager_rule', r.id);
      return created(r);
    });
    this.on('PATCH', '/ai-manager/rules/:id', async (req, m, u) => {
      this.requireRole(u, RULE_WRITERS);
      await db.ensureAi();
      const r = db.ai.rules.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Rule not found');
      Object.assign(r, bodyOf(req));
      return ok(r);
    });
    this.on('DELETE', '/ai-manager/rules/:id', async (_r, m, u) => {
      this.requireRole(u, RULE_WRITERS);
      await db.ensureAi();
      db.ai.rules = db.ai.rules.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });
    this.on('GET', '/ai-manager/detections', async (req, _m, u) => {
      await db.ensureAi();
      const f = (k: string) => req.params.get(k);
      const ruleId = Number(f('ruleId')) || null;
      const rows = this.inScope(db.ai.detections, this.storesFor(req, u))
        .filter(
          (d: Any) =>
            (!f('type') || d.type === f('type')) && (!f('status') || d.status === f('status')) && (!ruleId || d.ruleId === ruleId) && inDateRange(d.ts, f('from'), f('to')),
        )
        .sort((a: Any, b: Any) => b.ts.localeCompare(a.ts));
      return ok(paginate(rows, f('page'), f('pageSize'), 24));
    });
    this.on('PATCH', '/ai-manager/detections/:id/review', async (req, m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureAi();
      const d = db.ai.detections.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Detection not found');
      d.reviewStatus = bodyOf(req)['reviewStatus'];
      return ok(d);
    });
  }

  // ---------------------------------------------------------------- recorders (contract v3)
  /**
   * Simulated connection tests: a probe is PENDING, RUNNING after ~0.3 s and done after ~1.5 s. Every channel
   * answers OK (1080p H.264) except one per recorder (its last channel, on recorders with 2+ channels), which
   * fails with AUTH, so the UI shows both outcomes. Recorder status follows the latest result per channel.
   */
  /** Contract v4: the template as each submission answered it (old wording, weights, retired questions). */
  private templateSnapshots = new Map<number, Any>();
  private probeOutcome = new Map<number, { due: number; ok: boolean; snapshotUrl: string | null; latencyMs: number }>();
  private registerRecorders(): void {
    const db = this.db;
    const RECORDER_WRITERS = ['SUPER_ADMIN', 'ADMIN', 'STORE_MANAGER'];
    const recs = (): Any[] => (db.master.recorders ??= []);
    const probes = (): Any[] => (db.master.probes ??= []);
    const linked = (r: Any) => db.master.cameras.filter((c: Any) => c.recorderId === r.id && c.isActive !== false);
    const view = (r: Any) => {
      const { password: _pw, ...rest } = r;
      return { ...rest, storeName: this.storeName(r.storeId), camerasLinked: linked(r).length };
    };
    const probeView = (p: Any) => p;
    const findRec = (u: Any, id: string) => {
      const r = recs().find((x: Any) => x.id === Number(id)) ?? fail(404, 'Recorder not found');
      if (!this.scope(u).includes(r.storeId)) fail(404, 'Recorder not found');
      return r;
    };
    const recompute = (r: Any) => {
      const latest = new Map<number, Any>();
      for (const p of [...probes()].filter((x: Any) => x.recorderId === r.id && ['OK', 'FAILED'].includes(x.status)).sort((a: Any, b: Any) => (b.completedAt ?? '').localeCompare(a.completedAt ?? '') || b.id - a.id)) {
        if (p.channel && p.channel <= r.channels && p.errorCode !== 'EDGE_OFFLINE' && !latest.has(p.channel)) latest.set(p.channel, p);
      }
      const results = [...latest.values()];
      const okN = results.filter((p) => p.status === 'OK').length;
      r.status = !results.length ? 'UNKNOWN' : okN === results.length ? 'ONLINE' : okN === 0 ? 'OFFLINE' : 'PARTIAL';
      r.lastCheckedAt = results.reduce<string | null>((m, p) => (p.completedAt && (!m || p.completedAt > m) ? p.completedAt : m), null);
    };
    /** Advances simulated probes to their current state (called before every read). */
    const settle = () => {
      const now = Date.now();
      const touched = new Set<number>();
      for (const p of probes()) {
        if (p.status !== 'PENDING' && p.status !== 'RUNNING') continue;
        const o = this.probeOutcome.get(p.id);
        const age = now - Date.parse(p.requestedAt);
        if (!o) {
          // captured open probes (no simulation attached): expire after 60 s like the real backend
          if (age > 60_000) Object.assign(p, { status: 'EXPIRED', completedAt: new Date().toISOString(), error: 'No edge device picked up this test within 60 s' });
          continue;
        }
        if (now >= o.due) {
          Object.assign(
            p,
            o.ok
              ? { status: 'OK', completedAt: new Date().toISOString(), width: 1920, height: 1080, fps: 25, codec: 'H.264', latencyMs: o.latencyMs, error: null, errorCode: null, snapshotUrl: o.snapshotUrl }
              : { status: 'FAILED', completedAt: new Date().toISOString(), error: 'Authentication failed (401 Unauthorized): check the recorder username and password', errorCode: 'AUTH' },
          );
          if (p.recorderId) touched.add(p.recorderId);
        } else if (age >= 300) p.status = 'RUNNING';
      }
      for (const id of touched) {
        const r = recs().find((x: Any) => x.id === id);
        if (r) recompute(r);
      }
    };
    const startProbes = async (specs: { storeId: number; cameraId: number | null; recorderId: number | null; channel: number | null; fail: boolean }[]) => {
      const out: Any[] = [];
      for (const [i, sp] of specs.entries()) {
        const id = nextId(probes());
        const p = { id, storeId: sp.storeId, cameraId: sp.cameraId, recorderId: sp.recorderId, channel: sp.channel, status: 'PENDING', requestedAt: nowIso(), completedAt: null, width: null, height: null, fps: null, codec: null, latencyMs: null, error: null, errorCode: null, snapshotUrl: null };
        probes().unshift(p);
        this.probeOutcome.set(id, { due: Date.now() + 1500, ok: !sp.fail, snapshotUrl: await db.imageFor(sp.storeId, id + i), latencyMs: 280 + ((id * 37) % 300) });
        out.push(p);
      }
      return out;
    };
    const validate = (b: Record<string, any>, partial: boolean) => {
      const errs: string[] = [];
      for (const k of ['name', 'host']) if ((!partial || k in b) && !String(b[k] ?? '').trim()) errs.push(`${k} should not be empty`);
      if ((!partial || 'channels' in b) && !(Number.isInteger(Number(b['channels'])) && Number(b['channels']) >= 1 && Number(b['channels']) <= 64)) errs.push('channels must be between 1 and 64');
      for (const k of ['rtspPort', 'httpPort']) if (k in b && !(Number(b[k]) >= 1 && Number(b[k]) <= 65535)) errs.push(`${k} must be a port number`);
      if (errs.length) fail(400, errs.join('. '));
    };

    this.on('GET', '/recorders/brands', () =>
      ok(
        db.master.recorderBrands ?? [
          { brand: 'HIKVISION', label: 'Hikvision', defaultRtspPort: 554, mainTemplate: 'rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{ch}01', subTemplate: 'rtsp://{user}:{pass}@{host}:{port}/Streaming/Channels/{ch}02', notes: null },
          { brand: 'CUSTOM', label: 'Custom URL', defaultRtspPort: 554, mainTemplate: null, subTemplate: null, notes: 'Write the URL template yourself' },
        ],
      ),
    );
    this.on('GET', '/recorders/discovered', (req, _m, u) => {
      const sid = Number(req.params.get('storeId')) || null;
      const ids = sid ? [sid].filter((id) => this.scope(u).includes(id)) : this.scope(u);
      return ok(ids.flatMap((id) => db.master.discovered?.[id] ?? []));
    });
    this.on('GET', '/recorders', (req, _m, u) => {
      settle();
      return ok(this.inScope(recs(), this.storesFor(req, u)).map(view));
    });
    this.on('GET', '/recorders/:id', (_r, m, u) => {
      settle();
      return ok(view(findRec(u, m[1])));
    });
    this.on('POST', '/recorders', (req, _m, u) => {
      this.requireRole(u, RECORDER_WRITERS);
      const b = bodyOf(req);
      validate(b, false);
      if (!this.scope(u).includes(Number(b['storeId']))) fail(403, 'Forbidden store');
      if (recs().some((x: Any) => x.storeId === b['storeId'] && x.host === b['host'] && Number(x.rtspPort) === Number(b['rtspPort'] ?? 554)))
        fail(409, 'A recorder with this host and RTSP port already exists in this store');
      const { password, ...rest } = b;
      const r = { id: nextId(recs()), kind: 'NVR', brand: 'HIKVISION', rtspPort: 554, httpPort: 80, username: 'admin', stream: 'SUB', urlTemplate: null, ...rest, hasPassword: !!password, status: 'UNKNOWN', lastCheckedAt: null, createdAt: nowIso() };
      recs().push(r);
      this.audit(u, 'CREATE', 'recorders', r.id, { method: 'POST', path: '/api/recorders', body: { ...rest } });
      return created(view(r));
    });
    this.on('PATCH', '/recorders/:id', (req, m, u) => {
      this.requireRole(u, RECORDER_WRITERS);
      const r = findRec(u, m[1]);
      const b = bodyOf(req);
      validate(b, true);
      const { password, ...rest } = b;
      const before = Object.fromEntries(Object.keys(rest).map((k) => [k, r[k]]));
      Object.assign(r, rest);
      if (password) r.hasPassword = true;
      this.audit(u, 'UPDATE', 'recorders', r.id, auditDetails('PATCH', `/api/recorders/${r.id}`, rest, before, r));
      return ok(view(r));
    });
    this.on('DELETE', '/recorders/:id', (req, m, u) => {
      this.requireRole(u, RECORDER_WRITERS);
      const r = findRec(u, m[1]);
      const cams = linked(r);
      if (cams.length && req.params.get('unlinkCameras') !== 'true') fail(409, `${cams.length} camera(s) are linked to this recorder. Unlink them first or delete with ?unlinkCameras=true`);
      for (const c of cams) Object.assign(c, { recorderId: null, channel: null, streamProfile: null });
      db.master.recorders = recs().filter((x: Any) => x.id !== r.id);
      this.audit(u, 'DELETE', 'recorders', r.id, { method: 'DELETE', path: `/api/recorders/${r.id}`, before: view(r) });
      return ok({ ok: true });
    });
    this.on('POST', '/recorders/:id/generate-cameras', (req, m, u) => {
      this.requireRole(u, RECORDER_WRITERS);
      const r = findRec(u, m[1]);
      const b = bodyOf(req);
      const channels = [...new Set(((b['channels'] as number[]) ?? []).map(Number))];
      if (!channels.length) fail(400, 'channels must contain at least 1 elements');
      const bad = channels.filter((ch) => !(ch >= 1 && ch <= r.channels));
      if (bad.length) fail(400, `channel numbers must be ≤ ${r.channels} (got ${bad.join(', ')})`);
      const prefix = String(b['namePrefix'] ?? `${r.name} ch`).trim() || `${r.name} ch`;
      const out = channels.map((ch) => {
        const existing = linked(r).find((c: Any) => c.channel === ch);
        if (existing) return existing;
        const c = {
          id: nextId(db.master.cameras),
          storeId: r.storeId,
          name: `${prefix} ${ch}`.slice(0, 150),
          type: b['type'] ?? 'GENERAL',
          rtspUrl: `rtsp://${r.username}:****@${r.host}:${r.rtspPort}/ch${ch}`,
          status: 'UNKNOWN',
          lastHeartbeatAt: null,
          isActive: true,
          recorderId: r.id,
          channel: ch,
          streamProfile: r.stream ?? 'SUB',
        };
        db.master.cameras.push(c);
        return c;
      });
      this.audit(u, 'CREATE', 'cameras', null, { method: 'POST', path: `/api/recorders/${r.id}/generate-cameras`, body: { channels } });
      return created(out);
    });
    this.on('POST', '/recorders/:id/test', async (req, m, u) => {
      this.requireRole(u, RECORDER_WRITERS);
      const r = findRec(u, m[1]);
      const asked = ((bodyOf(req)['channels'] as number[]) ?? []).map(Number);
      const list = asked.length ? [...new Set(asked)] : Array.from({ length: r.channels }, (_, i) => i + 1);
      const bad = list.filter((ch) => !(ch >= 1 && ch <= r.channels));
      if (bad.length) fail(400, `channel numbers must be ≤ ${r.channels} (got ${bad.join(', ')})`);
      const cams = new Map<number, number>(linked(r).map((c: Any) => [c.channel, c.id]));
      const out = await startProbes(list.map((ch) => ({ storeId: r.storeId, cameraId: cams.get(ch) ?? null, recorderId: r.id, channel: ch, fail: r.channels >= 2 && ch === r.channels })));
      return created(out.map(probeView));
    });
    this.on('POST', '/cameras/:id/test', async (_r, m, u) => {
      this.requireRole(u, RECORDER_WRITERS);
      const c = db.master.cameras.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Camera not found');
      if (!this.scope(u).includes(c.storeId)) fail(404, 'Camera not found');
      const r = c.recorderId ? recs().find((x: Any) => x.id === c.recorderId) : null;
      if (!r && !c.rtspUrl) fail(400, 'The camera has no RTSP URL and is not linked to a recorder');
      const [p] = await startProbes([{ storeId: c.storeId, cameraId: c.id, recorderId: r?.id ?? null, channel: c.channel ?? null, fail: !!r && r.channels >= 2 && c.channel === r.channels }]);
      return created(probeView(p));
    });
    this.on('GET', '/probes', (req, _m, u) => {
      settle();
      const rid = Number(req.params.get('recorderId')) || null;
      const cid = Number(req.params.get('cameraId')) || null;
      const rows = this.inScope(probes(), this.storesFor(req, u))
        .filter((p: Any) => (!rid || p.recorderId === rid) && (!cid || p.cameraId === cid))
        .sort((a: Any, b: Any) => b.requestedAt.localeCompare(a.requestedAt) || b.id - a.id)
        .slice(0, 50);
      return ok(rows.map(probeView));
    });
    this.on('GET', '/probes/:id', (_r, m, u) => {
      settle();
      const p = probes().find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Probe not found');
      if (!this.scope(u).includes(p.storeId)) fail(404, 'Probe not found');
      return ok(probeView(p));
    });
  }

  /** Generic list/create/update/delete for simple master data. */
  private crud(base: string, list: () => Any[], entity: string, writers: string[], defaults: Record<string, unknown> = {}) {
    const find = (id: string) => list().find((x: Any) => x.id === Number(id)) ?? fail(404, `${entity} not found`);
    this.on('GET', base, () => ok(list()));
    this.on('GET', `${base}/:id`, (_r, m) => ok(find(m[1])));
    this.on('POST', base, (req, _m, u) => {
      this.requireRole(u, writers);
      const x = { id: nextId(list()), ...defaults, ...bodyOf(req) };
      list().push(x);
      this.audit(u, 'CREATE', entity, x.id);
      return created(x);
    });
    this.on('PATCH', `${base}/:id`, (req, m, u) => {
      this.requireRole(u, writers);
      const x = find(m[1]);
      const before = { ...x };
      Object.assign(x, bodyOf(req));
      this.audit(u, 'UPDATE', entity, x.id, auditDetails('PATCH', `/api${base}/${x.id}`, bodyOf(req), before, x));
      return ok(x);
    });
    this.on('DELETE', `${base}/:id`, (_r, m, u) => {
      this.requireRole(u, writers);
      const arr = list();
      const idx = arr.findIndex((x: Any) => x.id === Number(m[1]));
      if (idx < 0) fail(404, `${entity} not found`);
      const [gone] = arr.splice(idx, 1);
      this.audit(u, 'DELETE', entity, Number(m[1]), { method: 'DELETE', path: `/api${base}/${m[1]}`, before: gone });
      return ok({ ok: true });
    });
  }

  private createTask(u: Any, b: Record<string, any>): Any {
    const t = {
      id: nextId(this.db.ops.tasks),
      title: b['title'],
      description: b['description'] ?? null,
      storeId: b['storeId'],
      storeName: this.storeName(b['storeId']),
      zoneId: b['zoneId'] ?? null,
      type: b['type'] ?? 'GENERAL',
      priority: b['priority'] ?? 'MEDIUM',
      status: 'TODO',
      assigneeId: b['assigneeId'] ?? null,
      assigneeName: this.userName(b['assigneeId'] ?? null),
      createdById: u.id,
      createdByName: u.name,
      dueAt: b['dueAt'] ?? null,
      startAt: b['startAt'] ?? null,
      completedAt: null,
      verifiedAt: null,
      createdAt: nowIso(),
      checklistAnswerId: b['checklistAnswerId'] ?? null,
      proofUrl: null,
      remark: null,
    };
    this.db.ops.tasks.unshift(t);
    if (t.assigneeId && t.assigneeId !== u.id) this.notify(t.assigneeId, `New task: ${t.title}`, `${t.storeName ?? ''} · assigned by ${u.name}`, '/tasks');
    return t;
  }

  private createTicket(u: Any, b: Record<string, any>): Any {
    const id = nextId(this.db.ops.tickets);
    const priority = b['priority'] ?? 'MEDIUM';
    const t = {
      id,
      number: `TKT-${String(id).padStart(5, '0')}`,
      title: b['title'],
      description: b['description'] ?? null,
      storeId: b['storeId'],
      storeName: this.storeName(b['storeId']),
      category: b['category'] ?? 'OTHER',
      priority,
      status: 'OPEN',
      assigneeId: b['assigneeId'] ?? null,
      assigneeName: this.userName(b['assigneeId'] ?? null),
      reporterId: u.id,
      reporterName: u.name,
      alertId: b['alertId'] ?? null,
      slaDueAt: new Date(Date.now() + (SLA_HOURS[priority] ?? 72) * 3_600_000).toISOString(),
      resolvedAt: null,
      createdAt: nowIso(),
      isSlaBreached: false,
    };
    this.db.ops.tickets.unshift(t);
    this.db.ops.ticketDetails[id] = { ...t, comments: [] };
    return t;
  }

  // ---------------------------------------------------------------- checklists
  private registerChecklists(): void {
    const db = this.db;
    const tpl = (id: number) => db.trax.templates.find((t: Any) => t.id === id);
    const decorateAssignment = (a: Any) => ({ ...a, templateName: tpl(a.templateId)?.name ?? a.templateName });

    this.on('GET', '/checklists/templates', async () => {
      await db.ensureTrax();
      return ok(db.trax.templates);
    });
    this.on('GET', '/checklists/templates/:id', async (_r, m) => {
      await db.ensureTrax();
      return ok(tpl(Number(m[1])) ?? fail(404, 'Template not found'));
    });
    const withQuestionIds = (qs: Any[]) => {
      let next = Math.max(0, ...db.trax.templates.flatMap((t: Any) => t.questions.map((q: Any) => q.id ?? 0))) + 1;
      return (qs ?? []).map((q: Any, i: number) => ({ ...q, id: q.id ?? next++, sortOrder: q.sortOrder ?? i }));
    };
    const TEMPLATE_WRITERS = ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'AUDITOR'];
    /** Contract v4: MCQ questions need at least two distinct options. */
    const checkQuestions = (qs: Any[] | undefined) => {
      const bad = (qs ?? []).filter((q: Any) => (q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') && new Set((q.options ?? []).map((o: unknown) => String(o).trim()).filter(Boolean)).size < 2);
      if (bad.length) fail(400, `Multiple-choice questions need at least 2 distinct options: ${bad.map((q: Any) => `"${q.text}"`).join(', ')}`);
    };
    this.on('POST', '/checklists/templates', async (req, _m, u) => {
      this.requireRole(u, TEMPLATE_WRITERS);
      await db.ensureTrax();
      const b = bodyOf(req);
      checkQuestions(b['questions']);
      const t = { id: nextId(db.trax.templates), createdAt: nowIso(), isActive: true, ...b, version: 1, questions: withQuestionIds(b['questions']) };
      db.trax.templates.push(t);
      this.audit(u, 'CREATE', 'checklist_template', t.id);
      return created(t);
    });
    this.on('PUT', '/checklists/templates/:id', async (req, m, u) => {
      this.requireRole(u, TEMPLATE_WRITERS);
      await db.ensureTrax();
      const t = tpl(Number(m[1])) ?? fail(404, 'Template not found');
      const b = bodyOf(req);
      checkQuestions(b['questions']);
      // contract v4: +1 on every PUT; earlier submissions keep the snapshot they were answered against
      Object.assign(t, b, { version: (Number(t.version) || 1) + 1, questions: withQuestionIds(b['questions']) });
      this.audit(u, 'UPDATE', 'checklist_template', t.id);
      return ok(t);
    });
    this.on('DELETE', '/checklists/templates/:id', async (_r, m, u) => {
      this.requireRole(u, TEMPLATE_WRITERS);
      await db.ensureTrax();
      db.trax.templates = db.trax.templates.filter((t: Any) => t.id !== Number(m[1]));
      return ok({ ok: true });
    });

    // schedules
    this.on('GET', '/checklists/schedules', async () => {
      await db.ensureTrax();
      return ok(db.trax.schedules);
    });
    const checkSchedule = (b: Record<string, any>) => {
      const errs: string[] = [];
      const realDate = (d: unknown) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && new Date(`${d}T00:00:00Z`).toISOString().slice(0, 10) === d;
      if ('repeatEvery' in b && !(Number(b['repeatEvery']) >= 1)) errs.push('repeatEvery must not be less than 1');
      if (b['frequency'] === 'WEEKLY' && !(b['daysOfWeek'] ?? []).length) errs.push('daysOfWeek: pick at least one day for a weekly schedule');
      if ('storeIds' in b && !(b['storeIds'] ?? []).length) errs.push('storeIds must contain at least 1 elements');
      if (b['windowStart'] && b['windowEnd'] && String(b['windowEnd']) <= String(b['windowStart'])) errs.push('windowEnd must be after windowStart');
      for (const k of ['startDate', 'endDate']) if (b[k] && !realDate(b[k])) errs.push(`${k} must be a real calendar date`);
      if (b['endDate'] && String(b['endDate']) < db.today) errs.push('endDate is already in the past');
      if (errs.length) fail(400, errs.join('. '));
    };
    this.on('POST', '/checklists/schedules', async (req, _m, u) => {
      await db.ensureTrax();
      const b = bodyOf(req);
      checkSchedule(b);
      if (b['assigneeId']) for (const sid of b['storeIds'] ?? []) this.checkAssignee(b['assigneeId'], sid);
      const s = { id: nextId(db.trax.schedules), lastGeneratedDate: null, ...b, templateName: tpl(b['templateId'])?.name ?? null };
      db.trax.schedules.push(s);
      return created(s);
    });
    this.on('PATCH', '/checklists/schedules/:id', async (req, m) => {
      await db.ensureTrax();
      const s = db.trax.schedules.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Schedule not found');
      checkSchedule({ frequency: s.frequency, daysOfWeek: s.daysOfWeek, ...bodyOf(req) });
      Object.assign(s, bodyOf(req));
      s.templateName = tpl(s.templateId)?.name ?? s.templateName;
      return ok(s);
    });
    this.on('DELETE', '/checklists/schedules/:id', async (_r, m) => {
      await db.ensureTrax();
      db.trax.schedules = db.trax.schedules.filter((x: Any) => x.id !== Number(m[1]));
      return ok({ ok: true });
    });
    this.on('POST', '/checklists/schedules/:id/generate', async (_r, m) => {
      await db.ensureTrax();
      const s = db.trax.schedules.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Schedule not found');
      let createdCount = 0;
      for (const storeId of s.storeIds ?? []) {
        if (db.trax.assignments.some((a: Any) => a.templateId === s.templateId && a.storeId === storeId && a.dueDate === db.today && a.scheduleId === s.id)) continue;
        const assignee = s.assigneeId ?? this.managerOf(storeId)?.id;
        const [h, mm] = String(s.windowEnd ?? '23:59').split(':').map(Number);
        const due = new Date();
        due.setHours(h, mm, 0, 0);
        db.trax.assignments.unshift({
          id: nextId(db.trax.assignments),
          templateId: s.templateId,
          templateName: s.templateName,
          storeId,
          storeName: this.storeName(storeId),
          assigneeId: assignee,
          assigneeName: this.userName(assignee),
          dueDate: db.today,
          dueAt: due.toISOString(),
          windowStart: null,
          scheduleId: s.id,
          status: 'PENDING',
          submissionId: null,
        });
        createdCount++;
      }
      s.lastGeneratedDate = db.today;
      return created({ created: createdCount });
    });
    this.on('POST', '/checklists/nudges/run', async (_r, _m, u) => {
      this.requireRole(u, ADMINS);
      await db.ensureTrax();
      const pending = db.trax.assignments.filter((a: Any) => a.dueDate === db.today && ['PENDING', 'IN_PROGRESS'].includes(a.status));
      for (const a of pending.slice(0, 20)) this.notify(a.assigneeId, `Reminder: ${a.templateName}`, `${a.templateName} at ${a.storeName} is due today`, `/checklists/assignments/${a.id}`);
      return created({ reminders: Math.min(20, pending.length), overdue: 0 });
    });

    // assignments
    this.on('GET', '/checklists/assignments', async (req, _m, u) => {
      await db.ensureTrax();
      const mine = req.params.get('mine') === 'true';
      const st = req.params.get('status');
      return ok(
        this.inScope(db.trax.assignments, this.storesFor(req, u))
          .filter((a: Any) => (!mine || a.assigneeId === u.id) && (!st || a.status === st))
          .map(decorateAssignment),
      );
    });
    const assignmentById = async (id: string) => {
      await db.ensureTrax();
      return db.trax.assignments.find((a: Any) => a.id === Number(id)) ?? fail(404, 'Assignment not found');
    };
    this.on('GET', '/checklists/assignments/:id', async (_r, m) => {
      const a = await assignmentById(m[1]);
      return ok({ ...decorateAssignment(a), template: tpl(a.templateId), draftAnswers: db.trax.drafts.get(a.id) ?? null });
    });
    this.on('POST', '/checklists/assignments', async (req, _m, u) => {
      this.requireRole(u, ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR']);
      await db.ensureTrax();
      const b = bodyOf(req);
      this.checkAssignee(b['assigneeId'], b['storeId']);
      const a = {
        id: nextId(db.trax.assignments),
        templateId: b['templateId'],
        templateName: tpl(b['templateId'])?.name ?? null,
        storeId: b['storeId'],
        storeName: this.storeName(b['storeId']),
        assigneeId: b['assigneeId'],
        assigneeName: this.userName(b['assigneeId']),
        dueDate: b['dueDate'],
        dueAt: null,
        windowStart: null,
        scheduleId: null,
        status: 'PENDING',
        submissionId: null,
      };
      db.trax.assignments.unshift(a);
      if (a.assigneeId !== u.id) this.notify(a.assigneeId, `New checklist: ${a.templateName}`, `${a.storeName} · due ${a.dueDate}`, `/checklists/assignments/${a.id}`);
      return created(a);
    });
    this.on('POST', '/checklists/assignments/:id/draft', async (req, m) => {
      const a = await assignmentById(m[1]);
      const merged = new Map<number, Any>((db.trax.drafts.get(a.id) ?? []).map((x: Any) => [x.questionId, x]));
      for (const x of (bodyOf(req)['answers'] as Any[]) ?? []) merged.set(x.questionId, x);
      db.trax.drafts.set(a.id, [...merged.values()]);
      if (['PENDING', 'OVERDUE', 'REDO'].includes(a.status)) a.status = 'IN_PROGRESS';
      return created({ ...decorateAssignment(a), draftAnswers: db.trax.drafts.get(a.id) });
    });

    // submissions
    this.on('GET', '/checklists/submissions', async (req, _m, u) => {
      await db.ensureTrax();
      const templateId = Number(req.params.get('templateId')) || null;
      return ok(
        this.inScope(db.trax.submissions, this.storesFor(req, u)).filter(
          (s: Any) => (!templateId || s.templateId === templateId) && inDateRange(s.submittedAt, req.params.get('from'), req.params.get('to')),
        ),
      );
    });
    this.on('GET', '/checklists/submissions/:id', async (_r, m) => {
      await db.ensureTrax();
      const s = db.trax.submissions.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Submission not found');
      return ok({ ...s, answers: db.trax.answers.get(s.id) ?? [], template: this.templateSnapshots.get(s.id) ?? tpl(s.templateId) });
    });
    this.on('POST', '/checklists/submissions', async (req, _m, u) => {
      await db.ensureTrax();
      await db.ensureOps();
      return created(this.submit(u, bodyOf(req)));
    });
    this.on('PATCH', '/checklists/submissions/:id/review', async (req, m, u) => {
      this.requireRole(u, ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR']);
      await db.ensureTrax();
      const s = db.trax.submissions.find((x: Any) => x.id === Number(m[1])) ?? fail(404, 'Submission not found');
      const b = bodyOf(req);
      s.status = b['status'];
      s.reviewerComment = b['comment'] ?? null;
      const redo = new Set<number>((b['redoQuestionIds'] as number[]) ?? []);
      for (const a of db.trax.answers.get(s.id) ?? []) a.redo = redo.has(a.questionId);
      const asg = db.trax.assignments.find((a: Any) => a.id === s.assignmentId);
      if (asg) asg.status = b['status'] === 'REDO' ? 'REDO' : 'APPROVED';
      if (asg && b['status'] === 'REDO') this.notify(asg.assigneeId, `Redo requested: ${s.templateName}`, b['comment'] ?? 'Please redo the flagged questions', `/checklists/assignments/${asg.id}`);
      return ok(s);
    });
    this.on('POST', '/checklists/answers/:id/task', async (req, m, u) => {
      this.requireRole(u, SM_PLUS);
      await db.ensureTrax();
      await db.ensureOps();
      const answerId = Number(m[1]);
      let sub: Any = null;
      for (const [sid, answers] of db.trax.answers) if (answers.some((a: Any) => a.id === answerId)) sub = db.trax.submissions.find((s: Any) => s.id === sid);
      if (!sub) fail(404, 'Answer not found');
      const b = bodyOf(req);
      return created(this.createTask(u, { ...b, type: 'FOLLOW_UP', storeId: sub.storeId, checklistAnswerId: answerId, priority: b['priority'] ?? 'HIGH', title: b['title'] || `Follow-up: ${sub.templateName}` }));
    });
    this.on('POST', '/checklists/ai-check', (req) => ok(this.aiCheck(bodyOf(req))));
  }

  /** Deterministic AI verdicts for the demo: filename 'fail'/'pass' wins, else PASS then FAIL alternately. */
  private aiCheck(b: Record<string, any>): Any {
    const file = b['image'] as File | undefined;
    const name = (file?.name ?? '').toLowerCase();
    const type = b['type'] === 'UNIFORM' ? 'UNIFORM' : 'REFERENCE_MATCH';
    const n = this.db.aiCheckCount++;
    const pass = name.includes('fail') ? false : name.includes('pass') ? true : n % 2 === 0;
    const annotatedUrl = file ? URL.createObjectURL(file) : null;
    const uploadedUrl = file ? this.db.uploadsByFile.get(fileKey(file)) : undefined;
    const remember = (r: Any) => {
      if (uploadedUrl) this.db.lastAiByPhoto.set(uploadedUrl, { ...r, annotatedUrl: uploadedUrl });
      return r;
    };
    if (pass) {
      return remember({
        status: 'PASS',
        score: type === 'UNIFORM' ? 0.91 : 0.88,
        message: type === 'UNIFORM' ? 'Groomed: uniform and name badge detected' : 'Matches the approved reference image',
        issues: [],
        annotatedUrl,
      });
    }
    return remember({
      status: 'FAIL',
      score: type === 'UNIFORM' ? 0.42 : 0.37,
      message: type === 'UNIFORM' ? 'Not groomed: name badge missing' : 'Does not match the approved reference',
      issues: type === 'UNIFORM' ? ['name badge missing', 'uniform colour mismatch'] : ['campaign banner missing', 'price tags differ from reference'],
      annotatedUrl,
    });
  }

  private submit(u: Any, b: Record<string, any>): Any {
    const db = this.db;
    const template = db.trax.templates.find((t: Any) => t.id === b['templateId']) ?? fail(400, 'Unknown template');
    const list = (b['answers'] as Any[]) ?? [];
    const inputs = new Map<number, Any>(list.map((a) => [a.questionId, a]));
    // contract v4: answers are validated before scoring (400 with the question ids)
    const qs = template.questions as Question[];
    const has = (v: unknown) => String(v ?? '').trim() !== '';
    const missing = qs.filter((q) => q.required && !has(inputs.get(q.id!)?.value) && !has(inputs.get(q.id!)?.photoUrl)).map((q) => q.id!);
    if (missing.length) throw new DemoError(400, `Required questions are not answered: ${missing.join(', ')}`, { missingQuestionIds: missing });
    const bad: { questionId: number; reason: string }[] = [];
    if (new Set(list.map((a) => a.questionId)).size !== list.length) for (const id of new Set(list.map((a) => a.questionId).filter((id, i, arr) => arr.indexOf(id) !== i))) bad.push({ questionId: id, reason: 'answered twice' });
    for (const q of qs) {
      const a = inputs.get(q.id!);
      if (!a) continue;
      const v = String(a.value ?? '').trim();
      const options = (q.options ?? []).map(String);
      if (v) {
        if (q.type === 'YES_NO' && !['YES', 'NO'].includes(v.toUpperCase())) bad.push({ questionId: q.id!, reason: 'must be YES or NO' });
        if (q.type === 'MCQ_SINGLE' && options.length && !options.includes(v)) bad.push({ questionId: q.id!, reason: 'not one of the options' });
        if (q.type === 'MCQ_MULTI' && options.length && parseMulti(v).some((c) => !options.includes(c))) bad.push({ questionId: q.id!, reason: 'not one of the options' });
        if (q.type === 'NUMBER' && !Number.isFinite(Number(v))) bad.push({ questionId: q.id!, reason: 'must be a number' });
        if (q.type === 'RATING' && !(Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 5)) bad.push({ questionId: q.id!, reason: 'must be a rating from 0 to 5' });
      }
      const photo = has(a.photoUrl) || ((q.type === 'PHOTO' || q.type === 'VIDEO') && !!v);
      if (q.requiresPhoto && (v || q.required) && !photo) bad.push({ questionId: q.id!, reason: 'photo required' });
    }
    if (bad.length) throw new DemoError(400, `Invalid answers: ${bad.map((x) => `question ${x.questionId} ${x.reason}`).join('; ')}`, { invalidAnswers: bad });
    const subId = nextId(db.trax.submissions);
    let answerId = Math.max(0, ...[...db.trax.answers.values()].flat().map((a: Any) => a.id)) + 1;
    let score = 0;
    let maxScore = 0;
    let flags = 0;
    const answers: Any[] = [];
    const followUps: Any[] = [];
    for (const q of template.questions as Question[]) {
      const a = inputs.get(q.id!) ?? { value: '' };
      const w = Number(q.weight) || 0;
      maxScore += w;
      let s = scoreAnswer(q, a.value, a.photoUrl);
      let aiResult: Any = null;
      if (q.aiCheck && q.aiCheck !== 'NONE' && a.photoUrl) {
        aiResult = db.lastAiByPhoto.get(a.photoUrl) ?? { status: 'PASS', score: 0.9, message: 'Checked by AI (demo)', issues: [] };
        if (aiResult.status === 'FAIL') s = 0;
      }
      const answered = String(a.value ?? '').trim() !== '' || !!a.photoUrl;
      const flagged =
        (q.type === 'YES_NO' && String(a.value).toUpperCase() === 'NO') ||
        ((q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI' || q.type === 'NUMBER') && answered && s === 0) ||
        aiResult?.status === 'FAIL';
      if (flagged) flags++;
      score += s;
      const ans = { id: answerId++, questionId: q.id, value: a.value ?? '', photoUrl: a.photoUrl ?? null, remark: a.remark ?? null, score: Math.round(s * 100) / 100, maxScore: w, redo: false, aiResult, flagged };
      answers.push(ans);
      if (flagged && q.createTaskOnFail) followUps.push({ q, ans });
    }
    const sub = {
      id: subId,
      assignmentId: b['assignmentId'] ?? null,
      templateId: template.id,
      templateName: template.name,
      storeId: b['storeId'],
      storeName: this.storeName(b['storeId']),
      submittedById: u.id,
      submittedByName: u.name,
      submittedAt: nowIso(),
      score: Math.round(score * 100) / 100,
      maxScore,
      scorePct: maxScore ? Math.round((score / maxScore) * 10000) / 100 : 0,
      status: 'SUBMITTED',
      reviewerComment: null,
      flags,
      templateVersion: Number(template.version) || 1,
      isLate: false,
    };
    const due = db.trax.assignments.find((a: Any) => a.id === b['assignmentId'])?.dueAt;
    sub.isLate = !!due && Date.parse(sub.submittedAt) > Date.parse(due);
    this.templateSnapshots.set(subId, JSON.parse(JSON.stringify(template)));
    db.trax.submissions.unshift(sub);
    db.trax.answers.set(subId, answers);
    const asg = db.trax.assignments.find((a: Any) => a.id === b['assignmentId']);
    if (asg) {
      asg.status = 'SUBMITTED';
      asg.submissionId = subId;
      db.trax.drafts.delete(asg.id);
    }
    for (const { q, ans } of followUps) {
      this.createTask(u, {
        title: `Fix: ${q.text}`.slice(0, 200),
        description: `Flagged in "${template.name}" submission #${subId}`,
        storeId: sub.storeId,
        type: 'FOLLOW_UP',
        priority: 'HIGH',
        assigneeId: this.managerOf(sub.storeId)?.id ?? null,
        dueAt: new Date(Date.now() + 24 * 3_600_000).toISOString(),
        checklistAnswerId: ans.id,
      });
    }
    return sub;
  }

  // ---------------------------------------------------------------- reports
  private async exportReport(req: DemoRequest, u: Any): Promise<DemoResponse> {
    const db = this.db;
    const type = req.params.get('type') ?? 'traffic';
    const format = req.params.get('format') ?? 'csv';
    const from = req.params.get('from') ?? db.today;
    const to = req.params.get('to') ?? db.today;
    const bundle = await db.analytics(this.preset(req));
    const { key, stores } = this.analyticsScope(req, u);
    const a = bundle[key] ?? bundle.all;
    let rows: Record<string, unknown>[] = [];
    switch (type) {
      case 'traffic':
        rows = a.traffic.daily;
        break;
      case 'zones':
        rows = a.zones.map(({ genderSplit, ...z }: Any) => ({ ...z, malePct: genderSplit?.malePct, femalePct: genderSplit?.femalePct }));
        break;
      case 'conversion':
        rows = a.conversion.daily;
        break;
      case 'queue':
        rows = a.queue.byCounter;
        break;
      case 'storeops':
        rows = a.storeops.openClose;
        break;
      case 'benchmark':
        rows = a.benchmark;
        break;
      case 'checklists':
        await db.ensureTrax();
        rows = db.trax.submissions.filter((s: Any) => stores.includes(s.storeId) && inDateRange(s.submittedAt, from, to));
        break;
      case 'alerts':
        await db.ensureOps();
        rows = db.ops.alerts.filter((x: Any) => stores.includes(x.storeId) && inDateRange(x.createdAt, from, to));
        break;
      case 'tasks':
        await db.ensureOps();
        rows = db.ops.tasks.filter((x: Any) => stores.includes(x.storeId));
        break;
      case 'tickets':
        await db.ensureOps();
        rows = db.ops.tickets.filter((x: Any) => stores.includes(x.storeId));
        break;
    }
    const csv = '﻿' + toCsvText(rows ?? []);
    const filename = `${type}_${from}_${to}.${format}`;
    const blob = new Blob([csv], { type: format === 'xlsx' ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv' });
    return ok(blob, { 'Content-Disposition': `attachment; filename="${filename}"`, 'X-Demo-Format': 'csv' });
  }
}
