/**
 * Contract v2 analytics (Tango Traffic / Zone / RevOp parity): conversion flow chart, gender & dwell, traffic density,
 * hourly drop-off, customers per staff, zone bounced % / concentration %, journey highlights + multi-store,
 * grouped benchmark. All comparisons use an immutable historical window, so UI and API must agree exactly.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { canvasInk, chartTooltipOnRow, fmt, histRange, kpiText, matMultiSelect, openWithRange, waitForApi } from '../support/ui';

const FLOW = [
  ['Footfall', 'footfall'],
  ['Engagers', 'engaged'],
  ['Billable entities', 'billableEntities'],
  ['Conversion', 'transactions'],
] as const;

/**
 * Reads the 4 stages of a conversion-flow chart through its tooltips: 'rows' = horizontal bars, categories top → bottom
 * (conversion page); 'columns' = funnel drawn left → right (traffic page), each stage sampled at its centre.
 */
async function readFlowChart(page: Page, testId: string, layout: 'rows' | 'columns' = 'rows'): Promise<string[]> {
  const chart = page.getByTestId(testId);
  await chart.scrollIntoViewIfNeeded();
  const box = (await chart.boundingBox())!;
  const out: string[] = [];
  for (let i = 0; i < 4; i++) {
    if (layout === 'rows') {
      const y = (8 + ((i + 0.5) * (box.height - 16)) / 4) / box.height;
      out.push((await chartTooltipOnRow(page, chart, y)) ?? '');
    } else {
      const x = (8 + ((i + 0.5) * (box.width - 16)) / 4) / box.width;
      out.push((await chartTooltipOnRow(page, chart, 0.5, x, x + 0.001)) ?? '');
    }
  }
  return out;
}

test.describe('Analytics v2', () => {
  test('traffic: KPIs, conversion flow (Footfall → Engagers → Billable entities → Conversion) and gender & dwell card match the API', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const range = histRange();
    const convResp = waitForApi(page, '/api/analytics/conversion', (u) => u.searchParams.get('from') === range.from);
    const demoResp = waitForApi(page, '/api/analytics/demographics', (u) => u.searchParams.get('from') === range.from);
    const ui = await openWithRange(page, '/analytics/traffic', '/api/analytics/traffic', range);
    const admin = await api();
    const t = await admin.get('/api/analytics/traffic', range);
    const c = await admin.get('/api/analytics/conversion', range);
    const d = await admin.get('/api/analytics/demographics', range);
    expect(ui).toEqual(t);
    expect((await (await convResp).json()).funnel).toEqual(c.funnel);
    expect((await (await demoResp).json()).gender).toEqual(d.gender);

    // footfall, groups vs individuals, engaged / bounced, repeat vs new
    expect(await kpiText(page, 'footfall-in')).toBe(fmt.number(t.totals.footfallIn));
    expect(t.totals.billableEntities).toBe(t.totals.individuals + t.totals.groups);
    await expect(page.getByTestId('kpi-billable-entities')).toContainText(`${fmt.number(t.totals.individuals)} individuals · ${fmt.number(t.totals.groups)} groups`);
    await expect(page.getByTestId('kpi-engaged')).toContainText(`${fmt.number(t.totals.engaged)} visits`);
    await expect(page.getByTestId('kpi-bounced')).toContainText(`${fmt.number(t.totals.bounced)} visits`);
    await expect(page.getByTestId('kpi-repeat-visitors')).toContainText(`${fmt.number(t.totals.repeatVisitors)} repeat · ${fmt.number(t.totals.newVisitors)} new`);
    expect(t.totals.groups).toBeGreaterThan(0);
    expect(t.totals.repeatVisitors).toBeGreaterThan(0);
    expect(t.totals.newVisitors).toBeGreaterThan(0);
    for (const id of ['chart-individuals-groups', 'chart-engagement', 'chart-repeat-new']) {
      await expect.poll(() => canvasInk(page.getByTestId(id)), { message: id }).toBeGreaterThan(50);
    }

    // conversion flow: order and numbers read from the chart's tooltips
    const tips = await readFlowChart(page, 'chart-conversion-flow', 'columns');
    FLOW.forEach(([label, key], i) => {
      const pctOfFootfall = Math.round((c.funnel[key] / c.funnel.footfall) * 1000) / 10;
      expect(tips[i], `flow bar ${i + 1}`).toBe(`${label}: ${fmt.number(c.funnel[key])} (${pctOfFootfall}% of footfall)`);
    });

    // gender & dwell card
    const known = d.gender.male + d.gender.female;
    expect(known).toBeGreaterThan(0);
    const card = page.getByTestId('card-gender-dwell');
    await expect(card.getByTestId('gd-male')).toContainText(`${Math.round((d.gender.male / known) * 100)}%`);
    await expect(card.getByTestId('gd-male')).toContainText(`Male · ${fmt.number(d.gender.male)}`);
    await expect(card.getByTestId('gd-female')).toContainText(`${Math.round((d.gender.female / known) * 100)}%`);
    await expect(card.getByTestId('gd-female')).toContainText(`Female · ${fmt.number(d.gender.female)}`);
    const dominant = d.age.filter((a: any) => a.band !== 'U').reduce((m: any, a: any) => (a.count > m.count ? a : m));
    await expect(card.getByTestId('gd-dwell')).toContainText(fmt.duration(t.totals.avgDwellSec));
    await expect(card.getByTestId('gd-dwell')).toContainText(`dominant age ${dominant.band}`);
    await expect.poll(() => canvasInk(page.getByTestId('chart-gender-dwell'))).toBeGreaterThan(50);
  });

  test('traffic: density matrix (hour × weekday) equals /analytics/traffic-density and drop-off by hour uses hourly bouncedPct', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const range = histRange(28);
    const dens = waitForApi(page, '/api/analytics/traffic-density', (u) => u.searchParams.get('from') === range.from);
    const traffic = await openWithRange(page, '/analytics/traffic', '/api/analytics/traffic', range);
    const api1 = await (await api()).get('/api/analytics/traffic-density', range);
    expect(await (await dens).json()).toEqual(api1);
    expect(api1.cells.length).toBeGreaterThan(0);
    expect(api1.max).toBe(Math.max(...api1.cells.map((x: any) => x.avgFootfall)));

    const table = page.getByTestId('table-traffic-density');
    await expect(table).toBeVisible();
    // columns Mon → Sun
    const heads = (await table.locator('thead th').allInnerTexts()).map((s) => s.trim());
    expect(heads).toEqual(['Hour', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
    // one row per open hour, every cell equals the API value
    const rows = await table.locator('[data-testid^="density-row-"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-testid')!.slice(12))));
    expect(rows).toEqual([...api1.hours].sort((a: number, b: number) => a - b));
    const byKey = new Map(api1.cells.map((x: any) => [`${x.hour}-${x.dow}`, x.avgFootfall]));
    for (const hour of rows) {
      for (const dow of [1, 2, 3, 4, 5, 6, 0]) {
        await expect(page.getByTestId(`density-cell-${hour}-${dow}`)).toHaveText(fmt.number((byKey.get(`${hour}-${dow}`) as number) ?? 0));
      }
    }
    // the busiest cell is painted with the darkest colour of the ramp, an empty-ish one is lighter
    const peak = api1.cells.reduce((m: any, x: any) => (x.avgFootfall > m.avgFootfall ? x : m));
    const bg = (h: number, d: number) => page.getByTestId(`density-cell-${h}-${d}`).evaluate((e) => getComputedStyle(e).backgroundColor);
    const low = api1.cells.reduce((m: any, x: any) => (x.avgFootfall < m.avgFootfall ? x : m));
    expect(await bg(peak.hour, peak.dow)).not.toBe(await bg(low.hour, low.dow));

    // hourly drop-off: every open hour has a bounced % in 0..100 and the chart is drawn
    const open = traffic.hourly.filter((h: any) => h.footfall > 0);
    expect(open.length).toBeGreaterThan(5);
    for (const h of open) {
      expect(h.bouncedPct).toBeGreaterThanOrEqual(0);
      expect(h.bouncedPct).toBeLessThanOrEqual(100);
    }
    expect(open.some((h: any) => h.bouncedPct > 0)).toBe(true);
    await expect.poll(() => canvasInk(page.getByTestId('chart-hourly-bounced'))).toBeGreaterThan(50);
  });

  test('conversion: flow chart order, customers per staff by hour', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const ui = await openWithRange(page, '/analytics/conversion', '/api/analytics/conversion', histRange());
    const c = await (await api()).get('/api/analytics/conversion', histRange());
    expect(ui).toEqual(c);
    const tips = await readFlowChart(page, 'chart-funnel');
    FLOW.forEach(([label, key], i) => expect(tips[i], `funnel bar ${i + 1}`).toContain(`${label}: ${fmt.number(c.funnel[key])}`));
    // customers-per-staff = billable entities ÷ staff present (0 when no staff)
    const staffed = c.hourly.filter((h: any) => h.staffPresentAvg > 0);
    expect(staffed.length).toBeGreaterThan(0);
    for (const h of c.hourly) {
      if (h.staffPresentAvg > 0 && h.billableEntities > 0) expect(h.customersPerStaff, `hour ${h.hour}`).toBeGreaterThan(0);
      else expect(h.customersPerStaff, `hour ${h.hour}`).toBe(0);
    }
    await expect.poll(() => canvasInk(page.getByTestId('chart-customers-per-staff'))).toBeGreaterThan(50);
    // the chart shows the busiest hour's ratio in its tooltip
    const chart = page.getByTestId('chart-customers-per-staff');
    let tip: string | null = null;
    for (const y of [0.85, 0.8, 0.75, 0.7]) {
      tip = await chartTooltipOnRow(page, chart, y, 0.05, 0.98, 0.01);
      if (tip) break;
    }
    expect(tip, 'customers-per-staff tooltip').toMatch(/Customers per staff/);
    const value = Number(tip!.match(/Customers per staff\s*([\d.,]+)/)![1].replace(/,/g, ''));
    const hourValues = c.hourly.map((h: any) => Math.round(h.customersPerStaff * 10) / 10);
    expect(hourValues).toContain(value);
  });

  test('zones: bounced %, concentration %, dominant age and gender split per zone match the API; HOT/DEAD classes are consistent', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const range = histRange();
    const zones = await openWithRange(page, '/analytics/zones', '/api/analytics/zones', range, [1]);
    const apiZones = await (await api()).get('/api/analytics/zones', { ...range, storeIds: '1' });
    expect(zones).toEqual(apiZones);
    expect(apiZones.length).toBeGreaterThanOrEqual(7);
    const footfall = (await (await api()).get('/api/analytics/traffic', { ...range, storeIds: '1' })).totals.footfallIn;
    for (const z of apiZones) {
      const row = page.getByTestId(`row-zone-${z.id}`);
      await expect(row).toContainText(z.name);
      await expect(row).toContainText(fmt.pct(z.bouncedPct));
      await expect(row).toContainText(fmt.pct(z.concentrationPct));
      await expect(row).toContainText(z.dominantAgeBand ?? '--');
      await expect(row).toContainText(`M ${fmt.pct(z.genderSplit.malePct, 0)} · F ${fmt.pct(z.genderSplit.femalePct, 0)}`);
      expect(z.genderSplit.malePct + z.genderSplit.femalePct).toBeCloseTo(100, 0);
      expect(z.concentrationPct).toBeCloseTo((z.engaged / footfall) * 100, 1);
      expect(z.bouncedPct).toBeGreaterThanOrEqual(0);
      expect(z.bouncedPct).toBeLessThanOrEqual(100);
    }
    // HOT ≥ 1.25 × store average, DEAD ≤ 0.5 ×
    const avg = apiZones.reduce((s: number, z: any) => s + z.visits, 0) / apiZones.length;
    for (const z of apiZones) {
      const want = z.visits >= 1.25 * avg ? 'HOT' : z.visits <= 0.5 * avg ? 'DEAD' : 'WARM';
      expect(z.classification, z.name).toBe(want);
      await expect(page.getByTestId(`row-zone-${z.id}`).getByTestId('chip-zone-class')).toHaveAttribute('data-value', want);
    }
    expect(apiZones.some((z: any) => z.classification === 'HOT')).toBe(true);
    expect(apiZones.some((z: any) => z.classification === 'DEAD')).toBe(true);
    // zone concentration summary with the heatmap thumbnail of the top zone
    await expect(page.getByTestId('zone-concentration-summary')).toBeVisible();
    const top = [...apiZones].sort((a: any, b: any) => b.concentrationPct - a.concentrationPct)[0];
    await expect(page.getByTestId(`concentration-zone-${top.id}`)).toContainText(top.name);
    await expect(page.getByTestId('concentration-heatmap')).toBeVisible();
  });

  test('journey: 5 highlight cards from the API and multi-store selection merges zones by name', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const range = histRange();
    const single = await openWithRange(page, '/analytics/journey', '/api/analytics/journey', range, [1]);
    const admin = await api();
    const apiSingle = await admin.get('/api/analytics/journey', { ...range, storeIds: '1' });
    expect(single.highlights).toEqual(apiSingle.highlights);
    for (const key of ['highestFootfall', 'highestImpression', 'highestBounced', 'highestEngaged', 'highestDwell']) {
      const h = apiSingle.highlights[key];
      expect(h, key).toBeTruthy();
      const card = page.getByTestId(`journey-highlight-${key}`);
      await expect(card).toContainText(h.zoneName);
      await expect(card).toContainText(h.label);
    }
    await expect(page.getByTestId('page-journey')).toContainText(`${fmt.number(apiSingle.totalFootfall)} footfall`);
    await expect.poll(() => canvasInk(page.getByTestId('chart-journey-sankey'))).toBeGreaterThan(500);

    // add Anna Nagar + Velachery → one request with storeIds=1,2,3; footfall is the sum of the stores
    const multi = waitForApi(page, '/api/analytics/journey', (u) => (u.searchParams.get('storeIds') ?? '').split(',').length === 3);
    await matMultiSelect(page, 'select-journey-stores', ['Congruence Anna Nagar', 'Congruence Phoenix Marketcity Velachery']);
    const m = await (await multi).json();
    const per = await Promise.all([1, 2, 3].map((s) => admin.get('/api/analytics/journey', { ...range, storeIds: String(s) })));
    expect(m.totalFootfall).toBe(per.reduce((s, j) => s + j.totalFootfall, 0));
    // zones are merged by name: no duplicate node names
    const names = m.nodes.map((n: any) => n.name);
    expect(new Set(names).size).toBe(names.length);
    const sectionNames = new Set(per[0].nodes.map((n: any) => n.name));
    expect(m.nodes.length).toBeLessThanOrEqual(new Set([...per.flatMap((j) => j.nodes.map((n: any) => n.name))]).size);
    expect([...sectionNames].every((n) => names.includes(n))).toBe(true);
    await expect(page.getByTestId('page-journey')).toContainText(`${fmt.number(m.totalFootfall)} footfall`);
    await expect(page.getByTestId('journey-highlight-highestFootfall')).toContainText(m.highlights.highestFootfall.zoneName);
  });

  test('benchmark: group by region and by format equals /analytics/benchmark/groups; store rows show the format', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const range = histRange();
    // the 6 seeded stores (other tests create and deactivate stores of their own in parallel)
    const SEED = [1, 2, 3, 4, 5, 6];
    const rows = await openWithRange(page, '/analytics/benchmark', '/api/analytics/benchmark', range, SEED);
    const admin = await api();
    const stores = (await admin.get('/api/stores')).filter((s: any) => SEED.includes(s.id));
    expect(rows.map((r: any) => r.storeId).sort()).toEqual(SEED);
    for (const r of rows) {
      const st = stores.find((s: any) => s.id === r.storeId);
      expect(r.format).toBe(st.format);
      await expect(page.getByTestId(`row-benchmark-${r.storeId}`)).toContainText(st.format.replace(/_/g, ' ').toLowerCase().replace(/^./, (x: string) => x.toUpperCase()));
    }
    expect(new Set(stores.map((s: any) => s.format)).size).toBeGreaterThanOrEqual(3);

    for (const groupBy of ['region', 'format'] as const) {
      const resp = waitForApi(page, '/api/analytics/benchmark/groups', (u) => u.searchParams.get('groupBy') === groupBy);
      await page.getByTestId(`group-${groupBy}`).click();
      const ui = await (await resp).json();
      const g = await admin.get('/api/analytics/benchmark/groups', { ...range, groupBy, storeIds: SEED.join(',') });
      expect(ui).toEqual(g);
      const keyOf = (s: any) => (groupBy === 'region' ? s.regionName : s.format);
      const expectedGroups = [...new Set(stores.map(keyOf))].sort();
      expect(g.map((x: any) => x.group).sort()).toEqual(expectedGroups);
      // each group aggregates its stores' footfall exactly
      for (const grp of g) {
        const members = rows.filter((r: any) => keyOf(stores.find((s: any) => s.id === r.storeId)) === grp.group);
        expect(grp.stores, `${groupBy} ${grp.group}`).toBe(members.length);
        expect(grp.footfall, `${groupBy} ${grp.group} footfall`).toBe(members.reduce((s: number, r: any) => s + r.footfall, 0));
        const row = page.getByTestId(`row-benchmark-group-${grp.group}`);
        await expect(row).toContainText(fmt.number(grp.footfall));
        await expect(row).toContainText(fmt.pct(grp.conversionPct));
      }
      await expect.poll(() => canvasInk(page.getByTestId('chart-benchmark-groups'))).toBeGreaterThan(50);
    }
    await page.getByTestId('group-store').click();
    await expect(page.getByTestId('table-benchmark')).toBeVisible();
  });
});
