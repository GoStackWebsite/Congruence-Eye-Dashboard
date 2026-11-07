import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { addDays, todayLocal } from '../support/env';
import { canvasInk, fmt, kpiText, matSelect, presetFilter, rowIds, waitForApi } from '../support/ui';

const Y = () => addDays(todayLocal(), -1);
/** Historical, immutable window (no test writes into the past), so UI ↔ API comparisons are exact. */
const HIST = () => ({ from: addDays(todayLocal(), -7), to: addDays(todayLocal(), -1) });

/** The 6 seeded stores (other tests create and deactivate stores of their own in parallel). */
const SEED_STORES = [1, 2, 3, 4, 5, 6];

async function openWithHistFilter(page: Page, url: string, apiPath: string, storeIds: number[] = []) {
  const h = HIST();
  await presetFilter(page, { preset: 'custom', custom: h, storeIds });
  const resp = waitForApi(page, apiPath, (u) => u.searchParams.get('from') === h.from && u.searchParams.get('to') === h.to);
  await page.goto(url);
  return (await resp).json();
}

test.describe('Analytics', () => {
  test('traffic KPIs equal the API totals and all charts render', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const ui = await openWithHistFilter(page, '/analytics/traffic', '/api/analytics/traffic');
    const t = (await (await api()).get('/api/analytics/traffic', HIST())).totals;
    expect(ui.totals).toEqual(t);
    expect(t.footfallIn).toBeGreaterThan(0);
    expect(await kpiText(page, 'footfall-in')).toBe(fmt.number(t.footfallIn));
    expect(await kpiText(page, 'unique-visitors')).toBe(fmt.number(t.uniqueVisitors));
    expect(await kpiText(page, 'billable-entities')).toBe(fmt.number(t.billableEntities));
    expect(await kpiText(page, 'staff-excluded')).toBe(fmt.number(t.staffExcluded));
    expect(await kpiText(page, 'avg-dwell')).toBe(fmt.duration(t.avgDwellSec));
    // billable entities = individuals + groups
    expect(t.billableEntities).toBe(t.individuals + t.groups);
    await expect(page.getByTestId('kpi-billable-entities')).toContainText(`${fmt.number(t.individuals)} individuals · ${fmt.number(t.groups)} groups`);
    await expect(page.getByTestId('kpi-peak-hour').getByTestId('kpi-value')).not.toHaveText(/^\s*(—|--)?\s*$/);
    for (const id of ['chart-traffic-daily', 'chart-individuals-groups', 'chart-engagement', 'chart-repeat-new', 'chart-traffic-hourly', 'chart-traffic-dow']) {
      await expect.poll(() => canvasInk(page.getByTestId(id)), { message: id }).toBeGreaterThan(50);
    }
    expect(ui.daily.length).toBe(7);
    expect(ui.hourly.length).toBe(24);
  });

  test('demographics KPIs match the API and add up', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    await openWithHistFilter(page, '/analytics/demographics', '/api/analytics/demographics');
    const d = await (await api()).get('/api/analytics/demographics', HIST());
    expect(d.gender.male + d.gender.female).toBeGreaterThan(0);
    expect(await kpiText(page, 'male')).toBe(fmt.number(d.gender.male));
    expect(await kpiText(page, 'female')).toBe(fmt.number(d.gender.female));
    expect(await kpiText(page, 'unknown')).toBe(fmt.number(d.gender.unknown));
    const ageSum = d.age.reduce((s: number, a: any) => s + a.count, 0);
    expect(ageSum).toBe(d.gender.male + d.gender.female + d.gender.unknown);
    for (const id of ['chart-gender', 'chart-age', 'chart-gender-by-age']) {
      await expect.poll(() => canvasInk(page.getByTestId(id)), { message: id }).toBeGreaterThan(50);
    }
  });

  test('zones table has HOT/WARM/DEAD chips consistent with the API and the class filter works', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const zones = await openWithHistFilter(page, '/analytics/zones', '/api/analytics/zones');
    const table = page.getByTestId('table-zones');
    await expect(table.locator('[data-testid^="row-zone-"]').first()).toBeVisible();
    const count = (c: string) => zones.filter((z: any) => z.classification === c).length;
    for (const c of ['HOT', 'WARM', 'DEAD']) {
      expect(count(c), `${c} zones in API`).toBeGreaterThan(0);
      await expect(table.locator(`[data-testid="chip-zone-class"][data-value="${c}"]`).first()).toBeVisible();
    }
    expect(await kpiText(page, 'zones-hot')).toBe(String(count('HOT')));
    expect(await kpiText(page, 'zones-warm')).toBe(String(count('WARM')));
    expect(await kpiText(page, 'zones-dead')).toBe(String(count('DEAD')));
    // classification rule: per store, HOT ≥ 1.25 × avg visits, DEAD ≤ 0.5 ×
    const byStore = new Map<number, any[]>();
    for (const z of zones) byStore.set(z.storeId, [...(byStore.get(z.storeId) ?? []), z]);
    for (const list of byStore.values()) {
      const avg = list.reduce((s, z) => s + z.visits, 0) / list.length;
      for (const z of list) {
        const expected = z.visits >= 1.25 * avg ? 'HOT' : z.visits <= 0.5 * avg ? 'DEAD' : 'WARM';
        expect(z.classification, `${z.storeName}/${z.name}`).toBe(expected);
      }
    }
    // a specific row shows the API values
    const z0 = zones[0];
    const row = page.getByTestId(`row-zone-${z0.id}`);
    await expect(row.getByTestId('chip-zone-class')).toHaveAttribute('data-value', z0.classification);
    await expect(row).toContainText(z0.name);

    // filter to HOT only
    await page.getByTestId('filter-zone-class').getByRole('radio', { name: 'Hot' }).click();
    await expect(table.locator('[data-testid="chip-zone-class"][data-value="WARM"]')).toHaveCount(0);
    await expect(table.locator('[data-testid="chip-zone-class"][data-value="DEAD"]')).toHaveCount(0);
    await expect(table.locator('[data-testid="chip-zone-class"][data-value="HOT"]').first()).toBeVisible();
    await page.getByTestId('filter-zone-class').getByRole('radio', { name: 'Dead' }).click();
    await expect(table.locator('[data-testid="chip-zone-class"][data-value="HOT"]')).toHaveCount(0);
    await expect(table.locator('[data-testid="chip-zone-class"][data-value="DEAD"]').first()).toBeVisible();
    await expect.poll(() => canvasInk(page.getByTestId('chart-zone-dwell'))).toBeGreaterThan(50);
  });

  test('heatmap canvas is painted with non-blank pixels from the API grid', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const heat = await openWithHistFilter(page, '/analytics/heatmap', '/api/analytics/heatmap');
    expect(heat.width).toBe(32);
    expect(heat.height).toBe(18);
    expect(heat.grid.length).toBe(32 * 18);
    expect(heat.max).toBeGreaterThan(0);
    const canvas = page.getByTestId('heatmap-canvas');
    await expect.poll(() => canvasInk(canvas)).toBeGreaterThan(1000);
    await expect(page.getByTestId('heatmap-legend')).toContainText(`peak cell ${fmt.number(heat.max)}`);

    // switching camera loads that camera's grid (the picker defaults to the first store by name)
    const cams = await (await api()).get('/api/cameras');
    const storeOfCam = cams.find((x: any) => x.id === heat.cameraId).storeId;
    const store = { cameras: cams.filter((c: any) => c.storeId === storeOfCam) };
    const other = store.cameras.find((c: any) => c.type === 'ZONE' && c.id !== heat.cameraId);
    const next = waitForApi(page, '/api/analytics/heatmap', (u) => u.searchParams.get('cameraId') === String(other.id));
    await matSelect(page, 'select-heatmap-camera', { testId: `select-heatmap-camera-option-${other.id}` });
    const h2 = await (await next).json();
    expect(h2.cameraId).toBe(other.id);
    await expect(page.getByTestId('heatmap-legend')).toContainText(`peak cell ${fmt.number(h2.max)}`);
    await expect.poll(() => canvasInk(canvas)).toBeGreaterThan(h2.max > 0 ? 1000 : -1);
  });

  test('journey sankey renders and the top transitions come from the API links', async ({ pageAs }) => {
    const page = await pageAs('admin');
    const j = await openWithHistFilter(page, '/analytics/journey', '/api/analytics/journey');
    expect(j.nodes.find((n: any) => n.id === 0)?.name).toBe('Entrance');
    expect(j.links.length).toBeGreaterThan(0);
    await expect.poll(() => canvasInk(page.getByTestId('chart-journey-sankey')), { timeout: 15000 }).toBeGreaterThan(500);
    const top = page.getByTestId('journey-top-links').locator('li');
    await expect(top.first()).toBeVisible();
    expect(await top.count()).toBeGreaterThan(0);
    expect(await top.count()).toBeLessThanOrEqual(8);
    const name = (id: number) => j.nodes.find((n: any) => n.id === id).name;
    const total = j.links.reduce((s: number, l: any) => s + l.count, 0);
    await expect(page.getByTestId('page-journey')).toContainText(`${fmt.number(total)} transitions`);
    // the first listed transition exists in the API data with the same count
    const firstText = (await top.first().innerText()).replace(/\s+/g, ' ');
    const match = j.links.some((l: any) => firstText.includes(`${name(l.source)} → ${name(l.target)}`) && firstText.endsWith(fmt.number(l.count)));
    expect(match, firstText).toBe(true);
  });

  test('conversion funnel numbers match /api/analytics/conversion', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const ui = await openWithHistFilter(page, '/analytics/conversion', '/api/analytics/conversion');
    const c = await (await api()).get('/api/analytics/conversion', HIST());
    expect(ui.funnel).toEqual(c.funnel);
    expect(ui.segments).toEqual(c.segments);
    // funnel is monotonic like Tango's conversion flow: Footfall → Engagers → (engaged) Billable entities → Conversion
    expect(c.funnel.footfall).toBeGreaterThanOrEqual(c.funnel.engaged);
    expect(c.funnel.engaged).toBeGreaterThanOrEqual(c.funnel.billableEntities);
    expect(c.funnel.transactions).toBe(c.totals.transactions);
    // conversion % is over ALL billable entities (traffic totals); missed = engaged billable − bills
    const t = await (await api()).get('/api/analytics/traffic', HIST());
    expect(c.totals.conversionPct).toBeCloseTo((c.totals.transactions / t.totals.billableEntities) * 100, 1);
    expect(c.segments.missedOpportunities).toBe(Math.max(0, c.funnel.billableEntities - c.funnel.transactions));

    expect(await kpiText(page, 'conversion')).toBe(fmt.pct(c.totals.conversionPct));
    expect(await kpiText(page, 'transactions')).toBe(fmt.number(c.totals.transactions));
    expect(await kpiText(page, 'revenue')).toBe(fmt.inrCompact(c.totals.revenue));
    expect(await kpiText(page, 'atv')).toBe(fmt.inr(c.totals.atv));
    expect(await kpiText(page, 'missed-opportunities')).toBe(fmt.number(c.segments.missedOpportunities));
    await expect(page.getByTestId('segment-bounced').locator('.seg-value')).toHaveText(fmt.number(c.segments.bounced));
    await expect(page.getByTestId('segment-missed').locator('.seg-value')).toHaveText(fmt.number(c.segments.missedOpportunities));
    await expect(page.getByTestId('segment-converted').locator('.seg-value')).toHaveText(fmt.number(c.segments.converted));
    await expect.poll(() => canvasInk(page.getByTestId('chart-funnel'))).toBeGreaterThan(50);
    // by-store table
    for (const s of c.byStore) {
      const row = page.getByTestId(`row-conversion-${s.storeId}`);
      await expect(row).toContainText(s.storeName);
      await expect(row).toContainText(fmt.pct(s.conversionPct));
      await expect(row).toContainText(fmt.inr(s.revenue));
    }
  });

  test('queue KPIs, live queue cards and per-counter table match the API', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const ui = await openWithHistFilter(page, '/analytics/queue', '/api/analytics/queue');
    const q = await (await api()).get('/api/analytics/queue', HIST());
    expect(ui.totals).toEqual(q.totals);
    expect(q.totals.maxQueueLength).toBeGreaterThan(0);
    expect(await kpiText(page, 'max-queue-length')).toBe(fmt.number(q.totals.maxQueueLength));
    expect(await kpiText(page, 'avg-wait')).toBe(fmt.duration(q.totals.avgWaitSec));
    expect(await kpiText(page, 'max-wait')).toBe(fmt.duration(q.totals.maxWaitSec));
    expect(await kpiText(page, 'breaches')).toBe(fmt.number(q.totals.breaches));
    const table = page.getByTestId('table-queue-counters');
    await expect(table.locator('[data-testid^="row-counter-"]')).toHaveCount(q.byCounter.length);
    expect(q.byCounter.length).toBe(12); // 2 billing counters × 6 stores
    const live = page.getByTestId('live-queues');
    await expect(live.locator('[data-testid^="queue-card-"]')).toHaveCount(ui.live.length);
    expect(ui.live.length).toBeGreaterThan(0);
    await expect.poll(() => canvasInk(page.getByTestId('chart-queue-hourly'))).toBeGreaterThan(50);
  });

  test('store ops highlights late openings and the issues filter keeps only late/early rows', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const from = addDays(todayLocal(), -29);
    const to = Y();
    await presetFilter(page, { preset: 'custom', custom: { from, to } });
    const resp = waitForApi(page, '/api/analytics/storeops', (u) => u.searchParams.get('from') === from);
    await page.goto('/analytics/store-ops');
    const ops = await (await resp).json();
    const apiOps = await (await api()).get('/api/analytics/storeops', { from, to });
    expect(ops.totals).toEqual(apiOps.totals);
    expect(apiOps.totals.lateOpenings).toBeGreaterThan(0);
    expect(await kpiText(page, 'late-openings')).toBe(fmt.number(apiOps.totals.lateOpenings));
    expect(await kpiText(page, 'early-closings')).toBe(fmt.number(apiOps.totals.earlyClosings));
    expect(await kpiText(page, 'camera-uptime')).toBe(fmt.pct(apiOps.totals.cameraUptimePct));
    expect(apiOps.openClose.filter((r: any) => r.lateOpenMin > 0).length).toBe(apiOps.totals.lateOpenings);

    const table = page.getByTestId('table-open-close');
    await page.getByTestId('filter-open-close').getByRole('radio', { name: /Late \/ early only/ }).click();
    const rows = table.locator('[data-testid^="row-open-close-"]');
    await expect(rows.first()).toBeVisible();
    const n = await rows.count();
    for (let i = 0; i < n; i++) {
      const r = rows.nth(i);
      const late = await r.locator('[data-late="true"]').count();
      const early = await r.locator('[data-early="true"]').count();
      expect(late + early, `row ${i} is late or early`).toBeGreaterThan(0);
    }
    // a late row (from the API) is highlighted with the late marker and the minutes late
    const lateRow = apiOps.openClose.find((r: any) => r.lateOpenMin > 0);
    const cell = table.locator('td[data-late="true"]').first();
    await expect(cell).toHaveClass(/cell-bad/);
    await expect(cell).toContainText(/min late/);
    await expect(table.locator('tr.row-late').first()).toBeVisible();
    expect(lateRow.actualOpen > lateRow.scheduledOpen).toBe(true);

    // camera health includes the seeded offline camera, events list renders
    const offline = apiOps.cameraHealth.find((c: any) => c.status === 'OFFLINE');
    expect(offline).toBeTruthy();
    await expect(page.getByTestId(`row-camera-health-${offline.cameraId}`).locator('[data-value="OFFLINE"]')).toBeVisible();
    await expect(page.getByTestId('storeops-events').locator('[data-testid^="storeops-event-"]').first()).toBeVisible();
  });

  test('benchmark is sorted by rank and column sorting works', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const rows = await openWithHistFilter(page, '/analytics/benchmark', '/api/analytics/benchmark', SEED_STORES);
    const apiRows = await (await api()).get('/api/analytics/benchmark', { ...HIST(), storeIds: SEED_STORES.join(',') });
    expect(rows).toEqual(apiRows);
    const table = page.getByTestId('table-benchmark');
    await expect(table.locator('[data-testid^="row-benchmark-"]')).toHaveCount(6);
    // rank is by revenue, descending
    const byRank = [...apiRows].sort((a: any, b: any) => a.rank - b.rank);
    for (let i = 1; i < byRank.length; i++) expect(byRank[i - 1].revenue).toBeGreaterThanOrEqual(byRank[i].revenue);
    expect(await rowIds(table, 'row-benchmark-')).toEqual(byRank.map((r: any) => r.storeId));
    await expect(table.getByTestId(`row-benchmark-${byRank[0].storeId}`)).toContainText(fmt.inr(byRank[0].revenue));

    // sort by footfall ascending, then descending
    await table.getByRole('columnheader', { name: 'Footfall' }).click();
    const asc = [...apiRows].sort((a: any, b: any) => a.footfall - b.footfall).map((r: any) => r.storeId);
    await expect.poll(() => rowIds(table, 'row-benchmark-')).toEqual(asc);
    await table.getByRole('columnheader', { name: 'Footfall' }).click();
    await expect.poll(() => rowIds(table, 'row-benchmark-')).toEqual([...asc].reverse());
    // store name sorts alphabetically
    await table.getByRole('columnheader', { name: 'Store' }).click();
    const alpha = [...apiRows].sort((a: any, b: any) => a.storeName.toLowerCase().localeCompare(b.storeName.toLowerCase())).map((r: any) => r.storeId);
    await expect.poll(() => rowIds(table, 'row-benchmark-')).toEqual(alpha);

    // client CSV export follows the current order
    const dl = page.waitForEvent('download');
    await page.getByTestId('btn-export-csv').click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/^benchmark_.*\.csv$/);
    const csv = (await import('fs')).readFileSync(await file.path(), 'utf8').replace(/^﻿/, '');
    const lines = csv.trim().split(/\r?\n/);
    expect(lines.length).toBe(7);
    const firstStore = apiRows.find((r: any) => r.storeId === alpha[0]).storeName;
    expect(lines[1]).toContain(firstStore);
  });

  test('live view shows today KPIs, queues, cameras and recent events for the selected store', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const first = waitForApi(page, '/api/analytics/live');
    await page.goto('/live');
    await first; // default store = first by name
    const resp = waitForApi(page, '/api/analytics/live', (u) => u.searchParams.get('storeId') === '1');
    await matSelect(page, 'select-live-store', { testId: 'select-live-store-option-1' });
    await resp;
    await expect(page.getByTestId('select-live-store')).toContainText('T Nagar');
    const admin = await api();
    await expect(page.getByTestId('live-cameras').locator('[data-testid^="camera-tile-"]')).toHaveCount(5);
    await expect(page.getByTestId('live-queues').locator('[data-testid^="queue-card-"]')).toHaveCount(2);
    await expect(page.getByTestId('live-events').locator('li').first()).toBeVisible();
    // values follow the API (re-read on refresh to tolerate concurrent ingestion)
    await expect(async () => {
      const r = waitForApi(page, '/api/analytics/live', (u) => u.searchParams.get('storeId') === '1');
      await page.getByTestId('btn-live-refresh').click();
      const ui = await (await r).json();
      expect(ui.todayFootfall).toBeGreaterThan(0);
      await expect(page.getByTestId('kpi-live-today-footfall').getByTestId('kpi-value')).toHaveText(fmt.number(ui.todayFootfall), { timeout: 3000 });
      await expect(page.getByTestId('kpi-live-transactions').getByTestId('kpi-value')).toHaveText(fmt.number(ui.todayTransactions), { timeout: 3000 });
      expect(ui.recentEvents.length).toBe(20);
    }).toPass({ timeout: 30000 });

    // switching store reloads the store's live data
    const r2 = waitForApi(page, '/api/analytics/live', (u) => u.searchParams.get('storeId') === '3');
    await matSelect(page, 'select-live-store', { testId: 'select-live-store-option-3' });
    const l3 = await (await r2).json();
    expect(l3.storeId).toBe(3);
    const apiL3 = await admin.get('/api/analytics/live', { storeId: 3 });
    expect(apiL3.cameras.map((c: any) => c.id)).toEqual(l3.cameras.map((c: any) => c.id));
    for (const c of l3.cameras) await expect(page.getByTestId(`camera-tile-${c.id}`)).toBeVisible();
  });
});
