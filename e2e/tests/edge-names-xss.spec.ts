/**
 * Long names, Tamil unicode and XSS (docs/qa/UI_EDGE_CASE_PLAN.md · N1–N4, X1–X3).
 *  - A store, camera, zone, checklist and user created with 120-character names (with Tamil text) render clipped with
 *    an ellipsis and the full name available as a tooltip; the layout stays intact at 1440 and 390 px.
 *  - Names containing `<img src=x onerror=alert(1)>` render as literal text everywhere: no dialog fires and no <img
 *    with that source is created.
 */
import { Page } from '@playwright/test';
import { Api, test, expect, tokenFor } from '../support/fixtures';
import { PASSWORD, uid } from '../support/env';
import { expectNoOverflow, settle, watchPage } from '../support/qa';
import { presetFilter } from '../support/ui';

const TAMIL = 'கான்க்ரூயன்ஸ் டி நகர்';
const long = (prefix: string) => {
  const base = `${prefix} ${TAMIL} — Phoenix Marketcity Velachery Ground Floor Atrium Pop-up Counter `;
  return (base + 'x'.repeat(200)).slice(0, 120);
};
const XSS = '<img src=x onerror=alert(1)>';

/** The innermost visible element whose text contains `text` is clipped with an ellipsis or wraps inside the viewport, and the full text is reachable (title / tooltip / visible). */
async function expectContained(page: Page, text: string, label: string) {
  const info = await page.evaluate((t) => {
    const vw = document.documentElement.clientWidth;
    // elements that render (part of) the name in their own text nodes
    const own = (e: Element) => Array.from(e.childNodes).filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent ?? '').join('');
    const leaves = Array.from(document.querySelectorAll<HTMLElement>('body *')).filter((e) => {
      // SVG labels drawn over camera images are shortened by the app and clipped by the image frame
      if (e instanceof SVGElement) return false;
      if (!own(e).includes(t.slice(0, 30))) return false;
      const r = e.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && getComputedStyle(e).visibility !== 'hidden';
    });
    return leaves.map((e) => {
      // inline text has no box of its own: judge clipping on the nearest block-level ancestor
      let box: HTMLElement = e;
      while (box.parentElement && getComputedStyle(box).display === 'inline') box = box.parentElement;
      const r = box.getBoundingClientRect();
      const cs = getComputedStyle(box);
      const ecs = getComputedStyle(e);
      let titled = false;
      for (let n: HTMLElement | null = e, i = 0; n && i < 6; n = n.parentElement, i++) {
        if ((n.getAttribute('title') ?? '').includes(t.slice(0, 40)) || n.hasAttribute('aria-describedby') || n.classList.contains('mat-mdc-tooltip-trigger')) titled = true;
      }
      const clipped = box.scrollWidth > box.clientWidth + 1 && cs.overflowX !== 'visible';
      const ellipsis = [cs, ecs].some((c) => c.textOverflow === 'ellipsis' || (c.webkitLineClamp && c.webkitLineClamp !== 'none'));
      return { tag: `${box.tagName.toLowerCase()}.${String(box.className).split(' ').slice(0, 2).join('.')}`, right: Math.round(r.right), vw, clipped, ellipsis, titled, shortened: !(own(e) + (e.textContent ?? '')).includes(t) };
    });
  }, text);
  expect(info.length, `${label}: name rendered`).toBeGreaterThan(0);
  for (const i of info) {
    expect(i.right, `${label}: <${i.tag}> stays inside the viewport`).toBeLessThanOrEqual(i.vw + 1);
    // either fully shown (wrapping), or clipped with an ellipsis and a tooltip carrying the full name
    if (i.clipped) expect(i.ellipsis, `${label}: <${i.tag}> clipped without ellipsis`).toBe(true);
    if (i.clipped || i.shortened) expect(i.titled, `${label}: <${i.tag}> clipped without a tooltip`).toBe(true);
  }
}

/** Types into the page's list search (whatever its testid), if it has one. */
async function searchFor(page: Page, q: string) {
  const search = page.locator('main input[type="search"]:visible').first();
  if (await search.count()) {
    await search.fill(q);
    await page.waitForTimeout(400);
  }
}

test.describe('Edge: long names, Tamil unicode and XSS', () => {
  const cleanup: string[] = [];
  const made = { storeId: 0, storeName: '', zoneName: '', cameraName: '', templateId: 0, templateName: '', userName: '', xssStoreId: 0, xssTemplateId: 0, xssTicketId: 0 };

  test.beforeAll(async () => {
    const admin = await Api.create(tokenFor('admin'));
    const code = uid('LN').slice(-12).toUpperCase();
    made.storeName = long(`Store ${code}`);
    const store = await admin.post('/api/stores', { code, name: made.storeName, regionId: 1, city: 'Chennai', address: TAMIL, timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', areaSqft: 800 });
    made.storeId = store.id;
    cleanup.push(`/api/stores/${store.id}`);
    made.cameraName = long('Camera');
    const cam = await admin.post('/api/cameras', { storeId: store.id, name: made.cameraName, rtspUrl: 'rtsp://127.0.0.1:8554/long', type: 'ENTRANCE', isActive: true }).catch(async () => admin.post('/api/cameras', { storeId: store.id, name: made.cameraName }));
    made.zoneName = long('Zone');
    const zone = await admin.post('/api/zones', { storeId: store.id, cameraId: cam.id, name: made.zoneName, type: 'SECTION', polygon: [[0.1, 0.1], [0.6, 0.1], [0.6, 0.6], [0.1, 0.6]] });
    // cleanup order: zone and camera first (zone analytics of other specs must not see a zone without traffic)
    cleanup.push(`/api/zones/${zone.id}`, `/api/cameras/${cam.id}`);
    made.templateName = long('Checklist');
    const tpl = await admin.post('/api/checklists/templates', {
      name: made.templateName, description: TAMIL, category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [{ section: long('Section'), text: long('Question'), type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 }],
    });
    made.templateId = tpl.id;
    cleanup.push(`/api/checklists/templates/${tpl.id}`);
    made.userName = long('User');
    const lu = await admin.post('/api/users', { email: `${uid('long')}@congruence.in`, name: made.userName, role: 'STORE_MANAGER', password: PASSWORD, storeIds: [store.id] });
    cleanup.push(`/api/users/${lu.id}`);

    // XSS payloads in every free-text name
    const xcode = uid('XS').slice(-12).toUpperCase();
    const xs = await admin.post('/api/stores', { code: xcode, name: `XSS ${XSS} store`, regionId: 1, city: XSS, address: XSS, timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', areaSqft: 100 });
    made.xssStoreId = xs.id;
    cleanup.push(`/api/stores/${xs.id}`);
    const xt = await admin.post('/api/checklists/templates', {
      name: `XSS ${XSS} checklist`, description: XSS, category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [{ section: XSS, text: `Q ${XSS}`, type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 }],
    });
    made.xssTemplateId = xt.id;
    cleanup.push(`/api/checklists/templates/${xt.id}`);
    const xu = await admin.post('/api/users', { email: `${uid('xss')}@congruence.in`, name: `XSS ${XSS} user`, role: 'STORE_MANAGER', password: PASSWORD, storeIds: [xs.id] });
    cleanup.push(`/api/users/${xu.id}`);
    made.xssTicketId = (await admin.post('/api/tickets', { storeId: 1, title: `XSS ${XSS} ticket`, description: XSS, category: 'OTHER', priority: 'LOW' })).id;
    await admin.dispose();
  });

  // leave the shared seed as other specs expect it: deactivate / delete what this file created, close the ticket
  test.afterAll(async () => {
    const admin = await Api.create(tokenFor('admin'));
    for (const url of cleanup) await admin.ctx.delete(url).catch(() => undefined);
    if (made.xssTicketId) await admin.ctx.patch(`/api/tickets/${made.xssTicketId}`, { data: { status: 'CLOSED' } }).catch(() => undefined);
    await admin.dispose();
  });

  for (const vp of [{ w: 1440, h: 900 }, { w: 390, h: 844 }]) {
    test(`120-char Tamil names stay inside the layout with ellipsis + tooltip at ${vp.w}px`, async ({ pageAs }) => {
      test.setTimeout(180_000);
      const page = await pageAs('admin');
      await page.setViewportSize({ width: vp.w, height: vp.h });
      // a brand-new camera has no snapshot yet: GET /api/cameras/:id/snapshot answers 404 by contract (logged in FINDINGS)
      const watch = watchPage(page, [/\/api\/cameras\/\d+\/snapshot/, /status of 404/]);
      const checks: [string, string, string][] = [
        ['/admin/stores', 'page-admin-stores', made.storeName],
        [`/admin/stores/${made.storeId}`, 'page-admin-store', made.storeName],
        [`/admin/stores/${made.storeId}/cameras`, 'page-admin-cameras', made.cameraName],
        [`/admin/stores/${made.storeId}/zones`, 'page-admin-store', made.zoneName],
        ['/admin/users', 'page-admin-users', made.userName],
        ['/checklists', 'page-checklist-templates', made.templateName],
        [`/checklists/templates/${made.templateId}`, 'page-template-builder', made.templateName],
      ];
      for (const [url, id, name] of checks) {
        await page.goto(url);
        await settle(page, id);
        // lists: narrow to the row (tables are paginated / sorted)
        if (url === '/admin/stores' || url === '/admin/users' || url === '/checklists') await searchFor(page, name.slice(0, 18));
        await expect(page.getByText(name.slice(0, 30)).first(), `${url} shows the name`).toBeAttached();
        await expectContained(page, name, `${url} @${vp.w}`);
        await expectNoOverflow(page, `${url} @${vp.w}`);
      }
      // the global store filter lists the long store name without widening the page
      await presetFilter(page, { storeIds: [made.storeId], preset: 'last7' });
      await page.goto('/analytics/traffic');
      await settle(page, 'page-traffic');
      await expectNoOverflow(page, `traffic with the long store selected @${vp.w}`);
      expect(watch.errors).toEqual([]);
    });
  }

  test('XSS payloads in store / checklist / user / ticket names render as text, no script runs', async ({ pageAs }) => {
    test.setTimeout(180_000);
    const page = await pageAs('admin');
    const dialogs: string[] = [];
    page.on('dialog', async (d) => {
      dialogs.push(d.message());
      await d.dismiss();
    });
    const urls: [string, string][] = [
      ['/admin/stores', 'page-admin-stores'],
      [`/admin/stores/${made.xssStoreId}`, 'page-admin-store'],
      ['/admin/users', 'page-admin-users'],
      ['/checklists', 'page-checklist-templates'],
      [`/checklists/templates/${made.xssTemplateId}`, 'page-template-builder'],
      ['/tickets', 'page-tickets'],
    ];
    for (const [url, id] of urls) {
      await page.goto(url);
      await settle(page, id);
      await searchFor(page, 'XSS');
      await expect(page.getByText(XSS, { exact: false }).first(), `${url}: payload shown as literal text`).toBeVisible();
      expect(await page.locator('img[src="x"]').count(), `${url}: no injected <img>`).toBe(0);
    }
    // the store also appears in the global filter's store list
    await presetFilter(page, { storeIds: [made.xssStoreId], preset: 'last7' });
    await page.goto('/dashboard');
    await settle(page, 'page-dashboard');
    expect(await page.locator('img[src="x"]').count()).toBe(0);
    await page.waitForTimeout(500);
    expect(dialogs, 'no alert() fired').toEqual([]);
  });
});
