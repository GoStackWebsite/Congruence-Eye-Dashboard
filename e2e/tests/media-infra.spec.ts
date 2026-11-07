/**
 * Tango Traffic v2: Image Directory (T5), Recap video (T4) and Infra Health with ticketing (T6).
 * Global setup ran the simulator for store 1 (today + a full day yesterday) and generated yesterday's recap.
 */
import * as fs from 'fs';
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { SETUP_STATE, addDays, todayLocal, uid } from '../support/env';
import { expectToast, fillDialog, matSelect, presetFilter, waitForApi } from '../support/ui';
import { probeMp4, serveMp4AsWebm } from '../support/video';

const setupState = () => JSON.parse(fs.readFileSync(SETUP_STATE, 'utf8'));

async function imageLoaded(page: Page, testId: string) {
  const img = page.getByTestId(testId).locator('img').first();
  await img.scrollIntoViewIfNeeded();
  await expect.poll(() => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0)), { message: `${testId} image` }).toBeGreaterThan(0);
}

/** Same as the SPA's localizeTimestamps (core/utils/dates.ts): raw ISO → "05 Oct, 3:41 am" in IST. */
function localTimes(text: string): string {
  return text.replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?/g, (iso) =>
    new Date(iso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: '2-digit', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }),
  );
}

test.describe('Image directory', () => {
  test('simulator snapshots are listed, images load, kind/camera filters and paging hit the API, lightbox navigates', async ({ pageAs, api }) => {
    const admin = await api();
    const today = todayLocal();
    const page = await pageAs('admin');
    await presetFilter(page, { storeIds: [1], preset: 'today' });
    const first = waitForApi(page, '/api/image-directory', (u) => u.searchParams.get('storeIds') === '1' && u.searchParams.get('from') === today);
    await page.goto('/traffic/image-directory');
    const ui = await (await first).json();
    const apiPage = await admin.get('/api/image-directory', { storeIds: '1', from: today, to: today, page: 1, pageSize: 24 });
    expect(ui.total).toBe(apiPage.total);
    expect(apiPage.total, 'today\'s simulator snapshots').toBeGreaterThan(24);
    await expect(page.getByTestId('image-total')).toHaveText(`${apiPage.total} images`);
    // newest first, every item rendered with a loading image
    const ids = await page.getByTestId('image-gallery').locator('[data-testid^="image-item-"]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-testid')!.slice(11))));
    expect(ids).toEqual(apiPage.items.map((i: any) => i.id));
    const ts = apiPage.items.map((i: any) => new Date(i.ts).getTime());
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    for (const it of apiPage.items.slice(0, 4)) await imageLoaded(page, `image-item-${it.id}`);
    expect((await page.request.get(apiPage.items[0].url)).headers()['content-type']).toMatch(/image\/jpeg/);

    // kind filter (store-ops OPENING snaps from the simulator's / seed's opening)
    const kindResp = waitForApi(page, '/api/image-directory', (u) => u.searchParams.get('kind') === 'PERIODIC');
    await matSelect(page, 'filter-image-kind', 'Periodic');
    const periodic = await (await kindResp).json();
    expect(periodic.items.length).toBeGreaterThan(0);
    expect(periodic.items.every((i: any) => i.kind === 'PERIODIC')).toBe(true);
    await expect(page.getByTestId('image-total')).toHaveText(`${periodic.total} images`);

    // camera filter (enabled because exactly one store is selected)
    const cams = await admin.get('/api/cameras', { storeId: 1 });
    const entrance = cams.find((c: any) => c.type === 'ENTRANCE');
    const camResp = waitForApi(page, '/api/image-directory', (u) => u.searchParams.get('cameraId') === String(entrance.id));
    await matSelect(page, 'filter-image-camera', entrance.name);
    const camPage = await (await camResp).json();
    expect(camPage.items.length).toBeGreaterThan(0);
    expect(camPage.items.every((i: any) => i.cameraId === entrance.id && i.kind === 'PERIODIC')).toBe(true);
    for (const it of camPage.items.slice(0, 2)) await imageLoaded(page, `image-item-${it.id}`);

    // paging
    if (camPage.total > 24) {
      const p2 = waitForApi(page, '/api/image-directory', (u) => u.searchParams.get('page') === '2');
      await page.getByTestId('paginator-images').getByRole('button', { name: 'Next page' }).click();
      const second = await (await p2).json();
      expect(second.items[0].id).not.toBe(camPage.items[0].id);
      await page.getByTestId('paginator-images').getByRole('button', { name: 'Previous page' }).click();
    }

    // lightbox: open the 2nd image, next/prev buttons and arrow keys, download link, close
    const items = (await admin.get('/api/image-directory', { storeIds: '1', from: today, to: today, cameraId: entrance.id, kind: 'PERIODIC', page: 1, pageSize: 24 })).items;
    await page.getByTestId(`image-item-${items[1].id}`).click();
    const box = page.getByTestId('dialog-lightbox');
    const img = box.getByTestId('lightbox-image');
    await expect(img).toHaveAttribute('src', items[1].url);
    await expect.poll(() => img.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(0);
    await expect(box).toContainText(`2 / ${items.length}`);
    await box.getByTestId('btn-lightbox-next').click();
    await expect(img).toHaveAttribute('src', items[2].url);
    await page.keyboard.press('ArrowLeft');
    await page.keyboard.press('ArrowLeft');
    await expect(img).toHaveAttribute('src', items[0].url);
    await expect(box.getByTestId('btn-lightbox-prev')).toBeDisabled();
    await expect(box.getByTestId('btn-lightbox-download')).toHaveAttribute('href', items[0].url);
    await box.getByTestId('btn-lightbox-close').click();
    await expect(box).toBeHidden();
  });

  test('STAFF cannot open the image directory; the store manager only gets T Nagar images', async ({ pageAs, api }) => {
    const staff = await pageAs('staff');
    await staff.goto('/traffic/image-directory');
    await expect(staff).toHaveURL(/\/tasks$/);
    const mgr = await api('manager');
    const page = await mgr.get('/api/image-directory', { storeIds: '1,2,3', pageSize: 100 });
    expect(page.items.length).toBeGreaterThan(0);
    expect(page.items.every((i: any) => i.storeId === 1)).toBe(true);
  });
});

test.describe('Recap video', () => {
  test.setTimeout(240_000);
  test('the READY recap plays (duration > 0), generating a recap from the UI works and an empty day shows the 422 message', async ({ pageAs, api }) => {
    const { recap, yesterday } = setupState();
    const admin = await api();
    const page = await pageAs('manager');
    await serveMp4AsWebm(page);
    await presetFilter(page, { storeIds: [1], preset: 'last7' });
    await page.goto('/traffic/recap');
    const item = page.getByTestId(`recap-${recap.id}`);
    await expect(item).toBeVisible();
    await expect(item.getByTestId('chip-recap-status')).toHaveAttribute('data-value', 'READY');
    await item.click();
    const video = page.getByTestId('recap-video');
    const api1 = await admin.get(`/api/recaps/${recap.id}`);
    expect(api1).toMatchObject({ storeId: 1, date: yesterday, status: 'READY' });
    expect(api1.durationSec).toBeGreaterThan(0);
    expect(api1.durationSec).toBeLessThan(120);
    await expect(video).toHaveAttribute('src', api1.url);
    // the file itself: H.264 yuv420p, 1280 wide, +faststart, duration as reported, < 2 min
    const mp4 = await page.request.get(api1.url);
    expect(mp4.status()).toBe(200);
    expect(mp4.headers()['content-type']).toMatch(/video\/mp4/);
    const facts = probeMp4(await mp4.body());
    expect(facts).toMatchObject({ codec: 'h264', pixFmt: 'yuv420p', width: 1280, faststart: true });
    expect(Math.abs(facts.durationSec - api1.durationSec)).toBeLessThan(0.6);
    // the <video> element loads it with a positive duration matching the API, and it plays
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.readyState), { timeout: 180_000 }).toBeGreaterThanOrEqual(1);
    const duration = await video.evaluate((v: HTMLVideoElement) => v.duration);
    expect(duration).toBeGreaterThan(0);
    expect(Math.abs(duration - api1.durationSec)).toBeLessThan(1.5);
        await video.evaluate((v: HTMLVideoElement) => { v.muted = true; return v.play(); });
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => v.currentTime)).toBeGreaterThan(0.2);
    await video.evaluate((v: HTMLVideoElement) => v.pause());

    // generate today's recap for T Nagar (simulator snapshots exist today)
    const gen = page.getByTestId('recap-generate');
    await expect(gen.getByTestId('select-recap-store')).toContainText('T Nagar');
    await gen.getByTestId('input-recap-date').fill(todayLocal());
    // synchronous ffmpeg build of up to ~480 frames: allow for a slow CI box
    const post = page.waitForResponse((r) => r.url().endsWith('/api/recaps/generate') && r.request().method() === 'POST', { timeout: 150_000 });
    await gen.getByTestId('btn-generate-recap').click();
    const created = await (await post).json();
    expect(created).toMatchObject({ storeId: 1, date: todayLocal(), status: 'READY' });
    expect(created.frameCount).toBeGreaterThan(0);
    await expect(page.getByTestId(`recap-${created.id}`)).toBeVisible();
    await expect(video).toHaveAttribute('src', created.url);
    await expect.poll(() => video.evaluate((v: HTMLVideoElement) => (v.readyState >= 1 ? v.duration : 0)), { timeout: 180_000 }).toBeGreaterThan(0);
    expect((await admin.get('/api/recaps', { storeIds: '1' })).some((r: any) => r.id === created.id)).toBe(true);

    // a day without snapshots → 422 shown inline
    const admPage = await pageAs('admin');
    await admPage.goto('/traffic/recap');
    const g2 = admPage.getByTestId('recap-generate');
    await matSelect(admPage, g2.getByTestId('select-recap-store'), { testId: 'select-recap-store-option-6' });
    const empty = addDays(todayLocal(), -200);
    await g2.getByTestId('input-recap-date').fill(empty);
    await g2.getByTestId('btn-generate-recap').click();
    await expect(admPage.getByTestId('recap-error')).toContainText(`No snapshots for store 6 on ${empty}`);
  });

  test('auditor can view and play recaps but cannot generate (no panel, API 403)', async ({ pageAs, api }) => {
    test.setTimeout(240_000);
    const { recap } = setupState();
    const page = await pageAs('auditor');
    await serveMp4AsWebm(page);
    await page.goto('/traffic/recap');
    await expect(page.getByTestId('recap-list')).toBeVisible();
    await expect(page.getByTestId('recap-generate')).toHaveCount(0);
    await page.getByTestId(`recap-${recap.id}`).click();
    await expect.poll(() => page.getByTestId('recap-video').evaluate((v: HTMLVideoElement) => (v.readyState >= 1 ? v.duration : 0)), { timeout: 180_000 }).toBeGreaterThan(0);
    const r = await (await api('auditor')).ctx.post('/api/recaps/generate', { data: { storeId: 1, date: todayLocal() } });
    expect(r.status()).toBe(403);
  });
});

test.describe('Infra health', () => {
  test('Adyar is DOWN (edge offline) with its NETWORK ticket; tiles equal the API; a pre-filled infra ticket is created from the row', async ({ pageAs, api }) => {
    const admin = await api();
    const page = await pageAs('admin');
    const resp = waitForApi(page, '/api/infra/health');
    await page.goto('/infra-health');
    const ui = await (await resp).json();
    const h = await admin.get('/api/infra/health');
    // (other tests may create stores in parallel: compare with the page's own response, and count active stores)
    expect(ui.totals.stores).toBe(ui.stores.length);
    expect(ui.totals.stores).toBeGreaterThanOrEqual(6);
    expect(ui.totals.healthy + ui.totals.degraded + ui.totals.down).toBe(ui.totals.stores);
    for (const s of [1, 2, 3, 4, 5, 6]) expect(ui.stores.some((x: any) => x.storeId === s)).toBe(true);
    for (const [id, v] of [['infra-stores', ui.totals.stores], ['infra-healthy', ui.totals.healthy], ['infra-degraded', ui.totals.degraded], ['infra-down', ui.totals.down]] as const) {
      await expect(page.getByTestId(`kpi-${id}`).getByTestId('kpi-value')).toHaveText(String(v));
    }
    await expect(page.getByTestId('kpi-infra-cameras').getByTestId('kpi-value')).toHaveText(`${ui.totals.camerasOnline} / ${ui.totals.camerasTotal}`);

    const adyar = h.stores.find((s: any) => s.storeName.includes('Adyar'));
    expect(adyar).toMatchObject({ edgeStatus: 'OFFLINE', health: 'DOWN' });
    expect(adyar.openTickets).toBeGreaterThan(0);
    const row = page.getByTestId(`row-infra-${adyar.storeId}`);
    await expect(row).toHaveAttribute('data-health', 'DOWN');
    await expect(row.getByTestId('chip-edge')).toHaveAttribute('data-value', 'OFFLINE');
    // server text is shown with its timestamps in store time ("offline since 05 Oct, 10:11 pm")
    for (const issue of adyar.issues) await expect(row.getByTestId('infra-issues')).toContainText(localTimes(issue));
    // the seeded NETWORK ticket is listed with a working link
    const tickets = await admin.get('/api/tickets', { storeIds: String(adyar.storeId), category: 'NETWORK' });
    const net = tickets.find((t: any) => ['OPEN', 'IN_PROGRESS', 'REOPENED'].includes(t.status));
    expect(net).toBeTruthy();
    await page.getByTestId(`row-infra-ticket-${net.id}`).getByTestId('link-ticket').click();
    await expect(page.getByTestId('page-ticket-detail')).toContainText(net.title);
    await page.goBack();

    // health filter
    await page.getByTestId('filter-health').getByRole('radio', { name: 'Down' }).click();
    await expect(page.getByTestId('table-infra-health').locator('[data-testid^="row-infra-"]')).toHaveCount(ui.totals.down);
    await expect(page.getByTestId(`row-infra-${adyar.storeId}`)).toBeVisible();

    // create a ticket from the Adyar row: pre-filled store / category / priority
    const title = `Edge device offline ${uid()}`;
    await page.getByTestId(`row-infra-${adyar.storeId}`).getByTestId('btn-create-ticket').click();
    const dlg = page.getByTestId('dialog-ticket');
    await expect(dlg.getByTestId('input-title')).toHaveValue('Edge device offline');
    await expect(dlg.getByTestId('input-category')).toContainText('Network');
    await expect(dlg.getByTestId('input-priority')).toContainText('Urgent');
    await fillDialog(page, dlg, { title });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, /Ticket TKT-\d+ created/);
    const t = (await admin.get('/api/tickets', { storeIds: String(adyar.storeId) })).find((x: any) => x.title === title);
    expect(t).toMatchObject({ storeId: adyar.storeId, category: 'NETWORK', priority: 'URGENT', status: 'OPEN' });
    // (alert tests running in parallel may open Adyar infra tickets too → at least one more)
    const after = await admin.get('/api/infra/health');
    expect(after.stores.find((s: any) => s.storeId === adyar.storeId).openTickets).toBeGreaterThanOrEqual(adyar.openTickets + 1);
    await expect(page.getByTestId(`row-infra-ticket-${t.id}`)).toBeVisible();
    await expect.poll(async () => Number(await page.getByTestId('kpi-infra-open-tickets').getByTestId('kpi-value').innerText())).toBeGreaterThanOrEqual(h.totals.openInfraTickets + 1);
  });
});
