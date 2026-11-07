import { Locator, Page } from '@playwright/test';
import { test, expect, Api } from '../support/fixtures';
import { API_URL, PASSWORD, uid } from '../support/env';
import { confirmDialog, expectToast, fillDialog, matSelect } from '../support/ui';

/** Click inside the zone SVG at normalised (x, y); re-reads the box each time (the page may scroll). */
async function clickZone(page: Page, canvas: Locator, x: number, y: number) {
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
}

async function createStoreViaUi(page: Page, code: string, name: string) {
  await page.goto('/admin/stores');
  await page.getByTestId('btn-create-store').click();
  const dlg = page.getByTestId('dialog-store');
  await fillDialog(page, dlg, {
    code,
    name,
    regionId: { option: 'Chennai' },
    city: 'Chennai',
    address: '12 Usman Road, T Nagar',
    openTime: '09:30',
    closeTime: '21:45',
    areaSqft: 4200,
    latitude: 13.04,
    longitude: 80.23,
  });
  await dlg.getByTestId('btn-save').click();
  await expectToast(page, 'Created');
}

async function edgeConfig(key: string, request: import('@playwright/test').APIRequestContext) {
  return request.get(`${API_URL}/api/ingest/config`, { headers: { 'X-Api-Key': key } });
}

test.describe('Admin', () => {
  test('store CRUD', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    const code = `E2E-${uid('s').slice(-6).toUpperCase()}`;
    const name = `Congruence E2E ${code}`;
    await createStoreViaUi(page, code, name);
    const store = (await admin.get('/api/stores')).find((s: any) => s.code === code);
    expect(store).toMatchObject({ name, regionName: 'Chennai', city: 'Chennai', timezone: 'Asia/Kolkata', openTime: '09:30', closeTime: '21:45', areaSqft: 4200, isActive: true, latitude: 13.04, longitude: 80.23 });

    await page.getByTestId('input-search').fill(code);
    const row = page.getByTestId(`row-store-${store.id}`);
    await expect(row).toContainText('09:30 – 21:45');
    await row.getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-store'), { name: `${name} (renamed)`, areaSqft: 5000, closeTime: '22:00' });
    await page.getByTestId('dialog-store').getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    await expect(row).toContainText(`${name} (renamed)`);
    expect(await admin.get(`/api/stores/${store.id}`)).toMatchObject({ name: `${name} (renamed)`, areaSqft: 5000, closeTime: '22:00' });

    // duplicate code is rejected by the API
    const dup = await admin.ctx.post('/api/stores', { data: { code, name: 'dup', regionId: store.regionId, city: 'Chennai', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', areaSqft: 1 } });
    expect([400, 409]).toContain(dup.status());

    // delete = deactivate (history is kept)
    await row.getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(row.locator('[data-value="NO"]')).toBeVisible();
    expect((await admin.get(`/api/stores/${store.id}`)).isActive).toBe(false);
  });

  test('camera CRUD and zone editor (SECTION polygon + ENTRY_LINE), edge device key works for /api/ingest/config', async ({ pageAs, api, request }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    const code = `E2E-${uid('c').slice(-6).toUpperCase()}`;
    const store = await admin.post('/api/stores', { code, name: `Zone Lab ${code}`, regionId: 1, city: 'Chennai', address: 'Lab', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', areaSqft: 1000 });

    // ---- cameras
    await page.goto('/admin/stores');
    await page.getByTestId('input-search').fill(code);
    await page.getByTestId(`row-store-${store.id}`).getByTestId('btn-cameras').click();
    await expect(page).toHaveURL(new RegExp(`/admin/stores/${store.id}/cameras$`));
    await expect(page.getByTestId('page-admin-cameras')).toContainText(`Zone Lab ${code}`);
    await page.getByTestId('btn-create-camera').click();
    await fillDialog(page, page.getByTestId('dialog-camera'), { name: 'Lab Entrance', type: { option: 'Entrance' }, rtspUrl: 'rtsp://user:pass@10.0.0.10:554/Streaming/Channels/102' });
    await page.getByTestId('dialog-camera').getByTestId('btn-save').click();
    await expect(page.getByTestId('table-admin-cameras').locator('[data-testid^="row-camera-"]')).toHaveCount(1);
    const cam = (await admin.get('/api/cameras', { storeId: store.id }))[0];
    expect(cam).toMatchObject({ storeId: store.id, name: 'Lab Entrance', type: 'ENTRANCE', isActive: true, status: 'UNKNOWN' });
    const camRow = page.getByTestId(`row-camera-${cam.id}`);
    await expect(camRow).toContainText('Lab Entrance');
    await camRow.getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-camera'), { name: 'Lab Entrance A' });
    await page.getByTestId('dialog-camera').getByTestId('btn-save').click();
    await expect(camRow).toContainText('Lab Entrance A');

    // ---- zone editor: SECTION polygon
    const editor = page.getByTestId('zone-editor');
    await expect(editor).toBeVisible();
    await expect(editor.getByTestId('snapshot-missing')).toBeVisible();
    const canvas = editor.getByTestId('zone-canvas');
    await editor.getByTestId('btn-new-zone').click();
    const form = editor.getByTestId('zone-form');
    await form.getByTestId('input-zone-name').fill('Sarees');
    await expect(form.getByTestId('input-zone-type')).toContainText('Section');
    const pts: [number, number][] = [[0.2, 0.3], [0.6, 0.3], [0.6, 0.8], [0.2, 0.8]];
    await clickZone(page, canvas, ...pts[0]);
    await clickZone(page, canvas, ...pts[1]);
    // too few points → validation error
    await form.getByTestId('btn-save-zone').click();
    await expect(form.getByTestId('zone-error')).toHaveText('A polygon needs at least 3 points');
    await clickZone(page, canvas, ...pts[2]);
    await clickZone(page, canvas, ...pts[3]);
    await expect(form.getByTestId('zone-points')).toContainText('4 point(s)');
    await expect(editor.getByTestId('draft-shape')).toBeVisible();
    await expect(editor.locator('[data-testid^="draft-point-"]')).toHaveCount(4);
    await form.getByTestId('input-zone-engaged-dwell').fill('45');
    await form.getByTestId('btn-save-zone').click();
    await expectToast(page, 'Zone saved');

    const zones1 = await admin.get('/api/zones', { storeId: store.id, cameraId: cam.id });
    const section = zones1.find((z: any) => z.name === 'Sarees');
    expect(section).toMatchObject({ type: 'SECTION', cameraId: cam.id, storeId: store.id, engagedDwellSec: 45, isActive: true });
    expect(section.polygon).toHaveLength(4);
    section.polygon.forEach((p: number[], i: number) => {
      for (const v of p) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      expect(p[0]).toBeCloseTo(pts[i][0], 1);
      expect(p[1]).toBeCloseTo(pts[i][1], 1);
    });
    await expect(editor.getByTestId(`zone-item-${section.id}`)).toContainText('Sarees');
    await expect(editor.getByTestId(`zone-shape-${section.id}`)).toBeVisible();

    // ---- ENTRY_LINE with exactly 2 points (a third click replaces the oldest)
    await editor.getByTestId('btn-new-zone').click();
    await form.getByTestId('input-zone-name').fill('Main door');
    await matSelect(page, form.getByTestId('input-zone-type'), 'Entry line');
    await matSelect(page, form.getByTestId('input-zone-direction'), 'Up');
    await clickZone(page, canvas, 0.05, 0.5);
    await clickZone(page, canvas, 0.1, 0.9);
    await clickZone(page, canvas, 0.9, 0.9);
    await expect(form.getByTestId('zone-points')).toContainText('2 point(s)');
    // the "in" arrow points up (a vertical SVG line has a zero-width box, so check its geometry instead of visibility)
    const arrow = editor.getByTestId('direction-arrow');
    await expect(arrow).toHaveCount(1);
    const [y1, y2] = await arrow.evaluate((l) => [Number(l.getAttribute('y1')), Number(l.getAttribute('y2'))]);
    expect(y2).toBeLessThan(y1);
    await form.getByTestId('btn-save-zone').click();
    await expectToast(page, 'Zone saved');
    // the first zone's "Zone saved" toast may still be on screen: wait for this save to land before reading the API
    await expect(editor.getByTestId('zone-form')).toBeHidden();
    const line = (await admin.get('/api/zones', { storeId: store.id, cameraId: cam.id })).find((z: any) => z.name === 'Main door');
    expect(line).toMatchObject({ type: 'ENTRY_LINE', inDirection: 'UP' });
    expect(line.polygon).toHaveLength(2);
    expect(line.polygon[0][0]).toBeCloseTo(0.1, 1);
    expect(line.polygon[1][0]).toBeCloseTo(0.9, 1);
    for (const p of line.polygon) for (const v of p) expect(v >= 0 && v <= 1).toBe(true);

    // ---- edge device for the store → key shown once, works for /api/ingest/config
    await page.goto('/admin/edge-devices');
    await page.getByTestId('btn-create-edge-device').click();
    await fillDialog(page, page.getByTestId('dialog-edge-device'), { name: `lab-edge-${code}`, storeId: { option: `Zone Lab ${code}` } });
    await page.getByTestId('dialog-edge-device').getByTestId('btn-save').click();
    const keyDlg = page.getByTestId('dialog-api-key');
    await expect(keyDlg).toBeVisible();
    const key = (await keyDlg.getByTestId('api-key-value').innerText()).trim();
    expect(key.length).toBeGreaterThanOrEqual(20);
    await page.getByTestId('btn-done').click();
    await expect(keyDlg).toBeHidden();

    const devices = await admin.get('/api/edge-devices', { storeId: store.id });
    expect(devices).toHaveLength(1);
    const dev = devices[0];
    expect(dev.apiKey).toBeUndefined(); // never shown again
    expect(key.startsWith(dev.apiKeyPrefix)).toBe(true);
    await expect(page.getByTestId(`row-edge-device-${dev.id}`)).toContainText(dev.apiKeyPrefix);

    const cfgRes = await edgeConfig(key, request);
    expect(cfgRes.status()).toBe(200);
    const cfg = await cfgRes.json();
    expect(cfg.store.id).toBe(store.id);
    expect(cfg.cameras.map((c: any) => c.id)).toEqual([cam.id]);
    expect(cfg.zones.map((z: any) => z.name).sort()).toEqual(['Main door', 'Sarees']);
    expect(cfg.settings).toHaveProperty('engagedStoreDwellSec');

    // ---- rotate key: old key stops working, the new one works
    await page.getByTestId(`row-edge-device-${dev.id}`).getByTestId('btn-rotate-key').click();
    await confirmDialog(page);
    await expect(keyDlg).toBeVisible();
    const key2 = (await keyDlg.getByTestId('api-key-value').innerText()).trim();
    await page.getByTestId('btn-done').click();
    expect(key2).not.toBe(key);
    expect((await edgeConfig(key, request)).status()).toBe(401);
    expect((await edgeConfig(key2, request)).status()).toBe(200);
    // a key cannot touch another store's camera: the foreign camera in a heartbeat is ignored
    const foreign = (await admin.get('/api/cameras', { storeId: 6 }))[0];
    const cross = await request.post(`${API_URL}/api/ingest/heartbeat`, { headers: { 'X-Api-Key': key2 }, data: { cameras: [{ cameraId: foreign.id, status: 'OFFLINE' }] } });
    expect(cross.status()).toBeLessThan(300);
    const foreignAfter = await admin.get(`/api/cameras/${foreign.id}`);
    expect(foreignAfter.status).toBe(foreign.status);
    expect(foreignAfter.lastHeartbeatAt).toBe(foreign.lastHeartbeatAt);

    // ---- delete zone + camera, then the device (key revoked)
    await page.goto(`/admin/stores/${store.id}/cameras`);
    await page.getByTestId('zone-editor').getByTestId(`zone-item-${section.id}`).getByTestId('btn-delete-zone').click();
    await confirmDialog(page);
    await expectToast(page, 'Zone deleted');
    expect((await admin.get('/api/zones', { storeId: store.id })).find((z: any) => z.id === section.id)?.isActive ?? false).toBe(false);
    await page.getByTestId(`row-camera-${cam.id}`).getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect.poll(async () => (await admin.get(`/api/cameras/${cam.id}`)).isActive).toBe(false);

    await page.goto('/admin/edge-devices');
    await page.getByTestId(`row-edge-device-${dev.id}`).getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(page.getByTestId(`row-edge-device-${dev.id}`)).toHaveCount(0);
    expect((await edgeConfig(key2, request)).status()).toBe(401);
    await admin.delete(`/api/stores/${store.id}`); // deactivate the lab store again
  });

  test('user CRUD with store assignment', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    const email = `${uid('user')}@congruence.in`;
    await page.goto('/admin/users');
    await page.getByTestId('btn-create-user').click();
    const dlg = page.getByTestId('dialog-user');
    await fillDialog(page, dlg, { name: 'E2E Area Manager', email, role: { option: 'Admin' } });
    await expect(dlg.getByTestId('input-storeIds')).toHaveCount(0); // admins see all stores
    await fillDialog(page, dlg, { role: { option: 'Store manager' } });
    await fillDialog(page, dlg, { password: 'Short1', storeIds: { options: ['Congruence T Nagar', 'Congruence Adyar'] } });
    await dlg.getByTestId('btn-save').click();
    await expect(dlg).toContainText('At least 8 characters');
    await fillDialog(page, dlg, { password: PASSWORD });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Created');

    const user = (await admin.get('/api/users')).find((u: any) => u.email === email);
    expect(user).toMatchObject({ name: 'E2E Area Manager', role: 'STORE_MANAGER', isActive: true, storeIds: [1, 4] });
    await page.getByTestId('input-search').fill(email);
    const row = page.getByTestId(`row-user-${user.id}`);
    await expect(row).toContainText('Congruence T Nagar, Congruence Adyar');

    const asUser = await Api.login(email);
    expect((await asUser.get('/api/stores')).map((s: any) => s.id)).toEqual([1, 4]);
    await asUser.dispose();

    // edit: drop Adyar, rename
    await row.getByTestId('btn-edit').click();
    const edlg = page.getByTestId('dialog-user');
    await expect(edlg.getByTestId('input-password')).toHaveCount(0); // create-only
    await fillDialog(page, edlg, { name: 'E2E Area Manager 2', storeIds: { options: ['Congruence Adyar'] } });
    await edlg.getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    await expect(row).toContainText('E2E Area Manager 2');
    expect((await admin.get(`/api/users/${user.id}`)).storeIds).toEqual([1]);

    // deactivate → login refused
    await row.getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(row.locator('[data-value="NO"]')).toBeVisible();
    expect((await admin.get(`/api/users/${user.id}`)).isActive).toBe(false);
    const r = await admin.ctx.post('/api/auth/login', { data: { email, password: PASSWORD } });
    expect(r.status()).toBe(401);
  });

  test('staff roster CRUD by the store manager', async ({ pageAs, api }) => {
    const mgrApi = await api('manager');
    const page = await pageAs('manager');
    const code = uid('ST').slice(-8).toUpperCase();
    await page.goto('/admin/staff');
    await expect(page.getByTestId('page-admin-staff')).toBeVisible();
    await page.getByTestId('btn-create-staff').click();
    const dlg = page.getByTestId('dialog-staff');
    await fillDialog(page, dlg, { storeId: { option: 'Congruence T Nagar' }, code, name: 'Lakshmi Priya', designation: 'Cashier', shiftStart: '11:00', shiftEnd: '20:00' });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Created');
    const s = (await mgrApi.get('/api/staff', { storeId: 1 })).find((x: any) => x.code === code);
    expect(s).toMatchObject({ storeId: 1, name: 'Lakshmi Priya', designation: 'Cashier', shiftStart: '11:00', shiftEnd: '20:00', isActive: true });
    await page.getByTestId('input-search').fill(code);
    const row = page.getByTestId(`row-staff-${s.id}`);
    await expect(row).toContainText('11:00 – 20:00');
    await row.getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-staff'), { shiftEnd: '21:30', designation: 'Senior cashier' });
    await page.getByTestId('dialog-staff').getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    await expect(row).toContainText('11:00 – 21:30');
    await row.getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(row).toHaveCount(0);
    expect((await mgrApi.get('/api/staff', { storeId: 1 })).some((x: any) => x.id === s.id)).toBe(false);
    // the manager cannot create staff in another store
    const r = await mgrApi.ctx.post('/api/staff', { data: { storeId: 2, code: `${code}X`, name: 'x', designation: 'x', shiftStart: '10:00', shiftEnd: '18:00' } });
    expect(r.status()).toBe(403);
  });

  test('audit log shows the actions (region create/update/delete)', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const me = await admin.get('/api/auth/me');
    const page = await pageAs('admin');
    const name = `E2E Region ${uid()}`;
    await page.goto('/admin/regions');
    await page.getByTestId('btn-create-region').click();
    await fillDialog(page, page.getByTestId('dialog-region'), { name });
    await page.getByTestId('dialog-region').getByTestId('btn-save').click();
    await expectToast(page, 'Created');
    const region = (await admin.get('/api/regions')).find((r: any) => r.name === name);
    await page.getByTestId('input-search').fill(name);
    await page.getByTestId(`row-region-${region.id}`).getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-region'), { name: `${name} 2` });
    await page.getByTestId('dialog-region').getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    await page.getByTestId('input-search').fill(`${name} 2`);
    await page.getByTestId(`row-region-${region.id}`).getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(page.getByTestId(`row-region-${region.id}`)).toHaveCount(0);

    const logs = (await admin.get('/api/audit-logs', { entity: 'regions', pageSize: 100 })).items.filter((l: any) => l.entityId === region.id);
    expect(logs.map((l: any) => l.action).sort()).toEqual(['CREATE', 'DELETE', 'UPDATE']);
    for (const l of logs) expect(l.userName).toBe(me.name);

    await page.goto('/admin/audit-log');
    await page.getByTestId('filter-audit-entity').fill('regions');
    const table = page.getByTestId('table-admin-audit-log');
    for (const l of logs) {
      const row = table.getByTestId(`row-audit-${l.id}`);
      await expect(row).toContainText(l.action);
      await expect(row).toContainText(`regions #${region.id}`);
      await expect(row).toContainText(me.name);
    }
    await matSelect(page, 'filter-audit-user', me.name);
    await expect(table.getByTestId(`row-audit-${logs[0].id}`)).toBeVisible();
    // passwords are masked in audit details
    const userLogs = (await admin.get('/api/audit-logs', { entity: 'users', pageSize: 50 })).items;
    for (const l of userLogs) expect(JSON.stringify(l.details ?? '')).not.toContain('Password@123');
  });
});
