/**
 * EMPTY STORE (docs/qa/UI_EDGE_CASE_PLAN.md · E1–E4): a store created through the API with no cameras, zones, POS or
 * checklist data. With only that store selected in the global filter every analytics / ops page must show a proper
 * empty state — no NaN / Infinity / undefined / null text, no blank or broken charts, no console errors — and ratios
 * with a zero denominator render "--" (never 0 %, NaN or Infinity).
 */
import { Api, test, expect, tokenFor } from '../support/fixtures';
import { uid } from '../support/env';
import { presetFilter } from '../support/ui';
import { canvasInk } from '../support/ui';
import { badText, settle, watchPage } from '../support/qa';
import { ROUTES } from '../support/routes';

test.describe('Edge: empty store', () => {
  let storeId = 0;
  let storeName = '';

  test.beforeAll(async () => {
    const admin = await Api.create(tokenFor('admin'));
    const code = uid('EMP').slice(0, 20).toUpperCase();
    storeName = `Empty Store ${code}`;
    const s = await admin.post('/api/stores', { code, name: storeName, regionId: 1, city: 'Chennai', address: 'QA', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', areaSqft: 500 });
    storeId = s.id;
    await admin.dispose();
  });

  // leave the shared seed as other specs expect it (stores are only deactivated by DELETE)
  test.afterAll(async () => {
    const admin = await Api.create(tokenFor('admin'));
    await admin.ctx.delete(`/api/stores/${storeId}`).catch(() => undefined);
    await admin.dispose();
  });

  test('every data page shows an empty state for a store without data — no NaN/null text, no broken charts', async ({ pageAs }) => {
    test.setTimeout(300_000);
    const page = await pageAs('admin');
    await presetFilter(page, { storeIds: [storeId], preset: 'last7' });
    const watch = watchPage(page);
    const problems: string[] = [];
    for (const def of ROUTES.filter((r) => r.filter && r.data)) {
      await page.goto(def.path);
      await settle(page, def.page);
      const bad = await badText(page);
      if (bad.length) problems.push(`${def.path}: bad text ${JSON.stringify(bad)}`);
      const empties = await page.locator('[data-testid="empty-state"]:visible').count();
      if (!empties) problems.push(`${def.path}: no empty state shown`);
      // charts that are drawn must have ink (no blank canvases); empty ones show the card empty state instead
      for (const card of await page.locator('.ce-chart-card').all()) {
        if (!(await card.isVisible())) continue;
        const hasEmpty = await card.locator('[data-testid="empty-state"]').count();
        const canvas = card.locator('canvas');
        if (!hasEmpty && (await canvas.count())) {
          const ink = await canvasInk(canvas.first()).catch(() => 0);
          if (ink < 20) problems.push(`${def.path}: blank chart in "${(await card.locator('.ce-card-title, h3').first().innerText().catch(() => '?')).trim()}"`);
        }
      }
      problems.push(...watch.errors.map((e) => `${def.path}: ${e}`));
      watch.reset();
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('zero denominators render "--": conversion, ATV, items per bill, engaged / bounced / repeat %', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await presetFilter(page, { storeIds: [storeId], preset: 'last7' });
    await page.goto('/analytics/conversion');
    await settle(page, 'page-conversion');
    for (const id of ['conversion', 'atv', 'items-per-bill']) {
      await expect(page.getByTestId(`kpi-${id}`).getByTestId('kpi-value'), id).toHaveText(/^\s*--\s*$/);
    }
    await page.goto('/analytics/traffic');
    await settle(page, 'page-traffic');
    for (const id of ['engaged', 'bounced', 'repeat-visitors', 'avg-dwell']) {
      await expect(page.getByTestId(`kpi-${id}`).getByTestId('kpi-value'), id).toHaveText(/^\s*--\s*$/);
    }
    // the dashboard's tiles for this store: no percentages computed from nothing
    await page.goto('/dashboard');
    await settle(page, 'page-dashboard');
    const text = await page.getByTestId('page-dashboard').innerText();
    expect(text).not.toMatch(/NaN|Infinity|undefined/);
  });

  test('store detail of the empty store: cameras, zones, recorders and edge tabs show their empty states', async ({ pageAs }) => {
    const page = await pageAs('admin');
    const watch = watchPage(page);
    for (const tab of ['cameras', 'zones', 'recorders', 'edge', 'staff']) {
      await page.goto(`/admin/stores/${storeId}/${tab}`);
      await settle(page);
      await expect(page.getByRole('heading', { name: storeName }).or(page.getByText(storeName).first()).first()).toBeVisible();
      expect(await badText(page), tab).toEqual([]);
      if (tab !== 'edge') await expect(page.locator('[data-testid="empty-state"]:visible').first(), tab).toBeVisible();
    }
    expect(watch.errors).toEqual([]);
  });
});
