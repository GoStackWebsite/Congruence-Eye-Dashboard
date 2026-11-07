/**
 * Visual QA capture (docs/qa/UI_EDGE_CASE_PLAN.md · V1): every route at 1440×900 light, 1440×900 dark and 390×844,
 * full page (JPEG), into docs/screenshots/qa/ for human review. Opt-in (slow, writes into the repo):
 *
 *   E2E_SHOTS=true npx playwright test tests/edge-visual.spec.ts
 */
import * as fs from 'fs';
import * as path from 'path';
import { test } from '../support/fixtures';
import { REPO, RoleKey } from '../support/env';
import { presetTheme, settle } from '../support/qa';
import { presetFilter } from '../support/ui';
import { resolveRoutes } from '../support/routes';

const OUT = path.join(REPO, 'docs', 'screenshots', 'qa');
const VARIANTS = [
  { id: 'light', w: 1440, h: 900, theme: 'light' as const },
  { id: 'dark', w: 1440, h: 900, theme: 'dark' as const },
  { id: 'phone', w: 390, h: 844, theme: 'light' as const },
];
const slug = (url: string) => url.replace(/^\//, '').replace(/[^a-z0-9]+/gi, '-').replace(/-+$/, '') || 'root';

test.describe('Visual QA screenshots', () => {
  test.skip(process.env.E2E_SHOTS !== 'true', 'opt-in: E2E_SHOTS=true');
  test.describe.configure({ mode: 'parallel' });
  for (const role of ['admin', 'staff'] as RoleKey[]) {
    for (const v of VARIANTS) {
      test(`${role} · ${v.id}`, async ({ pageAs, api }) => {
        test.setTimeout(600_000);
        fs.mkdirSync(OUT, { recursive: true });
        const page = await pageAs(role);
        await page.setViewportSize({ width: v.w, height: v.h });
        await presetTheme(page, v.theme);
        await presetFilter(page, { preset: 'last7' });
        for (const { def, url } of await resolveRoutes(await api(role), role)) {
          // admin covers every page; staff only adds what is different for the phone-first role
          if (role === 'staff' && !['/tasks', '/tickets', '/documents', '/checklists/assignments'].includes(url) && !url.startsWith('/checklists/fill/')) continue;
          await page.goto(url);
          await settle(page, def.page);
          await page.waitForTimeout(400); // chart animations
          await page.screenshot({ path: path.join(OUT, `${role}-${slug(url).replace(/-\d+(?=-|$)/g, '-id')}-${v.id}.jpg`), type: 'jpeg', quality: 72, fullPage: true, animations: 'disabled' });
        }
      });
    }
  }
});
