/**
 * AI Manager (M1–M6, Z4): rule editor for all 8 detection types, detections gallery fed by the simulator (global
 * setup), review VALID / FALSE_POSITIVE, summary, store open/close with opening & closing snaps.
 */
import * as fs from 'fs';
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { API_URL, EDGE_KEY_STORE_1, SETUP_STATE, todayLocal, uid } from '../support/env';
import { expectToast, matMultiSelect, matSelect, presetFilter, waitForApi } from '../support/ui';

const setupState = () => JSON.parse(fs.readFileSync(SETUP_STATE, 'utf8'));

const TYPES = {
  MOBILE_USAGE: { label: 'Mobile phone usage', zones: ['SECTION', 'STAFF_ONLY', 'QUEUE'], defaults: { minDurationSec: 20, staffOnly: true }, change: ['minDurationSec', 30] },
  UNATTENDED_CUSTOMER: { label: 'Unattended customer', zones: ['SECTION'], defaults: { minDurationSec: 120, staffRadius: 0.15 }, change: ['minDurationSec', 90] },
  STORE_OPEN_CLOSE: { label: 'Store open / close', zones: ['ENTRY_LINE', 'SECTION'], defaults: { toleranceMin: 10 }, change: ['toleranceMin', 15] },
  HYGIENE_CLEANING: { label: 'Hygiene (cleaning & mopping)', zones: ['SECTION', 'QUEUE'], defaults: { minCoveragePct: 60 }, change: ['minCoveragePct', 75] },
  HUDDLE_MEETING: { label: 'Huddle meeting', zones: ['SECTION', 'STAFF_ONLY'], defaults: { minPeople: 3, minDurationMin: 5, radius: 0.2 }, change: ['minPeople', 4] },
  UNIFORM_COMPLIANCE: { label: 'Uniform compliance', zones: ['SECTION', 'QUEUE', 'STAFF_ONLY'], defaults: { minNonCompliantSec: 60 }, change: ['minNonCompliantSec', 45] },
  STOCK_OUT: { label: 'Stock-out (shelf empty)', zones: ['SHELF'], defaults: { emptyPct: 70 }, change: ['emptyPct', 80] },
  QUEUE_BREACH: { label: 'Queue breach', zones: ['QUEUE'], defaults: { maxQueue: 5 }, change: ['maxQueue', 4] },
} as const;
type AiType = keyof typeof TYPES;

async function imgLoaded(loc: ReturnType<Page['getByTestId']>) {
  await loc.scrollIntoViewIfNeeded();
  await expect.poll(() => loc.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)), { timeout: 20_000 }).toBeGreaterThan(0);
}

test.describe('AI Manager', () => {
  test('rule editor: create one rule of each of the 8 detection types with areas, window, days, params, severity and channels', async ({ pageAs, api }) => {
    test.setTimeout(240_000);
    const admin = await api();
    const zones = await admin.get('/api/zones', { storeId: 1 });
    const page = await pageAs('admin');
    await page.goto('/ai-manager/rules');
    const before = await admin.get('/api/ai-manager/rules');

    // validation: a nameless rule is refused client-side (the editor is a full page: /ai-manager/rules/new)
    await page.getByTestId('btn-create-ai-rule').click();
    let dlg = page.getByTestId('page-ai-rule-editor');
    await dlg.getByTestId('btn-save').click();
    await expect(page.getByTestId('ai-rule-errors')).toContainText(/name/i);
    await dlg.getByTestId('btn-cancel').click();
    await expect(page.getByTestId('page-ai-rules')).toBeVisible();

    const created: any[] = [];
    for (const [type, t] of Object.entries(TYPES) as [AiType, (typeof TYPES)[AiType]][]) {
      const name = `E2E ${type} ${uid()}`;
      await page.getByTestId('btn-create-ai-rule').click();
      dlg = page.getByTestId('page-ai-rule-editor');
      await dlg.getByTestId('input-ai-rule-name').fill(name);
      await matSelect(page, dlg.getByTestId('input-ai-rule-type'), new RegExp(t.label.replace(/[()/]/g, '.')));
      await expect(dlg.getByTestId('input-ai-rule-type')).toContainText(t.label);
      // defaults pre-filled for the type
      for (const [k, v] of Object.entries(t.defaults)) {
        const input = dlg.getByTestId(`input-param-${k}`);
        if (typeof v === 'boolean') await expect(input.locator('button[role=switch]')).toHaveAttribute('aria-checked', String(v));
        else await expect(input).toHaveValue(String(v));
      }
      await dlg.getByTestId(`input-param-${t.change[0]}`).fill(String(t.change[1]));
      await matMultiSelect(page, dlg.getByTestId('input-ai-rule-stores'), ['Congruence T Nagar']);
      // detection areas only offer the zone types relevant to this detection type
      const relevant = zones.filter((z: any) => (t.zones as readonly string[]).includes(z.type) && z.isActive);
      expect(relevant.length, `${type} has candidate zones in T Nagar`).toBeGreaterThan(0);
      await dlg.getByTestId('input-ai-rule-zones').click({ force: true });
      const opts = page.locator('.cdk-overlay-pane .mat-mdc-select-panel').last().getByRole('option');
      // every seeded relevant zone is offered, and only zones of the relevant types (other tests may add zones meanwhile)
      await expect(opts.first()).toBeVisible();
      // the store's zones load after the store is picked: wait until the list has settled
      await expect
        .poll(async () => {
          const now = await opts.allInnerTexts();
          return relevant.every((z) => now.some((x) => x.startsWith(`${z.name} ·`)));
        }, { message: `${type}: all relevant zones offered` })
        .toBe(true);
      const texts = await opts.allInnerTexts();
      for (const z of relevant) expect(texts.some((x) => x.startsWith(`${z.name} ·`)), `${type} offers ${z.name}`).toBe(true);
      for (const txt of texts) expect(t.zones.some((zt) => txt.includes(zt.replace(/_/g, ' ').toLowerCase().replace(/^./, (c) => c.toUpperCase()))), txt).toBe(true);
      await opts.first().click();
      await page.keyboard.press('Escape');
      await dlg.getByTestId('input-ai-rule-window-start').fill('10:00');
      await dlg.getByTestId('input-ai-rule-window-end').fill('21:30');
      // weekdays only: untick Sunday and Saturday
      for (const d of [0, 6]) {
        const box = dlg.getByTestId(`ai-day-${d}`).locator('input[type=checkbox]');
        if (await box.isChecked()) await box.click();
      }
      await matSelect(page, dlg.getByTestId('input-ai-rule-severity'), 'High');
      await matMultiSelect(page, dlg.getByTestId('input-ai-rule-channels'), ['Email']);
      await dlg.getByTestId('input-ai-rule-emails').fill('ops@congruence.in');
      const post = page.waitForResponse((r) => r.url().endsWith('/api/ai-manager/rules') && r.request().method() === 'POST');
      await dlg.getByTestId('btn-save').click(); // Publish
      const res = await post;
      expect(res.status(), await res.text()).toBe(201);
      await expectToast(page, 'Rule created');
      const rule = await res.json();
      created.push(rule);
      expect(rule).toMatchObject({
        name, type, storeIds: [1], windowStart: '10:00', windowEnd: '21:30', severity: 'HIGH', isActive: true, notifyEmails: 'ops@congruence.in',
      });
      expect(rule.daysOfWeek.sort()).toEqual([1, 2, 3, 4, 5]);
      expect(rule.notifyChannels).toEqual(expect.arrayContaining(['IN_APP', 'EMAIL']));
      expect(rule.params).toEqual({ ...t.defaults, [t.change[0]]: t.change[1] });
      expect(rule.zoneIds).toHaveLength(1);
      expect(t.zones).toContain(zones.find((z: any) => z.id === rule.zoneIds[0]).type);
      await expect(page.getByTestId(`row-ai-rule-${rule.id}`)).toContainText(name);
    }
    expect((await admin.get('/api/ai-manager/rules')).length).toBe(before.length + 8);

    // the edge box of T Nagar receives the active rules in its config
    const cfg = await (await page.request.get(`${API_URL}/api/ingest/config`, { headers: { 'X-Api-Key': EDGE_KEY_STORE_1 } })).json();
    for (const r of created) expect(cfg.aiManagerRules.map((x: any) => x.id)).toContain(r.id);

    // pause one (toggle) → it leaves the edge config; edit another; delete all
    const [first, second] = created;
    await page.getByTestId(`row-ai-rule-${first.id}`).getByTestId('toggle-ai-rule-active').locator('button').click();
    await expectToast(page, 'Rule paused');
    await expect.poll(async () => (await admin.get('/api/ai-manager/rules')).find((r: any) => r.id === first.id).isActive).toBe(false);
    const cfg2 = await (await page.request.get(`${API_URL}/api/ingest/config`, { headers: { 'X-Api-Key': EDGE_KEY_STORE_1 } })).json();
    expect(cfg2.aiManagerRules.map((x: any) => x.id)).not.toContain(first.id);
    await page.getByTestId(`row-ai-rule-${second.id}`).getByTestId('btn-edit').click();
    dlg = page.getByTestId('page-ai-rule-editor');
    await expect(dlg.getByTestId('input-ai-rule-name')).toHaveValue(second.name);
    await dlg.getByTestId('input-ai-rule-name').fill(`${second.name} edited`);
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Rule updated');
    expect((await admin.get('/api/ai-manager/rules')).find((r: any) => r.id === second.id).name).toBe(`${second.name} edited`);
    for (const r of created) {
      await page.getByTestId(`row-ai-rule-${r.id}`).getByTestId('btn-delete').click();
      await page.locator('mat-dialog-container').getByTestId('btn-confirm').click();
      await expect(page.getByTestId(`row-ai-rule-${r.id}`)).toHaveCount(0);
    }
    expect((await admin.get('/api/ai-manager/rules')).length).toBe(before.length);
  });

  test('rules are read-only for the store manager and the auditor (view only, API 403)', async ({ pageAs, api }) => {
    for (const role of ['manager', 'auditor'] as const) {
      const page = await pageAs(role);
      await page.goto('/ai-manager/rules');
      await expect(page.getByTestId('table-ai-rules').locator('[data-testid^="row-ai-rule-"]').first()).toBeVisible();
      await expect(page.getByTestId('btn-create-ai-rule')).toHaveCount(0);
      await page.getByTestId('table-ai-rules').locator('[data-testid^="row-ai-rule-"]').first().getByTestId('btn-edit').click();
      await expect(page.getByTestId('input-ai-rule-name')).toBeDisabled();
      await expect(page.getByTestId('page-ai-rule-editor').getByTestId('btn-save')).toHaveCount(0);
      const r = await (await api(role)).ctx.post('/api/ai-manager/rules', { data: { name: 'x', type: 'QUEUE_BREACH', storeIds: [1], zoneIds: [], windowStart: '10:00', windowEnd: '21:00', daysOfWeek: [1], params: {}, severity: 'LOW', notifyChannels: ['IN_APP'], notifyEmails: null, isActive: true } });
      expect(r.status(), role).toBe(403);
    }
  });

  test('detections: the simulator\'s detections of every type are listed with evidence snapshots; filters, evidence dialog, review VALID / FALSE_POSITIVE and the summary', async ({ pageAs, api }) => {
    const { simToday, simYesterday, today, yesterday } = setupState();
    const admin = await api();
    // what the simulator reported (today's scenario ends "now"; yesterday is a full store day) is in the API with
    // snapshots. Today's run cannot contain STORE_OPEN_CLOSE before the store opens (~10:00 IST), so the opening /
    // closing evidence is checked on yesterday's full day — deterministic whatever the time of day.
    // (window rules — huddle, hygiene — keep only the first result per rule, store and date; README "Contract interpretations")
    const WINDOW = ['HUDDLE_MEETING', 'HYGIENE_CLEANING'];
    const checkDay = async (day: string, detections: Record<string, number>) => {
      const all = await admin.get('/api/ai-manager/detections', { storeIds: '1', from: day, to: day, pageSize: 500 });
      for (const [key, n] of Object.entries(detections) as [string, number][]) {
        const [type, status] = key.split(':');
        const hits = all.items.filter((d: any) => d.type === type && (WINDOW.includes(type) || d.status === status));
        expect(hits.length, `${day} ${key}`).toBeGreaterThanOrEqual(WINDOW.includes(type) ? 1 : n);
        expect(hits.some((d: any) => d.snapshotUrl), `${day} ${key} has evidence`).toBe(true);
      }
    };
    await checkDay(today, simToday.detections);
    await checkDay(yesterday, simYesterday.detections);
    const typesOf = (d: Record<string, number>) => new Set(Object.keys(d).map((k) => k.split(':')[0]));
    const todayTypes = typesOf(simToday.detections);
    todayTypes.delete('STORE_OPEN_CLOSE');
    expect([...todayTypes].sort(), "today's scenario covers every in-store type (open/close depends on the clock)").toEqual(
      ['HUDDLE_MEETING', 'HYGIENE_CLEANING', 'MOBILE_USAGE', 'QUEUE_BREACH', 'STOCK_OUT', 'UNATTENDED_CUSTOMER', 'UNIFORM_COMPLIANCE'],
    );
    const types = new Set([...typesOf(simToday.detections), ...typesOf(simYesterday.detections)]);
    expect(types.size, 'all 8 AI Manager types exercised by the simulator (today + yesterday)').toBe(8);
    expect(typesOf(simYesterday.detections).has('STORE_OPEN_CLOSE'), "yesterday's full day has the opening / closing").toBe(true);

    const page = await pageAs('manager');
    await presetFilter(page, { storeIds: [1], preset: 'today' });
    await page.goto('/ai-manager/detections');
    await page.getByTestId('view-gallery').click();
    // filter: stock-out breaches
    const resp = waitForApi(page, '/api/ai-manager/detections', (u) => u.searchParams.get('type') === 'STOCK_OUT' && u.searchParams.get('status') === 'BREACHED');
    await matSelect(page, 'filter-detection-type', 'Stock-out (shelf empty)');
    await matSelect(page, 'filter-detection-status', 'Breached');
    const stock = await (await resp).json();
    expect(stock.items.length).toBeGreaterThan(0);
    expect(stock.items.every((d: any) => d.type === 'STOCK_OUT' && d.status === 'BREACHED' && d.storeId === 1)).toBe(true);
    const det = stock.items.find((d: any) => d.snapshotUrl && !d.reviewStatus) ?? stock.items[0];
    const item = page.getByTestId(`detection-item-${det.id}`);
    await expect(item.getByTestId('chip-detection-status')).toHaveAttribute('data-value', 'BREACHED');
    await imgLoaded(item.locator('img'));
    // evidence dialog
    await item.getByRole('button', { name: /Open evidence/ }).click();
    await imgLoaded(page.getByTestId('detection-evidence'));
    await expect(page.getByTestId('detection-evidence')).toHaveAttribute('src', det.snapshotUrl);
    await page.getByTestId('dialog-detection').getByTestId('btn-close').click();

    // review: valid, then false positive (excluded from the summary)
    const summaryBefore = await admin.get('/api/ai-manager/summary', { storeIds: '1', from: today, to: today });
    await item.getByTestId('btn-review-valid').click();
    await expectToast(page, 'Marked valid');
    await expect(item.getByTestId('chip-review')).toHaveAttribute('data-value', 'VALID');
    await expect.poll(async () => (await admin.get('/api/ai-manager/detections', { storeIds: '1', from: today, to: today, pageSize: 500 })).items.find((d: any) => d.id === det.id).reviewStatus).toBe('VALID');
    await item.getByTestId('btn-review-false').click();
    await expectToast(page, 'Marked as false positive');
    await expect(item.getByTestId('chip-review')).toHaveAttribute('data-value', 'FALSE_POSITIVE');
    await expect.poll(async () => (await admin.get('/api/ai-manager/detections', { storeIds: '1', from: today, to: today, pageSize: 500 })).items.find((d: any) => d.id === det.id).reviewStatus).toBe('FALSE_POSITIVE');
    const summaryAfter = await admin.get('/api/ai-manager/summary', { storeIds: '1', from: today, to: today });
    const bt = (s: any) => s.byType.find((x: any) => x.type === 'STOCK_OUT');
    expect(bt(summaryAfter).breached).toBe(bt(summaryBefore).breached - 1);

    // table view + deep link highlight (?id=)
    await page.goto(`/ai-manager/detections?id=${det.id}`);
    await page.getByTestId('view-table').click();
    await expect(page.getByTestId('table-detections')).toBeVisible();

    // auditor: view only, no review buttons
    const aud = await pageAs('auditor');
    await presetFilter(aud, { storeIds: [1], preset: 'today' });
    await aud.goto('/ai-manager/detections');
    await aud.getByTestId('view-gallery').click();
    await expect(aud.getByTestId('detection-gallery').locator('[data-testid^="detection-item-"]').first()).toBeVisible();
    await expect(aud.getByTestId('btn-review-valid')).toHaveCount(0);
    expect((await (await api('auditor')).ctx.patch(`/api/ai-manager/detections/${det.id}/review`, { data: { reviewStatus: 'VALID' } })).status()).toBe(403);
  });

  test('summary: KPIs and per-type / per-store tables equal /ai-manager/summary', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    await presetFilter(page, { preset: 'last7' });
    const resp = waitForApi(page, '/api/ai-manager/summary');
    await page.goto('/ai-manager/summary');
    const s = await (await resp).json();
    const u = new URL((await resp).url());
    const apiS = await (await api()).get('/api/ai-manager/summary', { from: u.searchParams.get('from')!, to: u.searchParams.get('to')! });
    expect(s).toEqual(apiS);
    const breached = s.byType.reduce((a: number, x: any) => a + x.breached, 0);
    const complied = s.byType.reduce((a: number, x: any) => a + x.complied, 0);
    expect(breached).toBeGreaterThan(0);
    expect(complied).toBeGreaterThan(0);
    const num = (n: number) => new Intl.NumberFormat('en-IN').format(n);
    await expect(page.getByTestId('kpi-ai-total').getByTestId('kpi-value')).toHaveText(num(breached + complied));
    await expect(page.getByTestId('kpi-ai-breached').getByTestId('kpi-value')).toHaveText(num(breached));
    await expect(page.getByTestId('kpi-ai-complied').getByTestId('kpi-value')).toHaveText(num(complied));
    await expect(page.getByTestId('kpi-ai-compliance').getByTestId('kpi-value')).toHaveText(`${((complied / (breached + complied)) * 100).toFixed(1)}%`);
    expect(s.byType.map((x: any) => x.type).sort()).toEqual(Object.keys(TYPES).sort());
    for (const x of s.byType) {
      const row = page.getByTestId(`row-ai-type-${x.type}`);
      await expect(row).toContainText(num(x.breached));
      await expect(row).toContainText(`${x.compliancePct.toFixed(1)}%`);
    }
    for (const x of s.byStore) await expect(page.getByTestId(`row-ai-store-${x.storeId}`)).toContainText(x.storeName);
    await page.getByTestId('link-detections').click();
    await expect(page.getByTestId('page-ai-detections')).toBeVisible();
  });

  test('open/close: yesterday\'s T Nagar card shows the simulator\'s opening and closing snaps with On time / Late / Early status', async ({ pageAs, api }) => {
    const { yesterday } = setupState();
    const page = await pageAs('admin');
    await presetFilter(page, { storeIds: [1], preset: 'custom', custom: { from: yesterday, to: yesterday } });
    const resp = waitForApi(page, '/api/ai-manager/open-close', (u) => u.searchParams.get('from') === yesterday);
    await page.goto('/ai-manager/open-close');
    const rows = await (await resp).json();
    const r = rows.find((x: any) => x.storeId === 1 && x.date === yesterday);
    expect(r).toBeTruthy();
    expect(r.openingSnapUrl).toBeTruthy();
    expect(r.closingSnapUrl).toBeTruthy();
    expect(['ON_TIME', 'LATE', 'EARLY']).toContain(r.openStatus);
    expect(['ON_TIME', 'LATE', 'EARLY']).toContain(r.closeStatus);
    expect(r.detectionStatus).toBe(r.openStatus === 'ON_TIME' && r.closeStatus === 'ON_TIME' ? 'COMPLIED' : 'BREACHED');
    const card = page.getByTestId(`oc-card-1-${yesterday}`);
    await expect(card).toHaveAttribute('data-status', r.detectionStatus);
    await expect(card.getByTestId('chip-detection-status')).toHaveAttribute('data-value', r.detectionStatus);
    await expect(card.getByTestId('chip-open-status')).toHaveAttribute('data-value', r.openStatus);
    await expect(card.getByTestId('chip-close-status')).toHaveAttribute('data-value', r.closeStatus);
    await expect(card).toContainText(r.actualOpen);
    await expect(card).toContainText(r.actualClose);
    await imgLoaded(card.getByTestId('opening-snap'));
    await imgLoaded(card.getByTestId('closing-snap'));
    await expect(card.getByTestId('opening-snap')).toHaveAttribute('src', r.openingSnapUrl);
    // the opening snap is an OPENING kind snapshot in the image directory
    const snaps = await (await api()).get('/api/image-directory', { storeIds: '1', from: yesterday, to: yesterday, kind: 'OPENING' });
    expect(snaps.items.map((s: any) => s.url)).toContain(r.openingSnapUrl);
    await card.getByTestId('opening-snap').click();
    await imgLoaded(page.getByTestId('dialog-snap').locator('img'));
    await page.keyboard.press('Escape');
    // status filter
    await page.getByTestId('filter-oc-status').getByRole('radio', { name: r.detectionStatus === 'BREACHED' ? 'Breached' : 'Complied' }).click();
    await expect(card).toBeVisible();
    await page.getByTestId('filter-oc-status').getByRole('radio', { name: r.detectionStatus === 'BREACHED' ? 'Complied' : 'Breached' }).click();
    await expect(card).toHaveCount(0);
    expect(todayLocal() > yesterday).toBe(true);
  });
});
