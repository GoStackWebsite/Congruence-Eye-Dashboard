import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../support/fixtures';
import { FIXTURES, uid } from '../support/env';
import { confirmDialog, expectToast, fillDialog, matSelect } from '../support/ui';

test.describe('Documents', () => {
  test('upload, list, download (content matches) and delete a document', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const title = `E2E SOP ${uid()}`;
    const fixture = path.join(FIXTURES, 'sop.txt');
    const original = fs.readFileSync(fixture, 'utf8');

    const mgr = await pageAs('manager');
    await mgr.goto('/documents');
    await mgr.getByTestId('btn-upload-document').click();
    const dlg = mgr.getByTestId('dialog-document');
    // a file is required
    await dlg.getByTestId('btn-save').click();
    await expect(dlg).toContainText('Choose a file to upload');
    await dlg.getByTestId('input-file').setInputFiles(fixture);
    await expect(dlg.getByTestId('input-title')).toHaveValue('sop'); // pre-filled from the file name
    await dlg.getByTestId('input-title').fill(title);
    await matSelect(mgr, dlg.getByTestId('input-category'), 'SOP');
    await matSelect(mgr, dlg.getByTestId('input-storeId'), 'Congruence T Nagar');
    await dlg.getByTestId('btn-save').click();
    await expectToast(mgr, 'Document uploaded');

    const doc = (await admin.get('/api/documents', { storeId: 1 })).find((d: any) => d.title === title);
    expect(doc).toMatchObject({ category: 'SOP', storeId: 1, storeName: 'Congruence T Nagar', fileName: 'sop.txt', size: Buffer.byteLength(original) });
    expect(doc.mimeType).toMatch(/^text\/plain/);
    const row = mgr.getByTestId(`row-document-${doc.id}`);
    await expect(row).toContainText(title);
    await expect(row).toContainText('sop.txt');

    // download through the UI → same bytes
    const dl = mgr.waitForEvent('download');
    await row.getByTestId('btn-download').click();
    const file = await dl;
    expect(file.suggestedFilename()).toBe('sop.txt');
    expect(fs.readFileSync(await file.path(), 'utf8')).toBe(original);
    // and through the API (Content-Disposition)
    const r = await admin.ctx.get(`/api/documents/${doc.id}/download`);
    expect(r.status()).toBe(200);
    expect(r.headers()['content-disposition']).toContain('filename="sop.txt"');
    expect(await r.text()).toBe(original);

    // STAFF of T Nagar can see + download it but has no upload/delete
    const staff = await pageAs('staff');
    await staff.goto('/documents');
    await expect(staff.getByTestId('btn-upload-document')).toHaveCount(0);
    const srow = staff.getByTestId(`row-document-${doc.id}`);
    await expect(srow.getByTestId('btn-download')).toBeVisible();
    await expect(srow.getByTestId('btn-delete')).toHaveCount(0);
    // a store-2 document is invisible to the T Nagar staff
    const other = await (await api('admin')).ctx.post('/api/documents', {
      multipart: { title: `${title} ANN`, category: 'CIRCULAR', storeId: '2', file: { name: 'ann.txt', mimeType: 'text/plain', buffer: Buffer.from('anna nagar only') } },
    });
    expect(other.status()).toBe(201);
    const otherDoc = await other.json();
    await staff.reload();
    await expect(srow).toBeVisible();
    await expect(staff.getByTestId(`row-document-${otherDoc.id}`)).toHaveCount(0);
    expect((await (await api('staff')).ctx.get(`/api/documents/${otherDoc.id}/download`)).status()).toBe(403);

    // filters
    await mgr.reload();
    // category filter chips
    await mgr.getByTestId('filter-document-category').getByTestId('doc-cat-TRAINING').click();
    await expect(row).toHaveCount(0);
    await mgr.getByTestId('filter-document-category').getByTestId('doc-cat-SOP').click();
    await expect(row).toBeVisible();

    // delete
    await row.getByTestId('btn-delete').click();
    await confirmDialog(mgr);
    await expectToast(mgr, 'Document deleted');
    await expect(row).toHaveCount(0);
    expect((await admin.ctx.get(`/api/documents/${doc.id}/download`)).status()).toBe(404);
    await admin.delete(`/api/documents/${otherDoc.id}`);
  });
});

test.describe('Vendors', () => {
  test('vendor CRUD → schedule visit → check-in → check-out with rating', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const name = `E2E Sparkle Housekeeping ${uid()}`;
    const page = await pageAs('manager');
    await page.goto('/vendors');
    await expect(page.getByTestId('page-vendors')).toBeVisible();

    // ---- create
    await page.getByTestId('btn-create-vendor').click();
    const dlg = page.getByTestId('dialog-vendor');
    await fillDialog(page, dlg, {
      name,
      category: { option: 'Housekeeping' },
      contactName: 'Meena K',
      phone: '+91 98400 12345',
      email: 'meena@sparkle.example',
    });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Created');
    const vendor = (await admin.get('/api/vendors')).find((v: any) => v.name === name);
    expect(vendor).toMatchObject({ category: 'HOUSEKEEPING', contactName: 'Meena K', phone: '+91 98400 12345', email: 'meena@sparkle.example', isActive: true });
    await page.getByTestId('page-vendors').getByTestId('input-search').fill(name);
    const row = page.getByTestId(`row-vendor-${vendor.id}`);
    await expect(row).toContainText('Meena K');

    // ---- update
    await row.getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-vendor'), { contactName: 'Meena Krishnan', category: { option: 'Maintenance' } });
    await page.getByTestId('dialog-vendor').getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    await expect(row).toContainText('Meena Krishnan');
    await expect.poll(async () => (await admin.get('/api/vendors')).find((v: any) => v.id === vendor.id)).toMatchObject({ contactName: 'Meena Krishnan', category: 'MAINTENANCE' });

    // ---- schedule a visit (Visits tab)
    await page.getByTestId('vendor-tabs').getByRole('tab', { name: 'Visits' }).click();
    const visits = page.getByTestId('page-vendor-visits');
    await expect(visits).toBeVisible();
    await visits.getByTestId('btn-create-visit').click();
    const vd = page.getByTestId('dialog-visit');
    await fillDialog(page, vd, {
      vendorId: { option: name },
      storeId: { option: 'Congruence T Nagar' },
      purpose: 'Deep cleaning of trial rooms',
      scheduledAt: '2030-02-01T09:30',
    });
    await vd.getByTestId('btn-save').click();
    await expectToast(page, 'Visit scheduled');
    const visit = (await admin.get('/api/vendor-visits', { vendorId: vendor.id }))[0];
    expect(visit).toMatchObject({ vendorId: vendor.id, storeId: 1, purpose: 'Deep cleaning of trial rooms', status: 'SCHEDULED', checkInAt: null });
    expect(new Date(visit.scheduledAt).toISOString()).toBe('2030-02-01T04:00:00.000Z');

    const vrow = page.getByTestId(`row-visit-${visit.id}`);
    await expect(vrow.getByTestId('chip-status')).toHaveAttribute('data-value', 'SCHEDULED');
    await vrow.getByTestId('btn-check-in').click();
    await expectToast(page, `${name} checked in`);
    await expect(vrow.getByTestId('chip-status')).toHaveAttribute('data-value', 'CHECKED_IN');
    await expect(vrow.getByTestId('btn-check-in')).toHaveCount(0);

    await vrow.getByTestId('btn-check-out').click();
    const co = page.getByTestId('dialog-check-out');
    await fillDialog(page, co, { rating: { option: /\(4\)$/ }, notes: 'Good job, mirrors streaky' });
    await co.getByTestId('btn-save').click();
    await expectToast(page, 'Visit completed');
    await expect(vrow.getByTestId('chip-status')).toHaveAttribute('data-value', 'COMPLETED');
    await expect(vrow).toContainText('★★★★☆');
    const done = (await admin.get('/api/vendor-visits', { vendorId: vendor.id }))[0];
    expect(done).toMatchObject({ status: 'COMPLETED', rating: 4, notes: 'Good job, mirrors streaky' });
    expect(new Date(done.checkOutAt).getTime()).toBeGreaterThanOrEqual(new Date(done.checkInAt).getTime());

    // filter by status
    await matSelect(page, 'filter-visit-status', 'Completed');
    await expect(vrow).toBeVisible();
    await matSelect(page, 'filter-visit-status', 'Scheduled');
    await expect(vrow).toHaveCount(0);

    // ---- delete: a vendor with visits is deactivated instead
    await page.getByTestId('vendor-tabs').getByRole('tab', { name: 'Vendors' }).click();
    await page.getByTestId('page-vendors').getByTestId('input-search').fill(name);
    await row.getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(row.locator('[data-value="NO"]')).toBeVisible();
    expect((await admin.get('/api/vendors')).find((v: any) => v.id === vendor.id).isActive).toBe(false);

    // a vendor without visits is removed
    const temp = await admin.post('/api/vendors', { name: `${name} temp`, category: 'IT', isActive: true });
    await page.getByTestId('page-vendors').getByTestId('btn-refresh').click();
    await page.getByTestId('page-vendors').getByTestId('input-search').fill(`${name} temp`);
    await page.getByTestId(`row-vendor-${temp.id}`).getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(page.getByTestId(`row-vendor-${temp.id}`)).toHaveCount(0);
    expect((await admin.get('/api/vendors')).some((v: any) => v.id === temp.id)).toBe(false);
  });
});
