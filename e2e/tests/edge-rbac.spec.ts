/**
 * Role-based visibility (docs/qa/UI_EDGE_CASE_PLAN.md · P1–P3): for every role, every route of the SPA opened by URL
 * either renders its page (allowed) or lands on the role's home page (forbidden) — never a blank page, an error or a
 * partially rendered forbidden page. The menu only lists allowed pages (each nav link resolves to an allowed route).
 */
import { test, expect } from '../support/fixtures';
import { RoleKey } from '../support/env';
import { settle } from '../support/qa';
import { ROUTES, allowed } from '../support/routes';

const HOME: Record<RoleKey, { url: RegExp; page: string }> = {
  admin: { url: /\/dashboard$/, page: 'page-dashboard' },
  regional: { url: /\/dashboard$/, page: 'page-dashboard' },
  manager: { url: /\/dashboard$/, page: 'page-dashboard' },
  auditor: { url: /\/dashboard$/, page: 'page-dashboard' },
  staff: { url: /\/tasks$/, page: 'page-tasks' },
};

test.describe('Edge RBAC: direct URL access per role', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const role of Object.keys(HOME) as RoleKey[]) {
    test(`${role}: allowed routes render, forbidden routes go home; every menu link is allowed`, async ({ pageAs }) => {
      test.setTimeout(240_000);
      const page = await pageAs(role);
      const problems: string[] = [];
      // concrete ids are only needed to prove the guard; seeded ids exist for every role's scope or are redirected
      const ids: Record<string, string> = { template: '1', assignment: '1', submission: '1', ticket: '1', rule: '1', alert: '1' };
      for (const def of ROUTES) {
        const url = def.path.replace(/\{(\w+)\}/g, (_m, k) => ids[k]);
        await page.goto(url);
        if (allowed(def, role)) {
          // allowed by the route guard (the record itself may still be out of the user's scope → in-page message)
          const ok = await page
            .getByTestId(def.page)
            .first()
            .waitFor({ timeout: 15_000 })
            .then(() => true)
            .catch(() => false);
          if (!ok) problems.push(`${url}: allowed but ${def.page} not shown (at ${page.url()})`);
        } else {
          await expect.poll(() => page.url(), { timeout: 10_000 }).toMatch(HOME[role].url);
          const home = await page.getByTestId(HOME[role].page).isVisible().catch(() => false);
          if (!home) problems.push(`${url}: forbidden but home page not shown`);
          if (await page.getByTestId(def.page).count()) problems.push(`${url}: forbidden page rendered`);
        }
      }
      // every menu entry points at a route the role may open
      await page.goto(role === 'staff' ? '/tasks' : '/dashboard');
      await settle(page);
      const nav = page.getByTestId('sidenav');
      for (const m of await nav.locator('[data-testid^="rail-"]:not([data-testid="rail-user"])').all()) {
        await m.click();
        for (const href of await nav.locator('.module-panel a[href]').evaluateAll((els) => els.map((e) => e.getAttribute('href')!))) {
          const def = ROUTES.find((r) => r.path === href);
          if (def && !allowed(def, role)) problems.push(`menu shows forbidden ${href}`);
        }
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }
});
