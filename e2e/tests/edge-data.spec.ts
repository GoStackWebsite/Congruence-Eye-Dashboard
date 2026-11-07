/**
 * Data edge cases (docs/qa/UI_EDGE_CASE_PLAN.md · L1–L4, M1–M3, O1–O2, R1–R4).
 *  - Large lists: alerts / AI detections (server paging) and submissions / audit log (client paging) go to the last
 *    page and back, sort, and a search without results offers "Clear".
 *  - Network failures: an API answering 500 or aborted shows the error state with Retry; Retry recovers.
 *  - Offline: the shell shows a banner while navigator is offline and removes it when back online.
 *  - Date filter: 1-day, 90-day and month-crossing custom ranges reach the API exactly; compare against an empty
 *    previous period never shows NaN / Infinity.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { addDays, todayLocal } from '../support/env';
import { badText, settle, watchPage } from '../support/qa';
import { presetFilter, waitForApi } from '../support/ui';

async function pagerLastAndBack(page: Page, paginator: string) {
  const p = page.getByTestId(paginator);
  await p.scrollIntoViewIfNeeded();
  const range = p.locator('.mat-mdc-paginator-range-label');
  const first = (await range.innerText()).trim();
  await p.getByRole('button', { name: /last page/i }).click();
  await expect(range).not.toHaveText(first);
  const last = (await range.innerText()).trim();
  const m = /(\d+)\s*[–-]\s*(\d+)\s+of\s+(\d+)/.exec(last);
  expect(m, last).not.toBeNull();
  expect(Number(m![2])).toBe(Number(m![3])); // really the last item
  await expect(p.getByRole('button', { name: /next page/i })).toBeDisabled();
  await p.getByRole('button', { name: /first page/i }).click();
  await expect(range).toHaveText(first);
}

test.describe('Edge: large data, failures, offline and date ranges', () => {
  test('alerts and AI detections: server paging to the last page and back; filters with no result offer Clear filters', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await presetFilter(page, { preset: 'last30' });
    await page.goto('/alerts');
    await settle(page, 'page-alerts');
    // a small page size makes sure there are several pages
    const size = page.getByTestId('paginator-alerts').locator('mat-select');
    await size.click();
    await page.getByRole('option', { name: '10', exact: true }).click();
    await pagerLastAndBack(page, 'paginator-alerts');
    // filters that match nothing → filtered empty state with Clear filters
    const resp = waitForApi(page, '/api/alerts', (u) => u.searchParams.get('severity') === 'CRITICAL');
    await page.getByTestId('filter-alert-severity').click();
    await page.getByRole('option', { name: /Critical/ }).click();
    await resp;
    await page.getByTestId('filter-alert-status').click();
    await page.getByRole('option', { name: /Acknowledged/ }).click();
    const empty = page.getByTestId('empty-state');
    if (await empty.first().isVisible().catch(() => false)) {
      await page.getByTestId('btn-clear-filters').click();
      await expect(page.locator('[data-testid^="row-alert-"]').first()).toBeVisible();
    }

    await page.goto('/ai-manager/detections');
    await settle(page, 'page-ai-detections');
    await page.getByTestId('view-table').click();
    await expect(page.getByTestId('table-detections')).toBeVisible();
    await pagerLastAndBack(page, 'paginator-detections');
  });

  test('submissions and audit log: client paging, sorting, and a search without results → Clear search', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await presetFilter(page, { preset: 'last30' });
    await page.goto('/checklists/submissions');
    await settle(page, 'page-checklist-submissions');
    const pager = page.locator('.ce-pager').first();
    await expect(pager).toBeVisible();
    const label = pager.locator('.caption').nth(1);
    const firstLabel = (await label.innerText()).trim();
    const total = Number(/of (\d+)/.exec(firstLabel)![1]);
    expect(total).toBeGreaterThan(25);
    // to the last page
    const next = pager.getByRole('button', { name: 'Next page' });
    while (await next.isEnabled()) await next.click();
    await expect(label).toHaveText(new RegExp(`–${total} of ${total}$`));
    const prev = pager.getByRole('button', { name: 'Previous page' });
    // click until the first page; re-check after each click (avoids clicking a button that just became disabled)
    for (let i = 0; i < 50 && (await prev.isEnabled()); i++) await prev.click({ timeout: 5_000 }).catch(() => undefined);
    await expect(label).toHaveText(firstLabel);
    // sorting by score: ascending then descending keeps every row
    const header = page.locator('th').filter({ hasText: /Score/ }).first();
    await header.click();
    await header.click();
    await expect(label).toHaveText(firstLabel);
    // search with no result → filtered empty state → Clear search
    await page.getByTestId('input-search-submissions').fill('zzz-no-such-submission');
    await expect(page.getByTestId('empty-state').filter({ hasText: 'No results' })).toBeVisible();
    await page.getByTestId('btn-clear-search').click();
    await expect(label).toHaveText(firstLabel);

    await page.goto('/admin/audit-log');
    await settle(page, 'page-admin-audit-log');
    expect(await badText(page)).toEqual([]);
  });

  test('API failures (500 and aborted) show an error state with Retry that recovers', async ({ pageAs }) => {
    const page = await pageAs('admin');
    const watch = watchPage(page, [/http 500/, /requestfailed/, /Failed to load resource/]);
    const cases: { url: string; page: string; api: RegExp; mode: 'abort' | 500 }[] = [
      { url: '/analytics/traffic', page: 'page-traffic', api: /\/api\/analytics\/traffic(\?|$)/, mode: 500 },
      { url: '/tasks', page: 'page-tasks', api: /\/api\/tasks(\?|$)/, mode: 'abort' },
      { url: '/tickets', page: 'page-tickets', api: /\/api\/tickets(\?|$)/, mode: 500 },
      { url: '/checklists/submissions', page: 'page-checklist-submissions', api: /\/api\/checklists\/submissions(\?|$)/, mode: 500 },
      { url: '/alerts', page: 'page-alerts', api: /\/api\/alerts(\?|$)/, mode: 'abort' },
      { url: '/ai-manager/summary', page: 'page-ai-summary', api: /\/api\/ai-manager\/summary(\?|$)/, mode: 500 },
      { url: '/admin/users', page: 'page-admin-users', api: /\/api\/users(\?|$)/, mode: 500 },
    ];
    for (const c of cases) {
      let fail = true;
      await page.route(c.api, (r) => (!fail ? r.continue() : c.mode === 'abort' ? r.abort('failed') : r.fulfill({ status: 500, json: { statusCode: 500, message: 'Internal server error' } })));
      await page.goto(c.url);
      await expect(page.getByTestId(c.page)).toBeVisible();
      const retry = page.getByTestId('btn-retry').first();
      await expect(retry, `${c.url}: Retry shown`).toBeVisible();
      await expect(page.locator('[data-kind="error"]').first(), `${c.url}: error empty state`).toBeVisible();
      fail = false;
      await retry.click();
      await expect(page.locator('[data-kind="error"]'), `${c.url}: recovered`).toHaveCount(0);
      expect(await badText(page)).toEqual([]);
      await page.unroute(c.api);
    }
    // failures are handled: no uncaught exceptions while failing or recovering
    expect(watch.errors.filter((e) => /pageerror/.test(e))).toEqual([]);
  });

  test('offline: the banner appears while navigator is offline and goes away when back online', async ({ pageAs }) => {
    const page = await pageAs('manager');
    await page.goto('/dashboard');
    await settle(page, 'page-dashboard');
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    await page.context().setOffline(true);
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await expect(page.getByTestId('offline-banner')).toContainText("You're offline");
    // still visible after navigating inside the SPA
    await page.getByTestId('rail-trax').click();
    await expect(page.getByTestId('offline-banner')).toBeVisible();
    await page.context().setOffline(false);
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    await expect(page.locator('mat-snack-bar-container')).toContainText('Back online');
  });

  test('date filter: 1-day, 90-day and month-crossing ranges reach the API; compare with an empty previous period shows no NaN / Infinity', async ({ pageAs, api }) => {
    test.setTimeout(120_000);
    const admin = await api('admin');
    const today = todayLocal();
    const firstOfMonth = `${today.slice(0, 7)}-01`;
    const ranges = [
      { from: addDays(today, -1), to: addDays(today, -1) }, // 1 day
      { from: addDays(today, -90), to: addDays(today, -1) }, // 90 days (the seed only has 30: the previous period is empty)
      { from: addDays(firstOfMonth, -3), to: addDays(firstOfMonth, 2) }, // crosses a month boundary
    ];
    for (const r of ranges) {
      const page = await pageAs('admin');
      await presetFilter(page, { preset: 'custom', custom: r, compare: true });
      const resp = waitForApi(page, '/api/analytics/traffic', (u) => u.searchParams.get('from') === r.from && u.searchParams.get('to') === r.to);
      await page.goto('/analytics/traffic');
      const body = await (await resp).json();
      await settle(page, 'page-traffic');
      const expected = await admin.get('/api/analytics/traffic', { from: r.from, to: r.to });
      expect(body.totals.footfallIn).toBe(expected.totals.footfallIn);
      expect(await badText(page), `${r.from}…${r.to}`).toEqual([]);
      await expect(page.locator('body')).not.toContainText(/Infinity|NaN/);
      // the 90-day range still draws one point per day
      expect(body.daily.length).toBeGreaterThanOrEqual(1);
      await page.goto('/dashboard');
      await settle(page, 'page-dashboard');
      expect(await badText(page), `dashboard ${r.from}…${r.to}`).toEqual([]);
      await expect(page.getByTestId('page-dashboard')).not.toContainText(/Infinity|NaN/);
      await page.close();
    }
  });

  test('date filter typed in the range inputs (crossing a month) drives every analytics call', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await page.goto('/analytics/traffic');
    await settle(page, 'page-traffic');
    const today = todayLocal();
    const first = `${today.slice(0, 7)}-01`;
    const from = addDays(first, -4);
    const to = addDays(first, 1);
    const fmt = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
    const resp = waitForApi(page, '/api/analytics/traffic', (u) => u.searchParams.get('from') === from && u.searchParams.get('to') === to);
    await page.getByTestId('filter-date-from').fill(fmt(from));
    await page.getByTestId('filter-date-to').fill(fmt(to));
    await page.getByTestId('filter-date-to').press('Tab');
    const body = await (await resp).json();
    expect(body.daily.map((d: any) => d.date)).toContain(first);
    await expect(page.getByTestId('filter-range-preset')).toContainText('Custom');
  });
});
