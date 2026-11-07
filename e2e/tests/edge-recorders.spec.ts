/**
 * DVR / NVR recorders end to end (contract v3; docs/qa/UI_EDGE_CASE_PLAN.md · RC1–RC3) against a REAL RTSP server
 * and the REAL edge prober:
 *   e2e/fixtures/probe_edge.py starts ai-service/tests/rtsp_test_server.py (Digest auth, H.264 test pattern) as a
 *   CP Plus recorder on 127.0.0.1 and runs congruence_eye_ai.recorders.poller.ProbePoller with the store's edge key.
 * Admin › Store › Recorders: add a CP Plus recorder (password masked in the URL preview, never echoed back), add
 * channels as cameras ("DVR ch N"), "Test selected" → OK with the stream resolution; a second recorder with a wrong
 * password → AUTH with the plain-language fix "Wrong username or password for the DVR."
 */
import { ChildProcess, spawn } from 'child_process';
import * as path from 'path';
import { Page } from '@playwright/test';
import { Api, test, expect, tokenFor } from '../support/fixtures';
import { AI_PYTHON, API_URL, E2E_DIR, EDGE_KEY_STORE_1, FFMPEG, uid } from '../support/env';
import { settle } from '../support/qa';
import { matSelect } from '../support/ui';

const DVR_PASSWORD = 'Cp+Plus@123';

function startEdge(expect: number): Promise<{ proc: ChildProcess; port: number; done: Promise<number> }> {
  return new Promise((resolve, reject) => {
    const proc = spawn(AI_PYTHON, [path.join(E2E_DIR, 'fixtures', 'probe_edge.py'), '--backend', API_URL, '--key', EDGE_KEY_STORE_1, '--user', 'admin', '--password', DVR_PASSWORD, '--expect', String(expect), '--timeout', '150', '--ffmpeg', FFMPEG], {
      env: { ...process.env, LOG_LEVEL: 'WARNING' },
    });
    let out = '';
    let err = '';
    const done = new Promise<number>((r) => proc.on('exit', (code) => r(code ?? -1)));
    proc.stderr.on('data', (d) => (err += d));
    proc.stdout.on('data', (d) => {
      out += d;
      const m = /\{"port": (\d+)\}/.exec(out);
      if (m) resolve({ proc, port: Number(m[1]), done });
    });
    proc.on('exit', (c) => reject(new Error(`edge stand-in exited (${c}) before listening: ${err.slice(-500)}`)));
  });
}

async function addRecorder(page: Page, v: { name: string; port: number; password: string; channels: number }) {
  await page.getByTestId('btn-add-recorder').click();
  const dlg = page.getByTestId('dialog-recorder');
  await expect(dlg).toBeVisible();
  await matSelect(page, dlg.getByTestId('input-recorder-brand'), { testId: 'brand-option-CP_PLUS' });
  await dlg.getByTestId('input-recorder-name').fill(v.name);
  await dlg.getByTestId('input-recorder-host').fill('127.0.0.1');
  await dlg.getByTestId('input-recorder-rtspPort').fill(String(v.port));
  await dlg.getByTestId('input-recorder-username').fill('admin');
  await dlg.getByTestId('input-recorder-password').fill(v.password);
  await dlg.getByTestId('input-recorder-channels').fill(String(v.channels));
  // live preview of channel 1: CP Plus realmonitor URL, password masked
  const preview = dlg.getByTestId('recorder-url-preview');
  await expect(preview).toContainText(`rtsp://admin:****@127.0.0.1:${v.port}/cam/realmonitor?channel=1&subtype=0`);
  await expect(preview).not.toContainText(v.password);
  const created = page.waitForResponse((r) => r.url().endsWith('/api/recorders') && r.request().method() === 'POST');
  await dlg.getByTestId('btn-save').click();
  const rec = await (await created).json();
  expect(rec).toMatchObject({ brand: 'CP_PLUS', host: '127.0.0.1', rtspPort: v.port, hasPassword: true, channels: v.channels });
  expect(JSON.stringify(rec)).not.toContain(v.password);
  await expect(dlg).toBeHidden();
  createdRecorders.push(rec.id);
  return rec as { id: number };
}

const createdRecorders: number[] = [];

test.describe('Edge: DVR / NVR recorders with a real RTSP server and the real edge prober', () => {
  // remove the QA recorders and their cameras again (store 1 is shared with the other specs)
  test.afterAll(async () => {
    const admin = await Api.create(tokenFor('admin'));
    for (const id of createdRecorders) {
      const cams = ((await admin.get('/api/cameras', { storeId: 1 }).catch(() => [])) as any[]).filter((c) => c.recorderId === id);
      await admin.ctx.delete(`/api/recorders/${id}?unlinkCameras=true`).catch(() => undefined);
      for (const c of cams) await admin.ctx.delete(`/api/cameras/${c.id}`).catch(() => undefined);
    }
    await admin.dispose();
  });

  test('CP Plus recorder: masked URL, channels → cameras, Test selected → OK; wrong password → AUTH message', async ({ pageAs, api }) => {
    test.setTimeout(240_000);
    const admin = await api('admin');
    const edge = await startEdge(2);
    try {
      const page = await pageAs('admin');
      await page.goto('/admin/stores/1/recorders');
      await settle(page, 'page-admin-store');
      await expect(page.getByTestId('store-recorders')).toBeVisible();

      // ---- good recorder: 2 channels as cameras, tested OK through the real RTSP server
      const name = `QA CP Plus ${uid()}`;
      const rec = await addRecorder(page, { name, port: edge.port, password: DVR_PASSWORD, channels: 2 });
      await page.getByTestId(`row-recorder-${rec.id}`).getByTestId('btn-channels').click();
      const grid = page.getByTestId('recorder-channels');
      await expect(grid.getByTestId('channel-1').getByTestId('channel-camera')).toHaveText('Not added');
      await grid.getByTestId('btn-select-all-channels').click();
      await grid.getByTestId('btn-add-as-cameras').click();
      await page.getByTestId('input-channels-prefix').fill('QA Entrance');
      await page.getByTestId('btn-confirm-add-cameras').click();
      await expect(grid.getByTestId('channel-1').getByTestId('channel-camera')).not.toHaveText('Not added');
      const cams = (await admin.get('/api/cameras', { storeId: 1 })).filter((c: any) => c.recorderId === rec.id);
      expect(cams.map((c: any) => c.channel).sort()).toEqual([1, 2]);
      // browser responses only carry the masked URL
      for (const c of cams) expect(c.rtspUrl).toContain('admin:****@');

      const selAll = grid.getByTestId('btn-select-all-channels');
      if ((await selAll.innerText()).includes('Select all')) await selAll.click();
      await grid.getByTestId('btn-test-selected').click();
      for (const ch of [1, 2]) {
        const card = grid.getByTestId(`channel-${ch}`);
        await expect(card.getByTestId('channel-status')).toHaveText('OK', { timeout: 90_000 });
        await expect(card.getByTestId('channel-result')).toContainText('640×360');
      }
      expect(await edge.done).toBe(0);
      await expect(page.getByTestId(`row-recorder-${rec.id}`).getByTestId('chip-recorder-status')).toHaveAttribute('data-value', 'ONLINE', { timeout: 20_000 }).catch(async () => {
        await page.reload();
        await expect(page.getByTestId(`row-recorder-${rec.id}`).getByTestId('chip-recorder-status')).toHaveAttribute('data-value', 'ONLINE');
      });
    } finally {
      edge.proc.kill();
    }

    // ---- wrong password: the DVR answers 401 → AUTH with the fix text
    const edge2 = await startEdge(1);
    try {
      const page = await pageAs('admin');
      await page.goto('/admin/stores/1/recorders');
      await settle(page, 'page-admin-store');
      const rec = await addRecorder(page, { name: `QA wrong pw ${uid()}`, port: edge2.port, password: 'wrong-password', channels: 1 });
      await page.getByTestId(`row-recorder-${rec.id}`).getByTestId('btn-channels').click();
      const grid = page.getByTestId('recorder-channels');
      await grid.getByTestId('channel-1').getByTestId('channel-select').click();
      await grid.getByTestId('btn-test-selected').click();
      const card = grid.getByTestId('channel-1');
      await expect(card.getByTestId('channel-status')).toHaveText('Failed', { timeout: 90_000 });
      await expect(card.getByTestId('channel-error')).toHaveText('Wrong username or password for the DVR.');
      expect(await edge2.done).toBe(0);
      const probes = await admin.get('/api/probes', { recorderId: rec.id });
      expect(probes[0]).toMatchObject({ status: 'FAILED', errorCode: 'AUTH' });
    } finally {
      edge2.proc.kill();
    }
  });
});
