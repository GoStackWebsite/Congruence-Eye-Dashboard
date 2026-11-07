import * as fs from 'fs';
import * as path from 'path';
import { test, expect } from '../support/fixtures';
import { API_URL, TMP, TZ, todayLocal, uid } from '../support/env';
import { expectToast, fmt, kpiText, presetFilter, waitForApi } from '../support/ui';

/** Store-local "YYYY-MM-DDTHH:mm:ss" (no offset → read as store-local by the importer) `minutesAgo` before now. */
function localTs(minutesAgo: number): string {
  const d = new Date(Date.now() - minutesAgo * 60_000);
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' })
      .formatToParts(d)
      .map((x) => [x.type, x.value]),
  );
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

test.describe('POS integration', () => {
  test('CSV import through the UI (accepted / duplicates / errors) is reflected in conversion', async ({ pageAs, api }) => {
    const ist = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date());
    test.skip(ist < '00:10', 'needs a few minutes of "today" for the bills');
    const admin = await api('admin');
    const today = todayLocal();
    const tag = uid('B').replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase();
    const bills = [
      { billNo: `${tag}-1`, ts: localTs(5), amount: 1250.5, items: 3 },
      { billNo: `${tag}-2`, ts: localTs(4), amount: 3999, items: 5 },
      { billNo: `${tag}-3`, ts: localTs(3), amount: 750.25, items: 1 },
    ];
    const csv = [
      'storeCode,billNo,ts,amount,itemsCount,staffCode',
      ...bills.map((b) => `CNG-TNR,${b.billNo},${b.ts},${b.amount},${b.items},TNR-S01`),
      `CNG-TNR,${tag}-1,${bills[0].ts},${bills[0].amount},${bills[0].items},TNR-S01`, // duplicate inside the file
      `NOPE-999,${tag}-9,${bills[0].ts},100,1,`, // unknown store → error
    ].join('\n');
    const file = path.join(TMP, `pos-${tag}.csv`);
    fs.writeFileSync(file, csv);
    const revenue = bills.reduce((s, b) => s + b.amount, 0);

    const before = await admin.get('/api/analytics/conversion', { storeIds: '1', from: today, to: today });
    const liveBefore = await admin.get('/api/analytics/live', { storeId: 1 });

    const page = await pageAs('manager');
    await page.goto('/reports');
    await expect(page.getByTestId('pos-import')).toBeVisible();
    const resp = page.waitForResponse((r) => r.url().endsWith('/api/pos/import'));
    await page.getByTestId('input-pos-file').setInputFiles(file);
    const result = await (await resp).json();
    expect(result.accepted).toBe(3);
    expect(result.duplicates).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toMatch(/NOPE-999|store/i);
    await expect(page.getByTestId('pos-import-result')).toHaveText('Accepted 3 · duplicates 1 · errors 1');
    await expectToast(page, 'Imported 3 transactions');

    // importing the same file again: everything is a duplicate
    const resp2 = page.waitForResponse((r) => r.url().endsWith('/api/pos/import'));
    await page.getByTestId('input-pos-file').setInputFiles(file);
    const again = await (await resp2).json();
    expect(again).toMatchObject({ accepted: 0, duplicates: 4 });
    await expect(page.getByTestId('pos-import-result')).toHaveText('Accepted 0 · duplicates 4 · errors 1');

    // transactions are listed
    const list = await admin.get('/api/pos/transactions', { storeIds: '1', from: today, to: today, pageSize: 500 });
    const mine = list.items.filter((t: any) => t.billNo.startsWith(tag));
    expect(mine).toHaveLength(3);
    expect(mine.find((t: any) => t.billNo === `${tag}-2`)).toMatchObject({ storeId: 1, storeName: 'Congruence T Nagar', amount: 3999, itemsCount: 5, staffCode: 'TNR-S01' });

    // conversion / live reflect exactly these bills
    const after = await admin.get('/api/analytics/conversion', { storeIds: '1', from: today, to: today });
    expect(after.totals.transactions - before.totals.transactions).toBe(3);
    expect(after.totals.revenue - before.totals.revenue).toBeCloseTo(revenue, 0);
    expect(after.funnel.transactions).toBe(after.totals.transactions);
    const traffic = await admin.get('/api/analytics/traffic', { storeIds: '1', from: today, to: today });
    expect(after.totals.conversionPct).toBeCloseTo((after.totals.transactions / traffic.totals.billableEntities) * 100, 1);
    const liveAfter = await admin.get('/api/analytics/live', { storeId: 1 });
    expect(liveAfter.todayTransactions - liveBefore.todayTransactions).toBe(3);

    // and the conversion page shows the new totals for today / T Nagar
    const cpage = await pageAs('manager');
    await presetFilter(cpage, { preset: 'today', storeIds: [1] });
    const cr = waitForApi(cpage, '/api/analytics/conversion', (u) => u.searchParams.get('from') === today);
    await cpage.goto('/analytics/conversion');
    const ui = await (await cr).json();
    expect(ui.totals.transactions).toBeGreaterThanOrEqual(after.totals.transactions);
    expect(await kpiText(cpage, 'transactions')).toBe(fmt.number(ui.totals.transactions));
    expect(await kpiText(cpage, 'conversion')).toBe(fmt.pct(ui.totals.conversionPct));
  });

  test('POS API: JWT and edge API key, duplicate detection, permissions', async ({ api, request }) => {
    const tag = uid('A').replace(/[^A-Za-z0-9]/g, '').slice(-10).toUpperCase();
    const ts = new Date(Date.now() - 2 * 60_000).toISOString();
    const body = { transactions: [{ storeId: 2, billNo: `${tag}-1`, ts, amount: 999, itemsCount: 2 }, { storeId: 2, billNo: `${tag}-2`, ts, amount: 501, itemsCount: 1, staffCode: 'ANN-S02' }] };

    // edge key of store 2
    const r1 = await request.post(`${API_URL}/api/pos/transactions`, { headers: { 'X-Api-Key': 'dev-edge-key-store-2' }, data: body });
    expect(r1.status()).toBeLessThan(300);
    expect(await r1.json()).toEqual({ accepted: 2, duplicates: 0 });
    // same bills again with an admin JWT → duplicates
    const admin = await api('admin');
    expect(await admin.post('/api/pos/transactions', body)).toEqual({ accepted: 0, duplicates: 2 });
    // a store-2 key cannot post bills for store 1
    const cross = await request.post(`${API_URL}/api/pos/transactions`, { headers: { 'X-Api-Key': 'dev-edge-key-store-2' }, data: { transactions: [{ storeId: 1, billNo: `${tag}-X`, ts, amount: 1, itemsCount: 1 }] } });
    expect(cross.status()).toBeGreaterThanOrEqual(400);
    // STAFF and AUDITOR cannot import, the T Nagar manager cannot post for Anna Nagar
    expect((await (await api('staff')).ctx.post('/api/pos/transactions', { data: body })).status()).toBe(403);
    expect((await (await api('auditor')).ctx.post('/api/pos/transactions', { data: body })).status()).toBe(403);
    expect((await (await api('manager')).ctx.post('/api/pos/transactions', { data: { transactions: [{ ...body.transactions[0], billNo: `${tag}-M` }] } })).status()).toBe(403);
    // paged listing contract
    const page = await admin.get('/api/pos/transactions', { storeIds: '2', page: 1, pageSize: 5 });
    expect(page).toMatchObject({ page: 1, pageSize: 5 });
    expect(page.items.length).toBeLessThanOrEqual(5);
    expect(page.total).toBeGreaterThan(5);
  });
});
