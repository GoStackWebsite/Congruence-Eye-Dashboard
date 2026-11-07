/**
 * Settings (singleton): every test that saves the settings form lives in this file so they never run in parallel
 * (a form save writes all fields, so two concurrent saves would overwrite each other).
 */
import * as fs from 'fs';
import * as http from 'http';
import { AddressInfo } from 'net';
import { test, expect } from '../support/fixtures';
import { AI_URL, media, uid } from '../support/env';
import { expectToast } from '../support/ui';

/** A recording reverse proxy in front of the real ai-service: proves which URL the backend calls. */
async function recordingProxy(target: string) {
  const hits: string[] = [];
  const server = http.createServer((req, res) => {
    hits.push(`${req.method} ${req.url}`);
    const u = new URL(req.url ?? '/', target);
    const fwd = http.request(u, { method: req.method, headers: { ...req.headers, host: u.host } }, (r) => {
      res.writeHead(r.statusCode ?? 502, r.headers);
      r.pipe(res);
    });
    fwd.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(fwd);
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  return { hits, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, close: () => new Promise((r) => server.close(r)) };
}

test.describe('Settings', () => {
  test('settings save', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const before = await admin.get('/api/settings');
    const page = await pageAs('admin');
    await page.goto('/admin/settings');
    const form = page.getByTestId('form-settings');
    await expect(form.getByTestId('input-companyName')).toHaveValue(before.companyName);
    const company = `Congruence Retail ${uid()}`;
    await form.getByTestId('input-companyName').fill(company);
    await form.getByTestId('input-smtpFrom').fill('eye@congruence.in');
    await form.getByTestId('input-smtpPort').fill('2525');
    // v2: checklist reminder lead time
    await form.getByTestId('input-checklistReminderMinutes').fill('45');
    await page.getByTestId('btn-save').click();
    await expectToast(page, /saved/i);
    const after = await admin.get('/api/settings');
    expect(after).toMatchObject({ companyName: company, smtpFrom: 'eye@congruence.in', smtpPort: 2525, checklistReminderMinutes: 45, engagedStoreDwellSec: before.engagedStoreDwellSec, bounceSec: before.bounceSec, currency: 'INR' });
    await page.reload();
    await expect(page.getByTestId('form-settings').getByTestId('input-companyName')).toHaveValue(company);
    await expect(page.getByTestId('form-settings').getByTestId('input-checklistReminderMinutes')).toHaveValue('45');
    await admin.put('/api/settings', { companyName: before.companyName, smtpFrom: before.smtpFrom ?? null, smtpPort: before.smtpPort ?? null, checklistReminderMinutes: before.checklistReminderMinutes });
  });

  test('v2: the AI service URL setting is the one the backend calls for AI checks', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const before = await admin.get('/api/settings');
    const proxy = await recordingProxy(AI_URL);
    const page = await pageAs('admin');
    try {
      await page.goto('/admin/settings');
      const form = page.getByTestId('form-settings');
      await form.getByTestId('input-aiServiceUrl').fill(proxy.url);
      await page.getByTestId('btn-save').click();
      await expectToast(page, /saved/i);
      expect((await admin.get('/api/settings')).aiServiceUrl).toBe(proxy.url);
      const r = await admin.ctx.post('/api/checklists/ai-check', {
        multipart: { image: { name: `u-${uid()}.jpg`, mimeType: 'image/jpeg', buffer: fs.readFileSync(media('staff_uniform_ok.jpg')) }, type: 'UNIFORM' },
      });
      expect(r.ok()).toBe(true);
      expect((await r.json()).status).toBe('PASS');
      expect(proxy.hits).toContain('POST /ai/checklist/uniform');
      await page.reload();
      await expect(page.getByTestId('form-settings').getByTestId('input-aiServiceUrl')).toHaveValue(proxy.url);
      // the change is audited
      const logs = (await admin.get('/api/audit-logs', { entity: 'settings', pageSize: 20 })).items;
      expect(logs.some((l: any) => l.action === 'UPDATE' && JSON.stringify(l.details ?? '').includes(proxy.url))).toBe(true);
    } finally {
      await admin.put('/api/settings', { aiServiceUrl: before.aiServiceUrl ?? AI_URL });
      await proxy.close();
    }
  });
});
