import * as fs from 'fs';
import { Download, Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { BACKEND_DIR } from '../support/env';
// exceljs is a backend dependency; reuse it to open the workbooks
// eslint-disable-next-line @typescript-eslint/no-require-imports
const ExcelJS = require(require.resolve('exceljs', { paths: [BACKEND_DIR] }));
import { addDays, todayLocal, uid } from '../support/env';
import { confirmDialog, expectToast, fillDialog, presetFilter } from '../support/ui';

const HEADERS: Record<string, string> = {
  traffic: 'Date,Store,Footfall In,Footfall Out,Unique Visitors,Staff Excluded,Individuals,Groups,Billable Entities,Engaged,Bounced,Repeat Visitors,Avg Dwell (s)',
  zones: 'Store,Zone,Visits,Unique Visitors,Avg Dwell (s),Engaged,Engaged %,Male,Female,Class',
  conversion: 'Date,Store,Footfall,Billable Entities,Transactions,Conversion %,Revenue (INR),ATV (INR),Items Sold,Missed Opportunities',
  queue: 'Date,Store,Avg Queue,Max Queue,Avg Wait (s),Max Wait (s),Breaches,Unattended (min)',
  storeops: 'Date,Store,Scheduled Open,Actual Open,Late (min),Scheduled Close,Actual Close,Early (min)',
  benchmark: 'Rank,Store,Region,Footfall,Footfall Change %,Conversion %,Revenue (INR),ATV (INR),Revenue / sqft,Avg Dwell (s),Avg Queue Wait (s),Compliance %',
  checklists: 'Date,Store,Template,Category,Submitted By,Submitted At,Score,Max Score,Score %,Status',
  alerts: 'Created At,Store,Rule,Metric,Severity,Value,Status,Message,Resolved At',
  tasks: 'ID,Title,Store,Type,Priority,Status,Assignee,Created By,Due At,Completed At,Created At',
  tickets: 'Ticket,Title,Store,Category,Priority,Status,Assignee,Reporter,SLA Due,Resolved At,SLA Breached,Created At',
};

async function exportVia(page: Page, type: string): Promise<{ name: string; body: Buffer; dl: Download }> {
  const dl = page.waitForEvent('download');
  await page.getByTestId(`report-card-${type}`).getByTestId(`btn-export-${type}`).click();
  const d = await dl;
  return { name: d.suggestedFilename(), body: fs.readFileSync((await d.path())!), dl: d };
}
const csvLines = (b: Buffer) => b.toString('utf8').replace(/^﻿/, '').trim().split(/\r?\n/);

test.describe('Reports', () => {
  test('CSV exports for every report type have the right file name and header row', async ({ pageAs, api }) => {
    const from = addDays(todayLocal(), -3);
    const to = addDays(todayLocal(), -1);
    const page = await pageAs('admin');
    await presetFilter(page, { preset: 'custom', custom: { from, to } });
    await page.goto('/reports');
    await expect(page.getByTestId('report-exports')).toBeVisible();
    await page.getByTestId('select-report-format').getByTestId('format-csv').click();

    const bodies: Record<string, Buffer> = {};
    for (const type of Object.keys(HEADERS)) {
      const { name, body } = await exportVia(page, type);
      bodies[type] = body;
      expect(name, type).toMatch(new RegExp(`^${type}.*\\.csv$`));
      expect(body.subarray(0, 3).toString('hex'), `${type} has a UTF-8 BOM`).toBe('efbbbf');
      const lines = csvLines(body);
      expect(lines[0], `${type} header`).toBe(HEADERS[type]);
      if (['traffic', 'conversion', 'queue', 'benchmark', 'zones'].includes(type)) expect(lines.length, `${type} rows`).toBeGreaterThan(1);
    }

    // traffic: one row per store per day; values equal the API daily numbers
    const lines = csvLines(bodies.traffic);
    expect(lines.length - 1).toBe(3 * 6);
    const admin = await api('admin');
    const t1 = await admin.get('/api/analytics/traffic', { storeIds: '1', from: to, to });
    const tnRow = lines.find((l) => l.startsWith(`${to},Congruence T Nagar,`))!;
    expect(tnRow.split(',')[2]).toBe(String(t1.totals.footfallIn));
  });

  test('XLSX exports for every report type are real workbooks with the same header row and T Nagar-only rows', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await presetFilter(page, { preset: 'last7', storeIds: [1] });
    await page.goto('/reports');
    await page.getByTestId('select-report-format').getByTestId('format-xlsx').click();
    for (const type of Object.keys(HEADERS)) {
      const { name, body } = await exportVia(page, type);
      expect(name, type).toMatch(new RegExp(`^${type}.*\\.xlsx$`));
      expect(body.subarray(0, 2).toString(), `${type} is a zip`).toBe('PK');
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(body);
      const ws = wb.worksheets[0];
      expect(ws, `${type} worksheet`).toBeTruthy();
      const header = (ws.getRow(1).values as unknown[]).slice(1).map((v) => String(v));
      expect(header.join(','), `${type} header`).toBe(HEADERS[type]);
      const storeCol = header.indexOf('Store') + 1;
      const rows = ws.rowCount - 1;
      if (['traffic', 'conversion', 'queue', 'benchmark', 'zones', 'storeops'].includes(type)) expect(rows, `${type} rows`).toBeGreaterThan(0);
      if (storeCol > 0) {
        for (let r = 2; r <= ws.rowCount; r++) expect(String(ws.getRow(r).getCell(storeCol).value), `${type} row ${r} store`).toBe('Congruence T Nagar');
      }
    }
    // benchmark XLSX via the benchmark page button too
    await page.goto('/analytics/benchmark');
    await expect(page.getByTestId('table-benchmark').locator('[data-testid^="row-benchmark-"]').first()).toBeVisible();
    const dl = page.waitForEvent('download');
    await page.getByTestId('btn-export-xlsx').click();
    expect((await dl).suggestedFilename()).toMatch(/^benchmark.*\.xlsx$/);
  });

  test('API export rejects unknown types and is scoped for a store manager', async ({ api }) => {
    const admin = await api('admin');
    const bad = await admin.ctx.get('/api/reports/export', { params: { type: 'nope', format: 'csv' } });
    expect(bad.status()).toBe(400);
    const mgr = await api('manager');
    const y = addDays(todayLocal(), -1);
    const r = await mgr.ctx.get('/api/reports/export', { params: { type: 'traffic', format: 'csv', from: y, to: y } });
    expect(r.status()).toBe(200);
    expect(r.headers()['content-disposition']).toMatch(/attachment; filename="?traffic.*\.csv/);
    const lines = csvLines(await r.body());
    expect(lines.length).toBe(2); // only T Nagar
    expect(lines[1]).toContain('Congruence T Nagar');
  });

  test('scheduled report: create in the UI, run now, file is generated', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const name = `E2E weekly benchmark ${uid()}`;
    const page = await pageAs('admin');
    await page.goto('/reports');
    const sched = page.getByTestId('page-report-schedules');
    const dlg = page.getByTestId('dialog-schedule');
    // the embedded schedules list loads lazily: retry the click until the dialog is open
    await expect(async () => {
      await sched.getByTestId('btn-create-schedule').click();
      await expect(dlg).toBeVisible({ timeout: 2000 });
    }).toPass({ timeout: 20_000 });
    await fillDialog(page, dlg, {
      name,
      type: { option: 'Benchmark' },
      format: { option: 'XLSX' },
      frequency: { option: 'Weekly' },
      storeIds: { options: ['Congruence T Nagar', 'Congruence Anna Nagar'] },
      recipients: 'ceo@congruence.in, ops@congruence.in',
    });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Created');
    const s = (await admin.get('/api/reports/schedules')).find((x: any) => x.name === name);
    expect(s).toMatchObject({ type: 'benchmark', format: 'xlsx', frequency: 'WEEKLY', isActive: true, lastRunAt: null });
    expect([...s.storeIds].sort()).toEqual([1, 2]);
    expect(s.recipients).toContain('ceo@congruence.in');

    await sched.getByTestId('input-search').fill(name);
    const row = page.getByTestId(`row-schedule-${s.id}`);
    await expect(row).toContainText('Congruence T Nagar');
    const run = page.waitForResponse((r) => r.url().includes(`/api/reports/schedules/${s.id}/run`));
    await row.getByTestId('btn-run-schedule').click();
    const result = await (await run).json();
    expect(result.ok).toBe(true);
    expect(result.file).toMatch(/\.xlsx$/);
    await expectToast(page, /Report generated/);
    const after = (await admin.get('/api/reports/schedules')).find((x: any) => x.id === s.id);
    expect(after.lastRunAt).toBeTruthy();
    await expect(row).not.toContainText('—', { timeout: 10_000 }); // last run column filled

    // the generated file is downloadable from /uploads
    const url = result.file.startsWith('/') ? result.file : `/uploads/${result.file.replace(/^.*?(reports\/)/, '$1')}`;
    const f = await page.request.get(url);
    expect(f.status()).toBe(200);
    expect((await f.body()).subarray(0, 2).toString()).toBe('PK');

    // edit + delete
    await row.getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-schedule'), { isActive: false });
    await page.getByTestId('dialog-schedule').getByTestId('btn-save').click();
    await expect(row.locator('[data-value="NO"]')).toBeVisible();
    await row.getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(row).toHaveCount(0);
    expect((await admin.get('/api/reports/schedules')).some((x: any) => x.id === s.id)).toBe(false);
  });
});
