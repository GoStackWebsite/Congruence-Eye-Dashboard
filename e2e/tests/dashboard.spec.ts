import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { addDays, todayLocal } from '../support/env';
import { fmt, kpiText, matSelect, parseUiNumber, waitForApi } from '../support/ui';

const kpiValue = (page: Page, id: string) => page.getByTestId(`kpi-${id}`).getByTestId('kpi-value');

async function overviewFrom(page: Page, action: () => Promise<unknown>, predicate?: (u: URL) => boolean) {
  const resp = waitForApi(page, '/api/analytics/overview', predicate);
  await action();
  return (await resp).json();
}

test.describe('Dashboard', () => {
  test('KPI cards show non-zero, correctly formatted values that match the API', async ({ pageAs }) => {
    const page = await pageAs('admin');
    const ov = await overviewFrom(page, () => page.goto('/dashboard'));
    await expect(page.getByTestId('kpi-grid')).toBeVisible();

    const footfall = await kpiText(page, 'footfall');
    expect(footfall).toMatch(/^[\d,]+$/);
    expect(parseUiNumber(footfall)).toBeGreaterThan(0);
    expect(footfall).toBe(fmt.number(ov.kpis.footfall.value));

    const revenue = await kpiText(page, 'revenue');
    expect(revenue).toMatch(/^₹[\d.,]+( (K|L|Cr))?$/);
    expect(parseUiNumber(revenue)).toBeGreaterThan(0);
    expect(revenue).toBe(fmt.inrCompact(ov.kpis.revenue.value));

    const conversion = await kpiText(page, 'conversion');
    expect(conversion).toMatch(/^\d+\.\d%$/);
    expect(parseUiNumber(conversion)).toBeGreaterThan(0);
    expect(conversion).toBe(fmt.pct(ov.kpis.conversionPct.value));

    expect(await kpiText(page, 'atv')).toBe(fmt.inr(ov.kpis.atv.value));
    expect(await kpiText(page, 'transactions')).toBe(fmt.number(ov.kpis.transactions.value));
    expect(await kpiText(page, 'avg-dwell')).toBe(fmt.duration(ov.kpis.avgDwellSec.value));
    expect(await kpiText(page, 'compliance')).toMatch(/%$/);
    for (const id of ['unique-visitors', 'billable-entities', 'engaged', 'bounce-rate', 'missed-opportunities', 'queue-wait', 'open-alerts']) {
      await expect(kpiValue(page, id)).not.toHaveText(/^\s*(—|--)?\s*$/);
    }
    // the chart and side panels render with data
    await expect(page.getByTestId('chart-daily').locator('canvas').first()).toBeVisible();
    expect(ov.daily.length).toBe(7);
    await expect(page.getByTestId('dashboard-top-stores').locator('li')).toHaveCount(5);
    await expect(page.getByTestId('dashboard-open-alerts').locator('[data-testid^="dashboard-alert-"]').first()).toBeVisible();
  });

  test('period presets change the KPI values (Yesterday vs Last 30 days)', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    await overviewFrom(page, () => page.goto('/dashboard'));
    const last7 = parseUiNumber(await kpiText(page, 'footfall'));

    const y = addDays(todayLocal(), -1);
    const ovY = await overviewFrom(
      page,
      () => matSelect(page, 'filter-range-preset', { testId: 'filter-preset-yesterday' }),
      (u) => u.searchParams.get('from') === y,
    );
    expect(ovY.daily.length).toBe(1);
    await expect(kpiValue(page, 'footfall')).toHaveText(fmt.number(ovY.kpis.footfall.value));
    const yesterday = ovY.kpis.footfall.value;
    expect(yesterday).toBeGreaterThan(0);
    expect(yesterday).toBeLessThan(last7);
    // historical data is immutable → independent API call gives the identical number
    const apiY = await (await api('admin')).get('/api/analytics/overview', { from: y, to: y });
    expect(apiY.kpis.footfall.value).toBe(yesterday);
    expect(apiY.kpis.revenue.value).toBe(ovY.kpis.revenue.value);
    await expect(kpiValue(page, 'revenue')).toHaveText(fmt.inrCompact(apiY.kpis.revenue.value));

    const ov30 = await overviewFrom(
      page,
      () => matSelect(page, 'filter-range-preset', { testId: 'filter-preset-last30' }),
      (u) => u.searchParams.get('from') === addDays(todayLocal(), -29),
    );
    expect(ov30.daily.length).toBe(30);
    await expect(kpiValue(page, 'footfall')).toHaveText(fmt.number(ov30.kpis.footfall.value));
    expect(ov30.kpis.footfall.value).toBeGreaterThan(last7);
    // the subtitle reflects the range
    await expect(page.getByTestId('page-dashboard')).toContainText('Overview · ');
  });

  test('compare toggle shows the change % against the previous period', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await overviewFrom(page, () => page.goto('/dashboard'));
    await expect(page.getByTestId('kpi-footfall').getByTestId('kpi-change')).toHaveCount(0);
    const y = addDays(todayLocal(), -1);
    await overviewFrom(page, () => matSelect(page, 'filter-range-preset', { testId: 'filter-preset-yesterday' }), (u) => u.searchParams.get('from') === y);

    const ov = await overviewFrom(
      page,
      () => page.getByTestId('filter-compare').getByRole('switch').click(),
      (u) => u.searchParams.get('compare') === 'true',
    );
    const k = ov.kpis.footfall;
    expect(typeof k.previous).toBe('number');
    expect(typeof k.changePct).toBe('number');
    const change = page.getByTestId('kpi-footfall').getByTestId('kpi-change');
    await expect(change).toBeVisible();
    const sign = k.changePct > 0 ? '+' : '';
    await expect(change).toContainText(`${sign}${k.changePct.toFixed(1)}%`);
    await expect(change).toContainText(`vs ${fmt.number(k.previous)}`);
    // the change is consistent with value/previous
    if (k.previous > 0) expect(k.changePct).toBeCloseTo(((k.value - k.previous) / k.previous) * 100, 0);
    await expect(page.getByTestId('kpi-revenue').getByTestId('kpi-change')).toContainText('%');
    // open alerts has no previous value → no change badge
    await expect(page.getByTestId('kpi-open-alerts').getByTestId('kpi-change')).toHaveCount(0);

    // turning compare off removes the badges
    await page.getByTestId('filter-compare').getByRole('switch').click();
    await expect(change).toHaveCount(0);
  });

  test('store filter narrows the numbers to the selected store (UI equals API for the same filter)', async ({ pageAs, api }) => {
    const page = await pageAs('admin');
    const y = addDays(todayLocal(), -1);
    await overviewFrom(page, () => page.goto('/dashboard'));
    const all = await overviewFrom(page, () => matSelect(page, 'filter-range-preset', { testId: 'filter-preset-yesterday' }), (u) => u.searchParams.get('from') === y);
    await expect(kpiValue(page, 'footfall')).toHaveText(fmt.number(all.kpis.footfall.value));

    const one = await overviewFrom(
      page,
      async () => {
        await page.getByTestId('filter-stores').click();
        await page.getByTestId('filter-store-option-1').click();
        await page.keyboard.press('Escape');
      },
      (u) => u.searchParams.get('storeIds') === '1',
    );
    await expect(page.getByTestId('filter-stores')).toContainText('T Nagar');
    const admin = await api('admin');
    const apiOne = await admin.get('/api/analytics/overview', { storeIds: '1', from: y, to: y });
    expect(one.kpis.footfall.value).toBe(apiOne.kpis.footfall.value);
    await expect(kpiValue(page, 'footfall')).toHaveText(fmt.number(apiOne.kpis.footfall.value));
    await expect(kpiValue(page, 'revenue')).toHaveText(fmt.inrCompact(apiOne.kpis.revenue.value));
    await expect(kpiValue(page, 'conversion')).toHaveText(fmt.pct(apiOne.kpis.conversionPct.value));
    await expect(kpiValue(page, 'transactions')).toHaveText(fmt.number(apiOne.kpis.transactions.value));
    expect(apiOne.kpis.footfall.value).toBeGreaterThan(0);
    expect(apiOne.kpis.footfall.value).toBeLessThan(all.kpis.footfall.value);

    // the sum of all six stores equals the unfiltered total
    let sum = 0;
    for (const id of [1, 2, 3, 4, 5, 6]) sum += (await admin.get('/api/analytics/overview', { storeIds: String(id), from: y, to: y })).kpis.footfall.value;
    expect(sum).toBe(all.kpis.footfall.value);

    // clearing returns to all stores
    await overviewFrom(page, () => page.getByTestId('filter-stores-clear').click(), (u) => !u.searchParams.has('storeIds'));
    await expect(kpiValue(page, 'footfall')).toHaveText(fmt.number(all.kpis.footfall.value));
  });

  test('theme toggle switches to dark mode and is remembered after reload', async ({ pageAs }) => {
    const page = await pageAs('manager');
    await page.goto('/dashboard');
    const html = page.locator('html');
    const initial = await html.getAttribute('data-theme');
    const other = initial === 'dark' ? 'light' : 'dark';
    await page.getByTestId('btn-theme-toggle').click();
    await expect(html).toHaveAttribute('data-theme', other);
    await page.reload();
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await expect(html).toHaveAttribute('data-theme', other);
  });
});
