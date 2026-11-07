/**
 * Admin v2: store format, SHELF zone with a reference snapshot from the image directory, v2 settings
 * (in trax-v2.spec.ts, next to the other AI-check users) and the audit log entries for these actions.
 */
import { Locator, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { uid } from '../support/env';
import { confirmDialog, expectToast, fillDialog, matSelect } from '../support/ui';

async function clickZone(page: Page, canvas: Locator, x: number, y: number) {
  await canvas.scrollIntoViewIfNeeded();
  const b = (await canvas.boundingBox())!;
  await page.mouse.click(b.x + b.width * x, b.y + b.height * y);
}

test.describe('Admin v2', () => {
  test('store format: create as Mall, change to Airport; the format drives the benchmark grouping', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    const code = `E2E-${uid('f').slice(-6).toUpperCase()}`;
    await page.goto('/admin/stores');
    await page.getByTestId('btn-create-store').click();
    const dlg = page.getByTestId('dialog-store');
    await fillDialog(page, dlg, {
      code, name: `Congruence ${code}`, regionId: { option: 'Chennai' }, city: 'Chennai', format: { option: 'Mall' },
      address: 'Express Avenue', openTime: '10:00', closeTime: '22:00', areaSqft: 3000,
    });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Created');
    const store = (await admin.get('/api/stores')).find((s: any) => s.code === code);
    expect(store.format).toBe('MALL');
    await page.getByTestId('input-search').fill(code);
    await page.getByTestId(`row-store-${store.id}`).getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-store'), { format: { option: 'Airport' } });
    await page.getByTestId('dialog-store').getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    expect((await admin.get(`/api/stores/${store.id}`)).format).toBe('AIRPORT');
    const groups = await admin.get('/api/analytics/benchmark/groups', { groupBy: 'format' });
    expect(groups.find((g: any) => g.group === 'AIRPORT')).toMatchObject({ stores: 1 });
    await admin.delete(`/api/stores/${store.id}`);
  });

  test('zone editor: SHELF zone with a reference snapshot picked from the image directory', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const me = await admin.get('/api/auth/me');
    const page = await pageAs('admin');
    const cams = await admin.get('/api/cameras', { storeId: 1 });
    const floor = cams.find((c: any) => c.type === 'ZONE');
    await page.goto('/admin/stores/1/cameras');
    await page.getByTestId(`row-camera-${floor.id}`).getByTestId('btn-edit-zones').click();
    const editor = page.getByTestId('zone-editor');
    await expect(editor).toContainText(floor.name);
    const canvas = editor.getByTestId('zone-canvas');
    const name = `E2E shelf ${uid()}`;
    await editor.getByTestId('btn-new-zone').click();
    const form = editor.getByTestId('zone-form');
    await form.getByTestId('input-zone-name').fill(name);
    await matSelect(page, form.getByTestId('input-zone-type'), 'Shelf');
    await expect(form.getByTestId('zone-reference')).toBeVisible();
    await expect(form.getByTestId('zone-reference-id')).toHaveText('None selected');
    for (const [x, y] of [[0.05, 0.1], [0.3, 0.1], [0.3, 0.45], [0.05, 0.45]]) await clickZone(page, canvas, x, y);
    await expect(form.getByTestId('zone-points')).toContainText('4 point(s)');
    // pick the "full shelf" reference from this camera's snapshots
    await form.getByTestId('btn-pick-reference').click();
    const picker = page.getByTestId('dialog-snapshot-picker');
    await expect(picker).toBeVisible();
    const first = picker.locator('[data-testid^="picker-image-"]').first();
    await expect(first).toBeVisible();
    const snapId = Number((await first.getAttribute('data-testid'))!.replace('picker-image-', ''));
    await first.click();
    await page.getByTestId('btn-select-snapshot').click();
    await expect(form.getByTestId('zone-reference-id')).toHaveText(`Snapshot #${snapId}`);
    await expect.poll(() => form.getByTestId('zone-reference-thumb').evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(0);
    await form.getByTestId('btn-save-zone').click();
    await expectToast(page, 'Zone saved');
    const zone = (await admin.get('/api/zones', { storeId: 1, cameraId: floor.id })).find((z: any) => z.name === name);
    expect(zone).toMatchObject({ type: 'SHELF', referenceSnapshotId: snapId, isActive: true, cameraId: floor.id });
    expect(zone.polygon).toHaveLength(4);
    const snap = (await admin.get('/api/image-directory', { storeIds: '1', cameraId: floor.id, pageSize: 500 })).items.find((s: any) => s.id === snapId);
    expect(snap, 'the reference is one of this camera\'s snapshots').toBeTruthy();
    // a SHELF zone is offered as a detection area for STOCK_OUT rules (checked in ai-manager.spec) and sent to the edge
    // (deactivate it again so the simulator-driven tests keep the seeded layout)
    await editor.getByTestId(`zone-item-${zone.id}`).getByTestId('btn-delete-zone').click();
    await confirmDialog(page);
    await expectToast(page, 'Zone deleted');
    // the audit log recorded the zone create/delete by this admin
    const logs = (await admin.get('/api/audit-logs', { entity: 'zones', pageSize: 100 })).items.filter((l: any) => l.entityId === zone.id);
    expect(logs.map((l: any) => l.action).sort()).toEqual(['CREATE', 'DELETE']);
    expect(logs.every((l: any) => l.userName === me.name)).toBe(true);
  });
});
