import { Locator, Page, expect } from '@playwright/test';

/** Opens a mat-select (the floating mat-label can sit on top of an empty select, so the click is forced). */
async function openSelect(sel: Locator) {
  await expect(sel).toBeVisible();
  await expect(async () => {
    // centre it first: sticky headers/footers may cover an element that was merely scrolled into view
    await sel.evaluate((e) => e.scrollIntoView({ block: 'center' }));
    await sel.click({ force: true });
    await expect(sel).toHaveAttribute('aria-expanded', 'true', { timeout: 2000 });
  }).toPass({ timeout: 10_000 });
}

/** Open a mat-select (by locator or testid) and pick an option by visible name (exact) or option testid. */
export async function matSelect(page: Page, select: Locator | string, option: string | RegExp | { testId: string }) {
  const sel = typeof select === 'string' ? page.getByTestId(select) : select;
  await openSelect(sel);
  const panel = page.locator('.cdk-overlay-pane .mat-mdc-select-panel').last();
  const opt =
    typeof option === 'object' && 'testId' in option
      ? panel.getByTestId(option.testId)
      : panel.getByRole('option', { name: option as string | RegExp, exact: typeof option === 'string' });
  await opt.first().click();
  // single selects close; multi selects stay open → close with Escape
  if (await panel.isVisible().catch(() => false)) {
    if ((await sel.getAttribute('aria-multiselectable')) === 'true') await page.keyboard.press('Escape');
  }
  await expect(panel).toBeHidden();
}

/** Multi mat-select: choose several options, then close. */
export async function matMultiSelect(page: Page, select: Locator | string, options: (string | RegExp)[]) {
  const sel = typeof select === 'string' ? page.getByTestId(select) : select;
  await openSelect(sel);
  const panel = page.locator('.cdk-overlay-pane .mat-mdc-select-panel').last();
  for (const o of options) {
    await panel.getByRole('option', { name: o, exact: typeof o === 'string' }).click();
  }
  await page.keyboard.press('Escape');
  await expect(panel).toBeHidden();
}

export type FieldValue = string | number | boolean | RegExp | { option: string | RegExp } | { options: (string | RegExp)[] };

/**
 * Fill a generic entity dialog. Strings/numbers go into inputs/textareas; for mat-select fields pass
 * `{ option: 'Label' }` (or `{ options: [...] }` for multi); booleans toggle mat-checkboxes.
 */
export async function fillDialog(page: Page, dialog: Locator, values: Record<string, FieldValue>) {
  for (const [key, value] of Object.entries(values)) {
    const el = dialog.getByTestId(`input-${key}`);
    await expect(el, `field input-${key}`).toBeVisible();
    if (typeof value === 'object' && value !== null && 'options' in value) {
      await matMultiSelect(page, el, value.options);
    } else if (typeof value === 'object' && value !== null && 'option' in value) {
      await matSelect(page, el, value.option);
    } else if (typeof value === 'boolean') {
      const box = el.locator('input[type=checkbox]');
      if ((await box.isChecked()) !== value) await box.click();
      await expect(box).toBeChecked({ checked: value });
    } else {
      await el.fill(String(value));
    }
  }
}

/** Click the confirm button of the confirmation dialog. */
export async function confirmDialog(page: Page) {
  const btn = page.locator('mat-dialog-container').getByTestId('btn-confirm');
  await btn.click();
  await expect(btn).toBeHidden();
}

/**
 * Checklist fill page (one question per screen): open question `qid` from the question outline (left panel on
 * desktop, "All questions" sheet below 1024 px).
 */
export async function fillGo(page: Page, qid: number) {
  const nav = page.getByTestId(`fill-nav-${qid}`);
  if (!(await nav.isVisible().catch(() => false))) await page.getByTestId('btn-fill-outline').click();
  await nav.click();
  await expect(page.getByTestId(`question-${qid}`)).toBeVisible();
}

/** Checklist fill page: open the review screen, submit and confirm. */
export async function submitFill(page: Page) {
  const nav = page.getByTestId('fill-nav-review');
  if (!(await nav.isVisible().catch(() => false))) await page.getByTestId('btn-fill-outline').click();
  await nav.click();
  await page.getByTestId('btn-submit-checklist').click();
  await confirmDialog(page);
}

export async function kpiText(scope: Page | Locator, id: string): Promise<string> {
  const v = scope.getByTestId(`kpi-${id}`).getByTestId('kpi-value');
  await expect(v).not.toHaveText(/^\s*(—|--)?\s*$/);
  return (await v.innerText()).trim();
}

/** Parse a UI-formatted number such as "12,345", "25.4%", "₹1.88 Cr", "₹2,366". */
export function parseUiNumber(text: string): number {
  const t = text.replace(/[₹,\s]/g, '');
  const m = t.match(/^(-?[\d.]+)(Cr|L|K|%)?$/);
  if (!m) throw new Error(`cannot parse "${text}"`);
  const n = Number(m[1]);
  return m[2] === 'Cr' ? n * 1e7 : m[2] === 'L' ? n * 1e5 : m[2] === 'K' ? n * 1e3 : n;
}

// --- formatting identical to frontend/src/app/core/utils/format.ts (for UI ↔ API equality checks)
const inrFull = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });
const numFmt = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });
export const fmt = {
  number: (v: number) => numFmt.format(v),
  pct: (v: number, d = 1) => `${v.toFixed(d)}%`,
  inr: (v: number) => inrFull.format(v),
  inrCompact: (v: number) => {
    const abs = Math.abs(v);
    const trim = (n: number, d: number) => Number(n.toFixed(d)).toString();
    if (abs >= 1e7) return `₹${trim(abs / 1e7, 2)} Cr`;
    if (abs >= 1e5) return `₹${trim(abs / 1e5, 2)} L`;
    if (abs >= 1e3) return `₹${trim(abs / 1e3, 1)} K`;
    return inrFull.format(v);
  },
  duration: (sec: number) => {
    const s = Math.max(0, Math.round(sec));
    if (s < 60) return `${s}s`;
    if (s < 3600) {
      const m = Math.floor(s / 60);
      const r = s % 60;
      return r ? `${m}m ${r}s` : `${m}m`;
    }
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h}h ${m.toString().padStart(2, '0')}m`;
  },
};

/** Set the persisted global filter before the SPA boots (ce.filter in localStorage). */
export async function presetFilter(page: Page, state: { storeIds?: number[]; preset?: string; compare?: boolean; custom?: { from: string; to: string } | null }) {
  const value = JSON.stringify({ storeIds: [], preset: 'last7', custom: null, compare: false, ...state });
  await page.addInitScript((v) => {
    if (!sessionStorage.getItem('e2e.filter.set')) {
      localStorage.setItem('ce.filter', v);
      sessionStorage.setItem('e2e.filter.set', '1');
    }
  }, value);
}

/**
 * Wait for a GET response of exactly this API path triggered by an action (exact match: a prefix let
 * '/api/analytics/traffic' be satisfied by '/api/analytics/traffic-density', whichever answered first).
 */
export function waitForApi(page: Page, pathPart: string, predicate?: (url: URL) => boolean) {
  return page.waitForResponse((r) => {
    const u = new URL(r.url());
    return u.pathname === pathPart && r.request().method() === 'GET' && r.status() < 400 && (!predicate || predicate(u));
  });
}

export async function expectToast(page: Page, text: string | RegExp) {
  await expect(page.locator('mat-snack-bar-container').filter({ hasText: text }).first()).toBeVisible();
}

/** Number of non-transparent pixels in the first canvas inside `scope` (or the canvas itself). */
export async function canvasInk(scope: Locator): Promise<number> {
  const canvas = (await scope.evaluate((el) => el.tagName)) === 'CANVAS' ? scope : scope.locator('canvas').first();
  await expect(canvas).toBeVisible();
  return canvas.evaluate((c: HTMLCanvasElement) => {
    const ctx = c.getContext('2d');
    if (!ctx) return 0;
    const { data } = ctx.getImageData(0, 0, c.width, c.height);
    let n = 0;
    for (let i = 3; i < data.length; i += 16) if (data[i] > 0) n++;
    return n;
  });
}

/** data-testid values of rows (prefix) in DOM order. */
export async function rowIds(table: Locator, prefix: string): Promise<number[]> {
  return table.locator(`[data-testid^="${prefix}"]`).evaluateAll(
    (els, p) => els.map((e) => Number(e.getAttribute('data-testid')!.slice((p as string).length))),
    prefix,
  );
}

/** Drag with real mouse moves (Angular CDK drag needs pointer movement beyond its threshold). */
export async function cdkDragTo(page: Page, source: Locator, target: Locator) {
  await source.scrollIntoViewIfNeeded();
  const s = await source.boundingBox();
  const t = await target.boundingBox();
  if (!s || !t) throw new Error('drag source/target not visible');
  const sx = s.x + s.width / 2;
  const sy = s.y + Math.min(20, s.height / 2);
  const tx = t.x + t.width / 2;
  const ty = t.y + Math.min(40, t.height / 2);
  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(sx + 8, sy + 8, { steps: 4 });
  await page.mouse.move(tx, ty, { steps: 20 });
  await page.mouse.move(tx + 2, ty + 2, { steps: 2 });
  await page.mouse.up();
}

/** Historical, immutable 7-day window ending yesterday (no test writes into the past) → exact UI ↔ API comparisons. */
export function histRange(days = 7): { from: string; to: string } {
  const tz = 'Asia/Kolkata';
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const shift = (n: number) => {
    const d = new Date(`${today}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + n);
    return d.toISOString().slice(0, 10);
  };
  return { from: shift(-days), to: shift(-1) };
}

/** Open a page with the global filter preset to a custom range and return the JSON of the first matching API call. */
export async function openWithRange<T = any>(page: Page, url: string, apiPath: string, range = histRange(), storeIds: number[] = []): Promise<T> {
  await presetFilter(page, { preset: 'custom', custom: range, storeIds });
  const resp = waitForApi(page, apiPath, (u) => u.searchParams.get('from') === range.from && u.searchParams.get('to') === range.to);
  await page.goto(url);
  return (await resp).json();
}

/**
 * Hover across one horizontal line of an ECharts chart (yFrac of its height) and return the first tooltip text that
 * appears. Used to read values from canvas charts through the real UI.
 */
export async function chartTooltipOnRow(page: Page, chart: Locator, yFrac: number, xFrom = 0.03, xTo = 0.97, step = 0.02): Promise<string | null> {
  await chart.scrollIntoViewIfNeeded();
  await expect.poll(() => canvasInk(chart)).toBeGreaterThan(50);
  const box = (await chart.boundingBox())!;
  const tip = chart.locator('div[style*="z-index: 9999999"]');
  // start from a hidden tooltip so a lingering one from a previous row is never read
  await page.mouse.move(box.x - 20, box.y - 20);
  await expect.poll(async () => (await tip.count()) === 0 || !(await tip.first().isVisible())).toBe(true);
  for (let x = xFrom; x <= xTo; x += step) {
    await page.mouse.move(box.x + box.width * x, box.y + box.height * yFrac);
    await page.waitForTimeout(30);
    if ((await tip.count()) && (await tip.first().isVisible())) {
      const t = (await tip.first().innerText()).replace(/\s+/g, ' ').trim();
      if (t) {
        await page.mouse.move(box.x - 20, box.y - 20);
        return t;
      }
    }
  }
  return null;
}
