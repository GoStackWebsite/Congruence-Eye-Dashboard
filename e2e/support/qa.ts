/**
 * Helpers for the edge-* QA sweeps: console / network watchdog, horizontal overflow, "bad text" scan
 * (NaN / Infinity / undefined / null in the rendered DOM), axe accessibility checks and theme switching.
 */
import AxeBuilder from '@axe-core/playwright';
import { Page, expect } from '@playwright/test';

export interface Watch {
  errors: string[];
  /** Clear what was collected so far (e.g. after an intentional failure). */
  reset(): void;
}

/** Collects console errors, page errors, failed requests and HTTP ≥ 400 responses (minus the `allow` patterns). */
export function watchPage(page: Page, allow: (RegExp | string)[] = []): Watch {
  const errors: string[] = [];
  const allowed = (s: string) => allow.some((a) => (typeof a === 'string' ? s.includes(a) : a.test(s)));
  const push = (s: string) => {
    if (!allowed(s)) errors.push(s);
  };
  page.on('console', (m) => {
    if (m.type() === 'error') push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => push(`pageerror: ${e.message}`));
  page.on('requestfailed', (r) => {
    const f = r.failure()?.errorText ?? '';
    // requests cancelled by navigation / switchMap (a newer filter value) are not failures
    if (/ERR_ABORTED|NS_BINDING_ABORTED|cancelled/i.test(f)) return;
    push(`requestfailed: ${r.method()} ${r.url()} ${f}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 400) push(`http ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return { errors, reset: () => (errors.length = 0) };
}

/** Width overflow of the page (document.scrollingElement.scrollWidth − clientWidth) and the widest offenders. */
export async function overflow(page: Page): Promise<{ px: number; culprits: string[] }> {
  return page.evaluate(() => {
    const se = document.scrollingElement as HTMLElement;
    const px = se.scrollWidth - se.clientWidth;
    const culprits: string[] = [];
    if (px > 1) {
      const vw = se.clientWidth;
      for (const el of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && getComputedStyle(el).position !== 'fixed') {
          // report the outermost offender only
          if (!culprits.some((c) => el.parentElement?.closest(c.split(' ')[0]))) {
            culprits.push(`${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.') : ''} right=${Math.round(r.right)}`);
          }
          if (culprits.length > 6) break;
        }
      }
    }
    return { px, culprits };
  });
}

export async function expectNoOverflow(page: Page, label: string) {
  const o = await overflow(page);
  expect(o.px, `${label}: horizontal overflow ${o.px}px — ${o.culprits.join(' | ')}`).toBeLessThanOrEqual(1);
}

/** Text that must never be rendered to users. */
/** …and raw ISO timestamps (server text must be shown in store time). */
export const BAD_TEXT = /\bNaN\b|\bInfinity\b|\bundefined\b|\bnull\b|\[object Object\]|Invalid Date|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

/** Visible text (innerText) of the page incl. overlays; returns the offending lines. */
export async function badText(page: Page): Promise<string[]> {
  const text = await page.evaluate(() => document.body.innerText);
  return text.split('\n').filter((l) => BAD_TEXT.test(l)).map((l) => l.trim().slice(0, 160));
}

export async function expectNoBadText(page: Page, label: string) {
  expect(await badText(page), `${label}: NaN/Infinity/undefined/null rendered`).toEqual([]);
}

/** Start the SPA in a theme (ThemeService reads the raw string `ce.theme` from localStorage on boot). */
export async function presetTheme(page: Page, theme: 'light' | 'dark') {
  await page.addInitScript((t) => localStorage.setItem('ce.theme', t), theme);
}

export interface AxeIssue {
  id: string;
  impact: string;
  help: string;
  nodes: string[];
}

/** Serious / critical axe violations (WCAG 2.1 A/AA) of the current page. */
export async function axeIssues(page: Page, exclude: string[] = []): Promise<AxeIssue[]> {
  let b = new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']);
  // canvases are charts with their own aria-label; the CDK live announcer is off-screen by design
  for (const e of ['.cdk-live-announcer-element', ...exclude]) b = b.exclude(e);
  const res = await b.analyze();
  return res.violations
    .filter((v) => v.impact === 'serious' || v.impact === 'critical')
    .map((v) => ({ id: v.id, impact: v.impact!, help: v.help, nodes: v.nodes.slice(0, 4).map((n) => `${n.target.join(' ')} — ${(n.failureSummary ?? '').split('\n').slice(1, 2).join(' ').slice(0, 140)}`) }));
}

/** Wait until the page settled: page root visible, no skeletons / progress bars, and (briefly) a quiet network. */
export async function settle(page: Page, pageTestId?: string) {
  if (pageTestId) await expect(page.getByTestId(pageTestId).first()).toBeVisible({ timeout: 20_000 });
  // pages that poll (live view, notifications) never reach "networkidle": cap the wait
  await page.waitForLoadState('networkidle', { timeout: 2_500 }).catch(() => undefined);
  await expect
    .poll(async () => page.locator('.ce-skeleton:visible, [data-testid="loading"]:visible, .skel-row:visible').count(), { timeout: 10_000, intervals: [100, 200, 300] })
    .toBe(0)
    .catch(() => undefined);
  // one frame for charts / ResizeObservers
  await page.waitForTimeout(150);
}
