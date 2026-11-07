/**
 * Cross-system test: ai-service simulator → backend ingestion → rollups / live / alerts → Angular UI.
 *
 * The `--once --start <ts>` scenario (ai-service/congruence_eye_ai/simulate.py, StoreWorld.add_block, scripted) is fixed:
 *   plan = 12 parties: sizes 1,2,1,1,3,1,1,2,1,1,1,1 (16 shoppers, 3 groups with 2+3+2 = 7 members)
 *   + 3 direct-to-till buyers (long queue) + 1 unattended customer → 20 shoppers, all of them leave (20 EXITs)
 *   + 3 uniformed floor staff who walk in through the entry line (isStaff → excluded from footfall)
 *   + 1 cashier per billing counter (STAFF_ONLY zone, never crosses the entry line)
 *   cashier break 240–330 s → queue builds up (max queue ≥ 2) and a COUNTER_UNATTENDED event
 *   one heartbeat with every camera ONLINE; one staged incident per AI Manager rule type
 * An explicit --start (no opening segment) and a seed different from global setup's run keep the numbers and the
 * re-ID hashes independent of the time of day and of earlier simulator runs.
 */
import { execFile } from 'child_process';
import * as path from 'path';
import { promisify } from 'util';
import { test, expect, Api } from '../support/fixtures';
import { AI_DIR, API_URL, PASSWORD, TMP, WEB_URL, todayLocal, uid } from '../support/env';
import { fmt, matSelect, waitForApi } from '../support/ui';

const run = promisify(execFile);

const SEED = 23;
const SIM_TRACK = new RegExp(`^c\\d+-sim${SEED}-`);
const SHOPPERS = 20;
const GROUPS = 3;
const GROUP_MEMBERS = 7;
const E = {
  shoppers: SHOPPERS,
  groups: GROUPS,
  staffEntries: 3,
  individuals: SHOPPERS - GROUP_MEMBERS, // 9
  billable: SHOPPERS - GROUP_MEMBERS + GROUPS, // 12 (a group counts once)
};

test.describe('AI pipeline (simulator → backend → UI)', () => {
  test.describe.configure({ retries: 0 }); // the simulator mutates today's data: a retry would double-count
  test.setTimeout(180_000);

  test('deterministic scenario updates footfall, live view, cameras and fires a queue alert + notification', async ({ api, pageAs }) => {
    // the scenario covers ~16 minutes ending about a minute ago; skip right after local midnight (window would span two days)
    const ist = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    test.skip(ist < '00:20', 'scenario window would cross local midnight');
    const start = new Date(Date.now() - 15 * 60_000 - 10_000).toISOString().replace(/\.\d+Z$/, 'Z');

    const admin = await api('admin');
    const today = todayLocal();

    // a fresh store-1 manager receives the alert notification (no seeded notifications → clean bell)
    const email = `${uid('pipe')}@congruence.in`;
    await admin.post('/api/users', { email, name: 'Pipeline Manager', role: 'STORE_MANAGER', password: PASSWORD, storeIds: [1] });
    const mgr = await Api.login(email);
    expect(await mgr.get('/api/notifications')).toEqual([]);

    // ---- before
    const trafficBefore = (await admin.get('/api/analytics/traffic', { storeIds: '1', from: today, to: today })).totals;
    const liveBefore = await admin.get('/api/analytics/live', { storeId: 1 });
    const overviewBefore = (await admin.get('/api/analytics/overview', { storeIds: '1', from: today, to: today })).kpis;

    // the manager's browser is open on the dashboard while the edge data arrives
    const page = await pageAs('admin');
    const mgrCtx = await page.context().browser()!.newContext({
      baseURL: WEB_URL,
      timezoneId: 'Asia/Kolkata',
      storageState: {
        cookies: [],
        origins: [{
          origin: WEB_URL,
          localStorage: [
            { name: 'ce.token', value: mgr.token! },
            { name: 'ce.user', value: JSON.stringify(await mgr.get('/api/auth/me')) },
          ],
        }],
      },
    });
    const mgrPage = await mgrCtx.newPage();
    await mgrPage.goto('/dashboard');
    await expect(mgrPage.getByTestId('notif-bell')).toBeVisible();
    await expect(mgrPage.getByTestId('notif-count')).toHaveCount(0);

    // low-threshold queue rule for store 1 (created before the edge data arrives)
    const rule = await admin.post('/api/alert-rules', {
      name: `E2E queue ${uid()}`, storeId: 1, metric: 'QUEUE_LENGTH', threshold: 1, severity: 'HIGH', channels: ['IN_APP'], cooldownMin: 120, isActive: true,
    });

    // a live view for T Nagar is open while the edge data arrives (it must update without a reload)
    const livePage = await pageAs('admin');
    await livePage.addInitScript(() => localStorage.setItem('ce.filter', JSON.stringify({ storeIds: [1], preset: 'today', custom: null, compare: false })));
    await livePage.goto('/live');
    await expect(livePage.getByTestId('select-live-store')).toContainText('T Nagar');
    await expect(livePage.getByTestId('kpi-live-today-footfall').getByTestId('kpi-value')).toHaveText(fmt.number(liveBefore.todayFootfall));
    await expect(livePage.getByTestId('toggle-live-auto').locator('button[role=switch]')).toHaveAttribute('aria-checked', 'true');

    // ---- run the real simulator against the real backend
    const simStart = Date.now();
    const { stdout } = await run(
      path.join(AI_DIR, '.venv', 'bin', 'python'),
      ['-m', 'congruence_eye_ai.simulate', '--backend', API_URL, '--key', 'dev-edge-key-store-1', '--once', '--seed', String(SEED), '--start', start, '--print-events', '--spool-dir', path.join(TMP, `spool-sim-${Date.now()}`)],
      { cwd: AI_DIR, timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
    );
    // stdout: one JSON line per generated payload (--print-events), then the pretty-printed summary
    const summary = JSON.parse(stdout.slice(stdout.lastIndexOf('\n{\n') + 1));
    const simEvents: { ts: string; trackId: string; type: string }[] = stdout
      .split('\n')
      .filter((l) => l.startsWith('{"event"'))
      .map((l) => JSON.parse(l).event);
    expect(simEvents.filter((e) => e.type === 'ENTRY')).toHaveLength(E.shoppers + E.staffEntries);
    expect(summary.store).toBe(1);
    expect(summary.spoolPendingItems).toBe(0);
    expect(summary.world.shoppers).toBe(E.shoppers);
    expect(summary.world.groups).toBe(E.groups);
    expect(summary.generated.ENTRY).toBe(E.shoppers + E.staffEntries);
    expect(summary.generated.EXIT).toBe(E.shoppers);
    expect(summary.generated.queueSnapshots).toBeGreaterThan(0);

    // ---- API: today's footfall grew by exactly the scenario's numbers
    const after = (await admin.get('/api/analytics/traffic', { storeIds: '1', from: today, to: today })).totals;
    expect(after.footfallIn - trafficBefore.footfallIn, 'footfall in (staff excluded)').toBe(E.shoppers);
    expect(after.footfallOut - trafficBefore.footfallOut, 'footfall out').toBe(E.shoppers);
    expect(after.staffExcluded - trafficBefore.staffExcluded, 'staff excluded').toBe(E.staffEntries);
    expect(after.groups - trafficBefore.groups, 'groups').toBe(E.groups);
    expect(after.individuals - trafficBefore.individuals, 'individuals').toBe(E.individuals);
    expect(after.billableEntities - trafficBefore.billableEntities, 'billable entities').toBe(E.billable);
    expect(after.uniqueVisitors - trafficBefore.uniqueVisitors, 'unique visitors').toBe(E.shoppers);
    const overviewAfter = (await admin.get('/api/analytics/overview', { storeIds: '1', from: today, to: today })).kpis;
    expect(overviewAfter.footfall.value - overviewBefore.footfall.value).toBe(E.shoppers);
    expect(overviewAfter.billableEntities.value - overviewBefore.billableEntities.value).toBe(E.billable);

    // live endpoint: footfall, heartbeat (all cameras ONLINE, fresh), queue snapshots, newest events from the simulator
    const live = await admin.get('/api/analytics/live', { storeId: 1 });
    expect(live.todayFootfall - liveBefore.todayFootfall).toBe(E.shoppers);
    // the open live view picked it up by itself (SSE `live` events / auto-refresh), no reload
    await expect(livePage.getByTestId('kpi-live-today-footfall').getByTestId('kpi-value')).toHaveText(fmt.number(live.todayFootfall), { timeout: 30_000 });
    await expect(livePage.getByTestId('live-events')).toContainText(/Entry|Exit|Zone/);
    expect(live.cameras).toHaveLength(5);
    for (const c of live.cameras) {
      expect(c.status, c.name).toBe('ONLINE');
      expect(new Date(c.lastHeartbeatAt).getTime(), `${c.name} heartbeat`).toBeGreaterThanOrEqual(simStart - 1000);
    }
    expect(live.queues).toHaveLength(2);
    for (const q of live.queues) expect(new Date(q.ts).getTime()).toBeGreaterThan(simStart - 120_000);
    // the 20 newest events = the newest of (what was there before ∪ what the simulator sent)
    // (the seed's own "today" events run up to the seeding moment, so they may interleave with the simulator's)
    const key = (e: any) => `${e.trackId}|${e.type}|${new Date(e.ts).getTime()}`;
    const merged = [...liveBefore.recentEvents, ...simEvents].sort((a: any, b: any) => new Date(b.ts).getTime() - new Date(a.ts).getTime());
    const cutoff = new Date(merged[19].ts).getTime();
    const expectedSim = simEvents.filter((e) => new Date(e.ts).getTime() > cutoff).map(key);
    const listed = live.recentEvents.map(key);
    for (const k of expectedSim) expect(listed, `simulator event ${k} is among the newest`).toContain(k);
    expect(live.recentEvents.filter((e: any) => SIM_TRACK.test(e.trackId)).length).toBeGreaterThanOrEqual(expectedSim.length);
    const devices = await admin.get('/api/edge-devices', { storeId: 1 });
    expect(devices.some((d: any) => d.lastSeenAt && new Date(d.lastSeenAt).getTime() >= simStart - 1000)).toBe(true);

    // store ops recorded the unattended counter episode
    const ops = await admin.get('/api/analytics/storeops', { storeIds: '1', from: today, to: today });
    expect(ops.events.some((e: any) => e.type === 'COUNTER_UNATTENDED' && new Date(e.ts).getTime() > simStart - 20 * 60_000)).toBe(true);

    // ---- alert: the scenario's queue (≥ 2 people) exceeds the threshold of 1
    const evalRes = await admin.post('/api/alerts/evaluate');
    expect(typeof evalRes.created).toBe('number');
    const alerts = (await admin.get('/api/alerts', { storeIds: '1', pageSize: 100 })).items.filter((a: any) => a.ruleId === rule.id);
    expect(alerts, 'exactly one alert (cooldown) for the new rule').toHaveLength(1);
    const alert = alerts[0];
    expect(alert).toMatchObject({ storeId: 1, metric: 'QUEUE_LENGTH', severity: 'HIGH', status: 'OPEN', ticketId: null });
    expect(alert.value).toBeGreaterThanOrEqual(2);
    expect(alert.message).toMatch(/Queue at Billing Counter [12] is \d+ people \(threshold 1\) at Congruence T Nagar/);
    // evaluating again within the cooldown does not duplicate it
    await admin.post('/api/alerts/evaluate');
    expect((await admin.get('/api/alerts', { storeIds: '1', pageSize: 100 })).items.filter((a: any) => a.ruleId === rule.id)).toHaveLength(1);

    // notification for the store manager → bell count increases (pushed over SSE, or on reload as fallback)
    const notes = await mgr.get('/api/notifications');
    const note = notes.find((n: any) => n.link === `/alerts/${alert.id}`);
    expect(note).toMatchObject({ title: `[HIGH] ${rule.name}`, isRead: false });
    await expect(async () => {
      if (!(await mgrPage.getByTestId('notif-count').isVisible())) await mgrPage.reload();
      await expect(mgrPage.getByTestId('notif-count')).toHaveText(String(notes.filter((n: any) => !n.isRead).length), { timeout: 5000 });
    }).toPass({ timeout: 30_000 });
    await mgrPage.getByTestId('notif-bell').click();
    await expect(mgrPage.getByTestId(`notif-item-${note.id}`)).toContainText(rule.name);
    await mgrPage.keyboard.press('Escape');
    await mgrCtx.close();

    // ---- UI: traffic page shows the new total for today / store 1
    await page.addInitScript(() => localStorage.setItem('ce.filter', JSON.stringify({ storeIds: [1], preset: 'today', custom: null, compare: false })));
    const tr = waitForApi(page, '/api/analytics/traffic', (u) => u.searchParams.get('storeIds') === '1');
    await page.goto('/analytics/traffic');
    const uiTraffic = await (await tr).json();
    expect(uiTraffic.totals.footfallIn).toBeGreaterThanOrEqual(after.footfallIn);
    await expect(page.getByTestId('kpi-footfall-in').getByTestId('kpi-value')).toHaveText(fmt.number(uiTraffic.totals.footfallIn));

    // live page lists the simulator's events and the ONLINE cameras
    const first = waitForApi(page, '/api/analytics/live');
    await page.goto('/live');
    await first;
    const lr = waitForApi(page, '/api/analytics/live', (u) => u.searchParams.get('storeId') === '1');
    await matSelect(page, 'select-live-store', { testId: 'select-live-store-option-1' }).catch(() => page.keyboard.press('Escape'));
    // store 1 may already have been selected (the filter has storeIds [1]): re-selecting it fetches nothing,
    // so always ask for a fresh read instead of waiting for the next poll
    await page.getByTestId('btn-live-refresh').click();
    const uiLive = await (await lr).json();
    expect(uiLive.todayFootfall).toBeGreaterThanOrEqual(live.todayFootfall);
    await expect(page.getByTestId('kpi-live-today-footfall').getByTestId('kpi-value')).toHaveText(fmt.number(uiLive.todayFootfall));
    const items = page.getByTestId('live-events').locator('li');
    await expect(items).toHaveCount(uiLive.recentEvents.length);
    // every listed event (simulator's included) shows its type and camera, in the API order
    for (let i = 0; i < uiLive.recentEvents.length; i++) {
      const ev = uiLive.recentEvents[i];
      const label = ev.type.replace(/_/g, ' ').toLowerCase().replace(/^./, (c: string) => c.toUpperCase());
      await expect(items.nth(i)).toContainText(label);
      await expect(items.nth(i)).toContainText(uiLive.cameras.find((c: any) => c.id === ev.cameraId).name);
    }
    if (expectedSim.length) expect(uiLive.recentEvents.some((e: any) => SIM_TRACK.test(e.trackId))).toBe(true);
    for (const c of uiLive.cameras) {
      await expect(page.getByTestId(`camera-tile-${c.id}`).locator('[data-value]')).toHaveAttribute('data-value', 'ONLINE');
    }
    // the simulator uploaded one snapshot per camera that saw people → the tile shows an image
    await expect(page.getByTestId('live-cameras').getByTestId('camera-snapshot').first()).toBeVisible();

    // queue page: the live queue cards show the simulator's latest snapshots
    const qr = waitForApi(page, '/api/analytics/queue', (u) => u.searchParams.get('storeIds') === '1');
    await page.goto('/analytics/queue');
    const q = await (await qr).json();
    expect(q.live).toHaveLength(2);
    for (const l of q.live) {
      expect(new Date(l.ts).getTime(), 'snapshot from this simulator run').toBeGreaterThan(simStart - 20 * 60_000);
      const card = page.getByTestId(`queue-card-${l.zoneId}`);
      await expect(card).toContainText(l.name);
      await expect(card.locator('.q-len')).toHaveText(String(l.queueLength));
      await expect(card).toContainText(l.counterStaffed ? 'Staffed' : 'Unattended');
    }
    expect(q.totals.maxQueueLength).toBeGreaterThanOrEqual(2);

    // alerts page shows the new alert
    await page.goto('/alerts');
    await expect(page.getByTestId(`row-alert-${alert.id}`)).toBeVisible();
    await expect(page.getByTestId(`row-alert-${alert.id}`).getByTestId('chip-severity')).toHaveAttribute('data-value', 'HIGH');

    await admin.delete(`/api/alert-rules/${rule.id}`);
    await mgr.dispose();
  });
});
