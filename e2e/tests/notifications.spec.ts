/**
 * Notification bell + Server-Sent Events: an AI Manager breach posted by the edge (X-Api-Key) raises an alert and a
 * notification that reaches the open browser of the store manager without a reload. STAFF of the same store get no
 * notification and no `alert` SSE events (fixed: they cannot open alerts / AI Manager).
 */
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { API_URL, EDGE_KEY_STORE_1, uid } from '../support/env';

/** Opens a second EventSource in the page (same token as the SPA) and records the event types it receives. */
async function recordSse(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as { __sse: string[] };
    w.__sse = [];
    const es = new EventSource(`/api/stream?token=${encodeURIComponent(localStorage.getItem('ce.token')!)}`);
    for (const t of ['alert', 'notification', 'live']) es.addEventListener(t, () => w.__sse.push(t));
    es.onopen = () => w.__sse.push('open');
  });
  await expect.poll(() => page.evaluate(() => (window as unknown as { __sse: string[] }).__sse.includes('open'))).toBe(true);
}
const sseEvents = (page: Page) => page.evaluate(() => (window as unknown as { __sse: string[] }).__sse);

async function bellCount(page: Page) {
  const c = page.getByTestId('notif-count');
  return (await c.count()) ? Number((await c.innerText()).replace('+', '')) : 0;
}

test.describe('Notifications', () => {
  test('edge AI breach → alert + notification pushed live to the manager\'s bell; STAFF get neither notification nor alert events', async ({ pageAs, api, request }) => {
    const admin = await api('admin');
    const mgrApi = await api('manager');
    const staffApi = await api('staff');
    const cams = await admin.get('/api/cameras', { storeId: 1 });
    const floor = cams.find((c: any) => c.type === 'ZONE');

    const mgr = await pageAs('manager');
    await mgr.goto('/dashboard');
    await expect(mgr.getByTestId('notif-bell')).toBeVisible();
    const staff = await pageAs('staff');
    await staff.goto('/tasks');
    await expect(staff.getByTestId('notif-bell')).toBeVisible();
    await recordSse(mgr);
    await recordSse(staff);
    const mgrUnread = (await mgrApi.get('/api/notifications')).filter((n: any) => !n.isRead).length;
    await expect.poll(() => bellCount(mgr)).toBe(Math.min(mgrUnread, 100));
    const staffBefore = await staffApi.get('/api/notifications');
    const staffBell = await bellCount(staff);

    // the edge box reports a phone-usage breach (implicit rule: no ruleId)
    const details = `E2E phone use ${uid()}`;
    const r = await request.post(`${API_URL}/api/ingest/detections`, {
      headers: { 'X-Api-Key': EDGE_KEY_STORE_1 },
      data: { detections: [{ type: 'MOBILE_USAGE', cameraId: floor.id, ts: new Date().toISOString(), status: 'BREACHED', details, confidence: 0.91 }] },
    });
    expect(r.status()).toBe(200);
    expect((await r.json()).accepted).toBe(1);

    const det = (await admin.get('/api/ai-manager/detections', { storeIds: '1', type: 'MOBILE_USAGE', pageSize: 50 })).items.find((d: any) => d.details === details);
    expect(det).toMatchObject({ status: 'BREACHED', storeId: 1, cameraId: floor.id });
    const alert = (await admin.get('/api/alerts', { storeIds: '1', pageSize: 100 })).items.find((a: any) => a.metric === 'AI_MANAGER_BREACH' && a.message.includes(details));
    expect(alert).toMatchObject({ status: 'OPEN', storeId: 1 });
    const note = (await mgrApi.get('/api/notifications')).find((n: any) => n.link === `/alerts/${alert.id}`);
    expect(note.title).toMatch(/^Mobile (phone )?usage breach detected for store CNG-TNR$/i); // "<rule name> breach detected for store <code>"

    // the manager's bell increases without a reload (SSE `notification` event)
    await expect.poll(() => bellCount(mgr), { timeout: 20_000 }).toBe(Math.min(mgrUnread + 1, 100));
    await expect.poll(() => sseEvents(mgr)).toEqual(expect.arrayContaining(['alert', 'notification']));
    await mgr.getByTestId('notif-bell').click();
    const item = mgr.getByTestId(`notif-item-${note.id}`);
    await expect(item).toContainText(note.title);
    await expect(item).toHaveAttribute('data-kind', 'alert');
    await item.click();
    await expect(mgr).toHaveURL(new RegExp(`/alerts/${alert.id}$`));
    await expect(mgr.getByTestId(`row-alert-${alert.id}`)).toHaveAttribute('data-highlight', 'true');
    await expect.poll(() => bellCount(mgr)).toBe(Math.min(mgrUnread, 100));

    // STAFF: nothing new, no alert events on their stream, bell unchanged
    expect((await staffApi.get('/api/notifications')).length).toBe(staffBefore.length);
    expect(await sseEvents(staff)).not.toContain('alert');
    expect(await bellCount(staff)).toBe(staffBell);
    // …and no AI Manager breach notification ever links STAFF to a page they cannot open
    const staffNotes = await staffApi.get('/api/notifications');
    expect(staffNotes.filter((n: any) => /^\/(alerts|ai-manager)/.test(n.link ?? ''))).toEqual([]);
    await staff.goto('/ai-manager/detections');
    await expect(staff).toHaveURL(/\/tasks$/);
  });

  test('mark all read clears the badge; an AI Manager deep link (/ai-manager/detections?id=) highlights the detection', async ({ pageAs, api }) => {
    const admin = await api('admin');
    // seeded breach notifications for admins link to /ai-manager/detections?id=
    const notes = await admin.get('/api/notifications');
    const ai = notes.find((n: any) => (n.link ?? '').startsWith('/ai-manager/detections?id='));
    expect(ai, 'seeded AI Manager breach notification').toBeTruthy();
    const page = await pageAs('admin');
    await page.goto('/dashboard');
    await page.getByTestId('notif-bell').click();
    const item = page.getByTestId(`notif-item-${ai.id}`);
    await expect(item).toHaveAttribute('data-kind', 'ai-breach');
    await item.click();
    await expect(page.getByTestId('page-ai-detections')).toBeVisible();
    const id = ai.link.split('=')[1];
    await expect(page).toHaveURL(new RegExp(`/ai-manager/detections\\?id=${id}$`));
    await page.getByTestId('notif-bell').click();
    await page.getByTestId('notif-read-all').click();
    await expect(page.getByTestId('notif-count')).toHaveCount(0);
    await expect.poll(async () => (await admin.get('/api/notifications')).filter((n: any) => !n.isRead).length).toBe(0);
  });
});
