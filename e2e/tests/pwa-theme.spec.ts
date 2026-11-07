/**
 * P1 (mobile use for checklists): installable PWA — manifest, icons, service worker registration and the offline app
 * shell — plus dark mode across the shell and a chart page.
 */
import { test, expect } from '../support/fixtures';
import { WEB_URL, storageStatePath } from '../support/env';

test.describe('PWA', () => {
  test('manifest is linked and served with the right type, icons load, shortcuts point to My checklists / My tasks', async ({ page, request }) => {
    await page.goto('/login');
    const href = await page.locator('link[rel=manifest]').getAttribute('href');
    expect(href).toBe('manifest.webmanifest');
    await expect(page.locator('meta[name=theme-color]')).toHaveAttribute('content', /^#[0-9a-f]{6}$/i);
    const r = await request.get(`${WEB_URL}/${href}`);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-type']).toContain('application/manifest+json');
    const m = await r.json();
    expect(m).toMatchObject({ name: 'Congruence Eye', display: 'standalone', start_url: '/', scope: '/' });
    expect(m.shortcuts.map((s: any) => [s.name, s.url])).toEqual([['My checklists', '/checklists/assignments'], ['My tasks', '/tasks']]);
    const sizes = m.icons.map((i: any) => i.sizes);
    expect(sizes).toEqual(expect.arrayContaining(['192x192', '512x512']));
    for (const icon of m.icons) {
      const ir = await request.get(`${WEB_URL}/${icon.src}`);
      expect(ir.status(), icon.src).toBe(200);
      const png = await ir.body();
      expect(png.subarray(1, 4).toString()).toBe('PNG');
      const [w, h] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(`${w}x${h}`, icon.src).toBe(icon.sizes);
    }
  });

  test('the service worker registers and serves the app shell offline', async ({ browser }) => {
    const ctx = await browser.newContext({ storageState: storageStatePath('staff'), baseURL: WEB_URL, serviceWorkers: 'allow' });
    const page = await ctx.newPage();
    for (const f of ['ngsw-worker.js', 'ngsw.json']) expect((await page.request.get(`${WEB_URL}/${f}`)).status(), f).toBe(200);
    await page.goto('/tasks');
    await expect(page.getByTestId('page-tasks')).toBeVisible();
    // registered (registerWhenStable:30000) and activated
    await expect
      .poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.state ?? 'none'), { timeout: 45_000 })
      .toBe('activated');
    const scriptUrl = await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())!.active!.scriptURL);
    expect(scriptUrl).toBe(`${WEB_URL}/ngsw-worker.js`);
    // wait until the worker controls the page and has cached the shell, then go offline and reload
    await page.reload();
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { timeout: 30_000 }).toBe(true);
    await expect
      .poll(() => page.evaluate(async () => (await fetch('/ngsw/state')).text()), { timeout: 30_000 })
      .toMatch(/Driver state: NORMAL/);
    await expect.poll(() => page.evaluate(async () => (await caches.keys()).length), { timeout: 30_000 }).toBeGreaterThan(0);
    await ctx.setOffline(true);
    await page.reload();
    await expect(page.getByTestId('sidenav')).toBeVisible(); // app shell from the cache
    await ctx.setOffline(false);
    await ctx.close();
  });
});

test.describe('Theme', () => {
  test('dark mode applies to the shell, cards and charts, persists across reloads and pages', async ({ pageAs }) => {
    const page = await pageAs('manager');
    await page.goto('/analytics/traffic');
    await expect(page.getByTestId('kpi-footfall-in').getByTestId('kpi-value')).not.toHaveText(/^\s*(—|--)?\s*$/);
    const bg = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const lum = (rgb: string) => {
      const [r, g, b] = rgb.match(/\d+/g)!.map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    const light = lum(await bg());
    expect(light).toBeGreaterThan(180);
    await page.getByTestId('btn-theme-toggle').click();
    await expect.poll(async () => lum(await bg())).toBeLessThan(60);
    // KPI cards and the topbar follow the theme
    const cardBg = await page.getByTestId('kpi-footfall-in').evaluate((e) => getComputedStyle(e.closest('.kpi-card') ?? e).backgroundColor);
    expect(lum(cardBg)).toBeLessThan(80);
    await page.goto('/checklists/assignments');
    expect(lum(await bg())).toBeLessThan(60);
    await page.reload();
    expect(lum(await bg())).toBeLessThan(60);
    await page.getByTestId('btn-theme-toggle').click();
    await expect.poll(async () => lum(await bg())).toBeGreaterThan(180);
  });
});
