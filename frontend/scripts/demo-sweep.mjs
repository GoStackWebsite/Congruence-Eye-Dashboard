#!/usr/bin/env node
/**
 * Sweeps the built online demo (dist/demo) the way a host serves it: page.html wrapped in the host's own
 * skeleton under a deep sub-path. Every SPA route of e2e/support/routes.ts × admin / staff / auditor, at 1440 px
 * and 390 px; any console error, page error, failed request or HTTP ≥ 400 is a failure. Also drives the recorder
 * connection test (simulated probes: OK for most channels, AUTH for one, done after ~1.5 s).
 *
 * Usage (from frontend/, after `npm run build:demo`): node scripts/demo-sweep.mjs [--roles admin,staff]
 * Exit code 1 when anything was found. Uses the Playwright install of e2e/.
 */
import { createServer } from 'node:http';
import { createRequire } from 'node:module';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, '..');
const ROOT = join(FRONTEND, 'dist/demo/browser');
const PAGE = join(FRONTEND, 'dist/demo/page.html');
const DATA = join(FRONTEND, 'src/demo-data');
const ROUTES_TS = resolve(FRONTEND, '../e2e/support/routes.ts');
const { chromium } = createRequire(resolve(FRONTEND, '../e2e/package.json'))('playwright');

const PORT = Number(process.env.DEMO_SWEEP_PORT || 5055);
const PREFIX = '/some/deep/path/';
const BASE = `http://127.0.0.1:${PORT}${PREFIX}`;
const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=')[1];
const ROLES = (arg('roles') ?? 'admin,staff,auditor').split(',');
const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'phone', width: 390, height: 844 },
];

// ---------------------------------------------------------------- host-like static server
const TYPES = { '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.mp4': 'video/mp4', '.woff2': 'font/woff2', '.ico': 'image/x-icon', '.html': 'text/html', '.svg': 'image/svg+xml', '.png': 'image/png' };
const server = createServer((req, res) => {
  const url = decodeURIComponent(req.url.split('?')[0]);
  if (url === PREFIX || url === PREFIX + 'index.html') {
    const body = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body>${readFileSync(PAGE, 'utf8')}</body></html>`;
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(body);
  }
  const f = join(ROOT, url.slice(PREFIX.length));
  if (!url.startsWith(PREFIX) || !f.startsWith(ROOT) || !existsSync(f) || statSync(f).isDirectory()) {
    res.writeHead(404);
    return res.end('not found');
  }
  const data = readFileSync(f);
  const type = TYPES[extname(f)] ?? 'application/octet-stream';
  const range = req.headers.range;
  if (range) {
    const [a, b] = range.replace('bytes=', '').split('-');
    const start = Number(a);
    const end = b ? Number(b) : data.length - 1;
    res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${start}-${end}/${data.length}`, 'Accept-Ranges': 'bytes', 'Content-Length': end - start + 1 });
    return res.end(data.subarray(start, end + 1));
  }
  res.writeHead(200, { 'Content-Type': type, 'Content-Length': data.length, 'Accept-Ranges': 'bytes' });
  res.end(data);
});
await new Promise((r) => server.listen(PORT, '127.0.0.1', r));

// ---------------------------------------------------------------- routes (from the e2e catalogue)
const ROLE_OF = { admin: 'SUPER_ADMIN', regional: 'REGIONAL_MANAGER', manager: 'STORE_MANAGER', auditor: 'AUDITOR', staff: 'STAFF' };
const ADMINS = ['SUPER_ADMIN', 'ADMIN'];
const SM_PLUS = [...ADMINS, 'REGIONAL_MANAGER', 'STORE_MANAGER'];
const ANALYTICS = [...SM_PLUS, 'AUDITOR'];
const GROUPS = { ADMINS, SM_PLUS, ANALYTICS, ALL: [...ANALYTICS, 'STAFF'], TEMPLATES: [...ADMINS, 'REGIONAL_MANAGER', 'AUDITOR'], NOT_STAFF: [...SM_PLUS, 'AUDITOR'] };
const ROUTES = [...readFileSync(ROUTES_TS, 'utf8').matchAll(/\{ path: '([^']+)', page: '([^']+)', roles: (\w+)/g)].map((m) => ({ path: m[1], page: m[2], roles: GROUPS[m[3]] }));
if (ROUTES.length < 40) throw new Error(`only ${ROUTES.length} routes parsed from ${ROUTES_TS}`);

const json = (f) => JSON.parse(readFileSync(join(DATA, f), 'utf8'));
const roles = json('roles.json');
const trax = json('trax.json');
const ops = json('ops.json');
const ai = json('ai.json');
function idsFor(role) {
  const me = roles[role];
  const stores = new Set(me.stores);
  const inScope = (x) => x.storeId === null || x.storeId === undefined || stores.has(x.storeId);
  const asg = trax.assignments.filter((a) => a.assigneeId === me.userId && ['PENDING', 'OVERDUE', 'REDO', 'IN_PROGRESS'].includes(a.status));
  return {
    template: trax.templates[0]?.id,
    assignment: (asg[0] ?? trax.assignments.find(inScope))?.id,
    submission: trax.submissions.filter((s) => trax.submissionAnswers[s.id]).find(inScope)?.id,
    ticket: ops.tickets.find(inScope)?.id,
    rule: ai.rules[0]?.id,
    alert: ops.alerts.find(inScope)?.id,
  };
}

// ---------------------------------------------------------------- sweep
const issues = [];
const browser = await chromium.launch();
let pages = 0;
for (const role of ROLES) {
  const ids = idsFor(role);
  const list = ROUTES.filter((r) => r.roles.includes(ROLE_OF[role])).map((r) => ({ ...r, url: r.path.replace(/\{(\w+)\}/g, (_, k) => String(ids[k] ?? '')) }));
  for (const vp of VIEWPORTS) {
    const ctx = await browser.newContext({ viewport: { width: vp.width, height: vp.height }, timezoneId: 'Asia/Kolkata' });
    const page = await ctx.newPage();
    let current = 'login';
    const tag = () => `${role}@${vp.name} ${current}`;
    page.on('console', (m) => m.type() === 'error' && issues.push(`${tag()} console: ${m.text().slice(0, 300)}`));
    page.on('pageerror', (e) => issues.push(`${tag()} pageerror: ${String(e).slice(0, 300)}`));
    page.on('requestfailed', (r) => {
      // a video's range request is aborted when the page navigates away: not a failure
      if (/\.mp4$/.test(r.url()) && /ERR_ABORTED/.test(r.failure()?.errorText ?? '')) return;
      issues.push(`${tag()} requestfailed: ${r.failure()?.errorText} ${r.url().replace(BASE, '')}`);
    });
    page.on('response', (r) => r.status() >= 400 && issues.push(`${tag()} http ${r.status()} ${r.url().replace(BASE, '')}`));
    page.on('request', (r) => {
      const u = r.url();
      if (!u.startsWith(BASE) && !u.startsWith('blob:') && !u.startsWith('data:')) issues.push(`${tag()} off-origin request ${u}`);
    });
    await page.goto(BASE);
    await page.getByTestId('btn-demo-login-' + role).click();
    await page.waitForFunction(() => !location.hash.includes('/login'), null, { timeout: 20_000 });
    for (const r of list) {
      current = r.url;
      await page.goto(BASE + '#' + r.url);
      try {
        await page.getByTestId(r.page).first().waitFor({ timeout: 15_000 });
      } catch {
        issues.push(`${tag()} page ${r.page} did not render (landed on ${await page.evaluate(() => location.hash)})`);
      }
      await page.waitForTimeout(900);
      pages++;
    }
    // recorder connection test through the simulated probes (admin, once)
    if (role === 'admin' && vp.name === 'desktop') {
      current = '/admin/stores/1/recorders (probe test)';
      await page.goto(BASE + '#/admin/stores/1/recorders');
      const row = page.locator('[data-testid^="row-recorder-"]').first();
      await row.getByTestId('btn-channels').click();
      const grid = page.getByTestId('recorder-channels');
      const selAll = grid.getByTestId('btn-select-all-channels');
      if ((await selAll.innerText()).includes('Select all')) await selAll.click();
      const channels = await grid.getByTestId('channel-select').count();
      const t0 = Date.now();
      await grid.getByTestId('btn-test-selected').click();
      // the cards first show "Testing…" (simulated probe PENDING / RUNNING), then OK / Failed for every channel
      await grid.getByTestId('channel-running').first().waitFor({ timeout: 5_000 }).catch(() => issues.push(`${tag()} the test never showed a running probe`));
      await page.waitForFunction(() => !document.querySelector('[data-testid="channel-running"]'), null, { timeout: 20_000 }).catch(() => issues.push(`${tag()} probes did not finish`));
      const statuses = grid.getByTestId('channel-status');
      const texts = await statuses.allInnerTexts();
      if (texts.length !== channels) issues.push(`${tag()} ${texts.length} results for ${channels} channels`);
      const okN = texts.filter((t) => t.trim() === 'OK').length;
      const failed = texts.filter((t) => t.trim() === 'Failed').length;
      const ms = Date.now() - t0;
      console.log(`[sweep] probe test: ${okN} OK, ${failed} failed of ${texts.length} channels in ${ms} ms`);
      if (!(okN >= 1 && failed === 1)) issues.push(`${tag()} expected most channels OK and exactly one AUTH failure, got ${texts.join(', ')}`);
      if (ms < 1200) issues.push(`${tag()} probes completed in ${ms} ms (expected ~1.5 s)`);
      const err = await grid.getByTestId('channel-error').allInnerTexts();
      if (!err.some((e) => /username or password/i.test(e))) issues.push(`${tag()} AUTH failure text missing (${err.join(' | ')})`);
    }
    await ctx.close();
  }
}
await browser.close();
server.close();
console.log(`[sweep] ${pages} page loads (${ROLES.join(', ')} × ${VIEWPORTS.map((v) => v.width).join(' / ')} px), ${issues.length} issue(s)`);
for (const i of issues) console.log('  ' + i);
process.exit(issues.length ? 1 : 0);
