#!/usr/bin/env node
/**
 * Captures real API responses from the backend into src/demo-data/*.json for the
 * no-backend online demo (`npm run build:demo`).
 *
 * - Starts backend/dist/main.js on a COPY of backend/data/dev.sqlite and a COPY of backend/uploads
 *   (DB_TYPE=sqlite, DISABLE_CRON=true), so the real data is never modified.
 * - Logs in as each seed role and records analytics (5 date presets × all stores + each store),
 *   full entity lists, per-role lists and /auth/me.
 * - Rewrites '/uploads/' → 'uploads/' and packs the referenced images into base64 JSON media packs
 *   (the demo turns them into blob: URLs on demand); the READY recap mp4 is copied as a file.
 *
 * Usage: node scripts/capture-demo-data.mjs   (from frontend/; backend must be built: backend/dist/main.js)
 */
import { spawn } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const BACKEND = resolve(FRONTEND, '../backend');
const OUT = join(FRONTEND, 'src/demo-data');
const PORT = Number(process.env.CAPTURE_PORT || 3901);
const BASE = `http://127.0.0.1:${PORT}/api`;
const PASSWORD = 'Password@123';
const ROLES = {
  admin: 'admin@congruence.in',
  regional: 'regional@congruence.in',
  manager: 'manager.tnagar@congruence.in',
  auditor: 'auditor@congruence.in',
  staff: 'staff.tnagar@congruence.in',
};
const MAX_IMAGES = Number(process.env.DEMO_MAX_IMAGES || 320);
const PACK_BYTES = 3.5 * 1024 * 1024; // raw bytes per media pack (base64 ≈ ×1.34)

// ---------------------------------------------------------------- helpers
const log = (...a) => console.log('[capture]', ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
/** Store-local (Asia/Kolkata) calendar date. */
function localDate(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}
function addDays(iso, n) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + n));
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}
function qs(o) {
  const parts = [];
  for (const [k, v] of Object.entries(o ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    parts.push(`${k}=${encodeURIComponent(Array.isArray(v) ? v.join(',') : String(v))}`);
  }
  return parts.length ? '?' + parts.join('&') : '';
}
async function pool(items, n, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: n }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx], idx);
      }
    }),
  );
  return out;
}

// ---------------------------------------------------------------- backend
const work = mkdtempSync(join(tmpdir(), 'ce-capture-'));
const dbCopy = join(work, 'dev.sqlite');
const uploadsCopy = join(work, 'uploads');
log('copying DB and uploads to', work);
cpSync(join(BACKEND, 'data/dev.sqlite'), dbCopy);
cpSync(join(BACKEND, 'uploads'), uploadsCopy, { recursive: true });

const proc = spawn(process.execPath, ['dist/main.js'], {
  cwd: BACKEND,
  env: { ...process.env, DB_TYPE: 'sqlite', DB_PATH: dbCopy, UPLOAD_DIR: uploadsCopy, DISABLE_CRON: 'true', PORT: String(PORT), HOST: '127.0.0.1' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let backendLog = '';
proc.stdout.on('data', (d) => (backendLog += d));
proc.stderr.on('data', (d) => (backendLog += d));
const cleanup = () => {
  try {
    proc.kill();
  } catch {}
  try {
    rmSync(work, { recursive: true, force: true });
  } catch {}
};
process.on('exit', cleanup);

for (let i = 0; ; i++) {
  try {
    const r = await fetch(`${BASE}/health`);
    if (r.ok) break;
  } catch {}
  if (i > 60) {
    console.error(backendLog.slice(-3000));
    throw new Error('backend did not start');
  }
  await sleep(500);
}
log('backend up on', PORT);

const tokens = {};
const users = {};
for (const [role, email] of Object.entries(ROLES)) {
  const r = await fetch(`${BASE}/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password: PASSWORD }) });
  if (!r.ok) throw new Error(`login ${email} failed ${r.status}`);
  const j = await r.json();
  tokens[role] = j.accessToken;
  users[role] = j.user;
}

let calls = 0;
async function get(path, role = 'admin', { allowFail = false } = {}) {
  calls++;
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${tokens[role]}` } });
  if (!r.ok) {
    if (allowFail) return { __status: r.status };
    throw new Error(`GET ${path} as ${role} → ${r.status} ${await r.text()}`);
  }
  return r.json();
}
async function getBinary(path) {
  const r = await fetch(BASE + path, { headers: { Authorization: `Bearer ${tokens.admin}` } });
  // 204: the camera has no snapshot yet (contract v4) — nothing to pack, the demo answers 204 too
  if (!r.ok || r.status === 204) return null;
  const buf = Buffer.from(await r.arrayBuffer());
  return buf.length ? { type: r.headers.get('content-type') || 'image/jpeg', buf } : null;
}

// ---------------------------------------------------------------- presets
const captureDate = localDate();
const firstOfMonth = captureDate.slice(0, 8) + '01';
const PRESETS = {
  today: { from: captureDate, to: captureDate },
  yesterday: { from: addDays(captureDate, -1), to: addDays(captureDate, -1) },
  last7: { from: addDays(captureDate, -6), to: captureDate },
  last30: { from: addDays(captureDate, -29), to: captureDate },
  thisMonth: { from: firstOfMonth, to: captureDate },
};

// ---------------------------------------------------------------- master data
log('master data');
const stores = await get('/stores');
const storeIds = stores.map((s) => s.id);
const storeDetails = {};
for (const s of stores) storeDetails[s.id] = await get(`/stores/${s.id}`);
const cameras = (await Promise.all(storeIds.map((id) => get(`/cameras${qs({ storeId: id })}`)))).flat();
const zones = (await Promise.all(storeIds.map((id) => get(`/zones${qs({ storeId: id })}`)))).flat();

const master = {
  users: await get('/users'),
  regions: await get('/regions'),
  stores,
  storeDetails,
  cameras,
  zones,
  edgeDevices: await get('/edge-devices'),
  staff: await get('/staff'),
  settings: await get('/settings'),
  alertRules: await get('/alert-rules'),
  reportSchedules: await get('/reports/schedules'),
  // contract v3: recorders, their connection probes and LAN discovery (per store)
  recorderBrands: await get('/recorders/brands'),
  recorders: (await Promise.all(storeIds.map((id) => get(`/recorders${qs({ storeId: id })}`)))).flat(),
  probes: (await Promise.all(storeIds.map((id) => get(`/probes${qs({ storeId: id })}`)))).flat(),
  discovered: Object.fromEntries(await Promise.all(storeIds.map(async (id) => [id, await get(`/recorders/discovered${qs({ storeId: id })}`)]))),
};

// ---------------------------------------------------------------- per-role data
log('per-role data');
const roles = {};
for (const role of Object.keys(ROLES)) {
  const u = users[role];
  const usersRes = await get('/users', role, { allowFail: true });
  roles[role] = {
    email: ROLES[role],
    me: await get('/auth/me', role),
    stores: (await get('/stores', role)).map((s) => s.id),
    canListUsers: !usersRes.__status,
    notifications: await get('/notifications', role),
    myTaskIds: (await get('/tasks?mine=true', role, { allowFail: true })).map?.((t) => t.id) ?? [],
    myAssignmentIds: (await get('/checklists/assignments?mine=true', role, { allowFail: true })).map?.((a) => a.id) ?? [],
    userId: u.id,
  };
}

// ---------------------------------------------------------------- operations / trax / ai
log('operations');
const alertsPaged = await get('/alerts?page=1&pageSize=500');
const tickets = await get('/tickets');
const ticketDetails = {};
await pool(tickets, 6, async (t) => (ticketDetails[t.id] = await get(`/tickets/${t.id}`)));
const ops = {
  alerts: alertsPaged.items,
  tasks: await get('/tasks'),
  tickets,
  ticketDetails,
  documents: await get('/documents'),
  vendors: await get('/vendors'),
  visits: await get('/vendor-visits'),
};

log('trax');
const assignments = await get('/checklists/assignments');
const draftAssignments = {};
for (const a of assignments.filter((x) => x.status === 'IN_PROGRESS')) {
  const d = await get(`/checklists/assignments/${a.id}`);
  draftAssignments[a.id] = d.draftAnswers ?? [];
}
const submissions = await get(`/checklists/submissions${qs({ from: PRESETS.last30.from, to: PRESETS.last30.to })}`);
const sorted = [...submissions].sort((a, b) => (b.submittedAt || '').localeCompare(a.submittedAt || ''));
const detailIds = new Set(sorted.slice(0, 220).map((s) => s.id));
for (const s of submissions) if (s.flags > 0 && detailIds.size < 300) detailIds.add(s.id);
const submissionAnswers = {};
await pool([...detailIds], 6, async (id) => {
  const d = await get(`/checklists/submissions/${id}`);
  submissionAnswers[id] = d.answers ?? [];
});
const trax = {
  templates: await get('/checklists/templates'),
  schedules: await get('/checklists/schedules'),
  assignments,
  draftAssignments,
  submissions,
  submissionAnswers,
};

log('ai manager / media lists');
const detections = (await Promise.all(storeIds.map((id) => get(`/ai-manager/detections${qs({ storeIds: [id], page: 1, pageSize: 50, from: PRESETS.last30.from, to: PRESETS.last30.to })}`)))).flatMap((p) => p.items);
const imageDirectory = (
  await Promise.all(
    storeIds.map(async (id) => {
      const recent = await get(`/image-directory${qs({ storeIds: [id], page: 1, pageSize: 18 })}`);
      const kinds = await Promise.all(['OPENING', 'CLOSING', 'EVENT', 'AI_MANAGER', 'REFERENCE'].map((k) => get(`/image-directory${qs({ storeIds: [id], kind: k, page: 1, pageSize: 2 })}`)));
      return [...recent.items, ...kinds.flatMap((k) => k.items)];
    }),
  )
).flat();
const seen = new Set();
const ai = {
  rules: await get('/ai-manager/rules'),
  detections,
  imageDirectory: imageDirectory.filter((i) => (seen.has(i.id) ? false : seen.add(i.id))),
  recaps: await get(`/recaps${qs({ from: addDays(captureDate, -60), to: captureDate })}`),
};

log('misc');
const misc = {
  posTransactions: (await get('/pos/transactions?page=1&pageSize=500')).items,
  auditLogs: (await get('/audit-logs?page=1&pageSize=300')).items,
};

// ---------------------------------------------------------------- analytics
log('analytics');
const SCOPES = ['all', ...storeIds.map(String)];
const analytics = {};
const heatmap = {};
const journey = {};
for (const [preset, range] of Object.entries(PRESETS)) {
  analytics[preset] = {};
  heatmap[preset] = {};
  journey[preset] = {};
  await pool(SCOPES, 3, async (scope) => {
    const p = { ...range, storeIds: scope === 'all' ? undefined : [Number(scope)] };
    const ep = async (path, extra = {}) => get(`${path}${qs({ ...p, ...extra })}`);
    analytics[preset][scope] = {
      overview: await ep('/analytics/overview'),
      overviewCompare: await ep('/analytics/overview', { compare: true }),
      traffic: await ep('/analytics/traffic'),
      trafficDensity: await ep('/analytics/traffic-density'),
      demographics: await ep('/analytics/demographics'),
      zones: await ep('/analytics/zones'),
      conversion: await ep('/analytics/conversion'),
      queue: await ep('/analytics/queue'),
      storeops: await ep('/analytics/storeops'),
      benchmark: await ep('/analytics/benchmark'),
      benchmarkCompare: await ep('/analytics/benchmark', { compare: true }),
      groups: {
        region: await ep('/analytics/benchmark/groups', { groupBy: 'region' }),
        format: await ep('/analytics/benchmark/groups', { groupBy: 'format' }),
        city: await ep('/analytics/benchmark/groups', { groupBy: 'city' }),
      },
      aiSummary: await ep('/ai-manager/summary'),
      openClose: await ep('/ai-manager/open-close'),
      traxDashboard: await ep('/checklists/dashboard'),
      compliance: await ep('/checklists/compliance'),
    };
    journey[preset][scope] =
      scope === 'all' ? await get(`/analytics/journey${qs({ ...range, storeIds })}`) : await get(`/analytics/journey${qs({ ...range, storeId: Number(scope) })}`);
  });
  await pool(cameras, 6, async (c) => {
    heatmap[preset][c.id] = await get(`/analytics/heatmap${qs({ ...range, storeId: c.storeId, cameraId: c.id })}`);
  });
  log('  preset', preset, 'done');
}
const live = {};
for (const id of storeIds) live[id] = await get(`/analytics/live?storeId=${id}`);
const infra = { all: await get('/infra/health') };
for (const id of storeIds) infra[id] = await get(`/infra/health?storeIds=${id}`);

// ---------------------------------------------------------------- media
log('media');
/** Rewrites '/uploads/' → 'uploads/' in every string. */
function rewriteUploads(v) {
  if (typeof v === 'string') return v.startsWith('/uploads/') ? v.slice(1) : v;
  if (Array.isArray(v)) return v.map(rewriteUploads);
  if (v && typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = rewriteUploads(x);
    return o;
  }
  return v;
}
const bundles = rewriteUploads({ master, roles, ops, trax, ai, misc, analytics, heatmap, journey, live, infra });

function collectUploads(v, out) {
  if (typeof v === 'string') {
    if (v.startsWith('uploads/')) out.add(v);
  } else if (Array.isArray(v)) v.forEach((x) => collectUploads(x, out));
  else if (v && typeof v === 'object') Object.values(v).forEach((x) => collectUploads(x, out));
  return out;
}
const isImage = (p) => /\.(jpe?g|png|webp|gif)$/i.test(p);
// priority order: checklist/reference images, open-close, recent image directory, detections, the rest
const prio = [
  ...collectUploads(bundles.trax, new Set()),
  ...collectUploads(bundles.analytics.last7, new Set()),
  ...collectUploads(bundles.analytics.today, new Set()),
  ...collectUploads(bundles.ai.imageDirectory, new Set()),
  ...collectUploads(bundles.ai.detections, new Set()),
  ...collectUploads(bundles.ops, new Set()),
  ...collectUploads(bundles, new Set()),
];
const allRefs = [...new Set(prio)];
const images = allRefs.filter(isImage).filter((p) => existsSync(join(uploadsCopy, p.slice('uploads/'.length))));
const included = images.slice(0, MAX_IMAGES);
const includedSet = new Set(included);
// fallback for images that are referenced but not packed: same store's packed snapshot, else any
const byStore = {};
for (const p of included) {
  const m = /^uploads\/snapshots\/(\d+)\//.exec(p);
  if (m) (byStore[m[1]] ??= []).push(p);
}
const fallback = {};
for (const p of allRefs.filter(isImage)) {
  if (includedSet.has(p)) continue;
  const m = /^uploads\/snapshots\/(\d+)\//.exec(p);
  const pool2 = (m && byStore[m[1]]) || included;
  if (pool2.length) fallback[p] = pool2[[...p].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 0) % pool2.length];
}
// camera snapshot endpoint: latest JPEG per camera
const snapshots = {};
for (const c of cameras) {
  const b = await getBinary(`/cameras/${c.id}/snapshot`);
  if (b) snapshots[`snapshot/camera-${c.id}`] = b;
}

mkdirSync(OUT, { recursive: true });
rmSync(join(OUT, 'media'), { recursive: true, force: true });
rmSync(join(OUT, 'uploads'), { recursive: true, force: true });
mkdirSync(join(OUT, 'media'), { recursive: true });

const mimeOf = (p) => ({ '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' })[extname(p).toLowerCase()] ?? 'application/octet-stream';
const entries = [
  ...Object.entries(snapshots).map(([k, b]) => [k, b.type.split(';')[0], b.buf]),
  ...included.map((p) => [p, mimeOf(p), readFileSync(join(uploadsCopy, p.slice('uploads/'.length)))]),
];
const packs = [];
let cur = {};
let curBytes = 0;
for (const [key, mime, buf] of entries) {
  if (curBytes + buf.length > PACK_BYTES && curBytes > 0) {
    packs.push(cur);
    cur = {};
    curBytes = 0;
  }
  cur[key] = `data:${mime};base64,${buf.toString('base64')}`;
  curBytes += buf.length;
}
if (curBytes) packs.push(cur);
const mediaIndex = { packs: packs.length, files: {}, fallback };
packs.forEach((p, i) => {
  writeFileSync(join(OUT, 'media', `pack-${i}.json`), JSON.stringify(p));
  for (const k of Object.keys(p)) mediaIndex.files[k] = i;
});
writeFileSync(join(OUT, 'media', 'index.json'), JSON.stringify(mediaIndex));

// videos: copy the READY recap(s) (≤ 6 MB each, at most 1) as real files
const videos = allRefs.filter((p) => /\.mp4$/i.test(p) && p.startsWith('uploads/recaps/'));
const copiedVideos = [];
for (const v of videos) {
  const src = join(uploadsCopy, v.slice('uploads/'.length));
  if (!existsSync(src) || statSync(src).size > 6 * 1024 * 1024 || copiedVideos.length >= 1) continue;
  mkdirSync(dirname(join(OUT, v)), { recursive: true });
  cpSync(src, join(OUT, v));
  copiedVideos.push(v);
}

// ---------------------------------------------------------------- write bundles
const meta = {
  captureDate,
  capturedAt: new Date().toISOString(),
  timezone: 'Asia/Kolkata',
  presets: PRESETS,
  storeIds,
  videos: copiedVideos,
  apiCalls: calls,
  images: { referenced: allRefs.filter(isImage).length, packed: included.length, packs: packs.length },
};
const files = {
  'meta.json': meta,
  'master.json': bundles.master,
  'roles.json': bundles.roles,
  'ops.json': bundles.ops,
  'trax.json': bundles.trax,
  'ai.json': bundles.ai,
  'misc.json': bundles.misc,
  'live.json': { live: bundles.live, infra: bundles.infra },
  'heatmap.json': bundles.heatmap,
  'journey.json': bundles.journey,
};
for (const preset of Object.keys(PRESETS)) files[`analytics-${preset}.json`] = bundles.analytics[preset];
for (const [name, data] of Object.entries(files)) writeFileSync(join(OUT, name), JSON.stringify(data));

let total = 0;
for (const name of [...Object.keys(files), ...packs.map((_, i) => `media/pack-${i}.json`), 'media/index.json', ...copiedVideos]) {
  const s = statSync(join(OUT, name)).size;
  total += s;
  log(`  ${name.padEnd(36)} ${(s / 1024).toFixed(0).padStart(7)} KB`);
}
log(`done: ${calls} API calls, ${(total / 1024 / 1024).toFixed(1)} MB in ${Object.keys(files).length + packs.length + 1 + copiedVideos.length} files, capture date ${captureDate}`);
cleanup();
process.exit(0);
