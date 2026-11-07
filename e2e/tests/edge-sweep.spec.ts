/**
 * QA sweep over EVERY route for EVERY role (docs/qa/UI_EDGE_CASE_PLAN.md · S1–S4):
 *  - the page renders, with zero console errors, zero page errors and zero failed / ≥ 400 requests;
 *  - no "NaN", "Infinity", "undefined", "null" or "[object Object]" in the rendered text;
 *  - no horizontal page overflow at 390×844 (phone) and 768×1024 (tablet portrait):
 *    document.scrollingElement.scrollWidth ≤ clientWidth + 1.
 */
import { test, expect } from '../support/fixtures';
import { RoleKey } from '../support/env';
import { presetFilter } from '../support/ui';
import { expectNoBadText, overflow, settle, watchPage } from '../support/qa';
import { resolveRoutes } from '../support/routes';

const ROLES: RoleKey[] = ['admin', 'regional', 'manager', 'auditor', 'staff'];
const SIZES = [
  { w: 768, h: 1024 },
  { w: 390, h: 844 },
];

test.describe('Edge sweep: every route × role — console, network, text, overflow', () => {
  test.describe.configure({ mode: 'parallel' });
  for (const role of ROLES) {
    test(`${role}: every allowed route renders cleanly and never overflows at 768 / 390 px`, async ({ pageAs, api }) => {
      test.setTimeout(420_000);
      const routes = await resolveRoutes(await api(role), role);
      expect(routes.length).toBeGreaterThan(role === 'staff' ? 5 : 20);
      const page = await pageAs(role);
      await presetFilter(page, { preset: 'last7' });
      // the not-found route is a deliberate miss, nothing else may fail
      const watch = watchPage(page);
      const problems: string[] = [];
      for (const { def, url } of routes) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto(url);
        await settle(page, def.page);
        await expectNoBadText(page, `${role} ${url}`);
        for (const s of SIZES) {
          await page.setViewportSize({ width: s.w, height: s.h });
          await page.waitForTimeout(250);
          const o = await overflow(page);
          if (o.px > 1) problems.push(`${url} @${s.w}: +${o.px}px ${o.culprits.join(' | ')}`);
        }
        if (watch.errors.length) problems.push(...watch.errors.map((e) => `${url}: ${e}`));
        watch.reset();
      }
      expect(problems, `${role}: ${problems.length} problems`).toEqual([]);
    });
  }
});
