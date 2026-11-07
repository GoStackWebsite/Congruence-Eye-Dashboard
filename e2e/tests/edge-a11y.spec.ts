/**
 * Accessibility (docs/qa/UI_EDGE_CASE_PLAN.md · A1–A4): axe-core (WCAG 2.1 A/AA) on every route, in the light and
 * the dark theme — no serious or critical violations. Admin covers every route; STAFF covers the phone-first pages
 * (incl. the checklist fill page) at 390×844; the login page is checked signed out.
 */
import { test, expect } from '../support/fixtures';
import { RoleKey } from '../support/env';
import { presetFilter } from '../support/ui';
import { AxeIssue, axeIssues, presetTheme, settle } from '../support/qa';
import { resolveRoutes } from '../support/routes';

const fmt = (url: string, issues: AxeIssue[]) => issues.map((i) => `${url} [${i.impact}] ${i.id}: ${i.help}\n      ${i.nodes.join('\n      ')}`);

test.describe('Edge a11y: axe on every route, light and dark', () => {
  test.describe.configure({ mode: 'parallel' });
  const cases: { role: RoleKey; theme: 'light' | 'dark'; phone?: boolean }[] = [
    { role: 'admin', theme: 'light' },
    { role: 'admin', theme: 'dark' },
    { role: 'staff', theme: 'light', phone: true },
    { role: 'staff', theme: 'dark', phone: true },
  ];
  for (const c of cases) {
    test(`${c.role} · ${c.theme}${c.phone ? ' · 390×844' : ''}: no serious / critical axe violations`, async ({ pageAs, api }) => {
      test.setTimeout(480_000);
      const page = await pageAs(c.role);
      if (c.phone) await page.setViewportSize({ width: 390, height: 844 });
      await presetTheme(page, c.theme);
      await presetFilter(page, { preset: 'last7' });
      const problems: string[] = [];
      for (const { def, url } of await resolveRoutes(await api(c.role), c.role)) {
        await page.goto(url);
        await settle(page, def.page);
        await expect(page.locator('html')).toHaveAttribute('data-theme', c.theme);
        problems.push(...fmt(url, await axeIssues(page)));
      }
      expect(problems, problems.join('\n')).toEqual([]);
    });
  }

  for (const theme of ['light', 'dark'] as const) {
    test(`login page · ${theme}: no serious / critical axe violations`, async ({ page }) => {
      await presetTheme(page, theme);
      await page.goto('/login');
      await expect(page.getByTestId('form-login')).toBeVisible();
      const issues = await axeIssues(page);
      expect(issues, fmt('/login', issues).join('\n')).toEqual([]);
    });
  }
});
