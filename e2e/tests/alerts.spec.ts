import { Page } from '@playwright/test';
import { test, expect, Api } from '../support/fixtures';
import { uid } from '../support/env';
import { confirmDialog, expectToast, fillDialog, matSelect, waitForApi } from '../support/ui';

/** Seeded Adyar (store 4) has a camera OFFLINE → a CAMERA_OFFLINE rule with threshold 0 fires deterministically. */
async function createOfflineRule(admin: Api, name: string) {
  return admin.post('/api/alert-rules', { name, storeId: 4, metric: 'CAMERA_OFFLINE', threshold: 0, severity: 'CRITICAL', channels: ['IN_APP'], cooldownMin: 600, isActive: true });
}
async function alertOf(admin: Api, ruleId: number) {
  const items = (await admin.get('/api/alerts', { storeIds: '4', pageSize: 500 })).items.filter((a: any) => a.ruleId === ruleId);
  expect(items).toHaveLength(1);
  return items[0];
}
async function openAlerts(page: Page, status: 'All' | 'Open' | 'Acknowledged' | 'Resolved' = 'Open') {
  await page.goto('/alerts');
  await expect(page.getByTestId('table-alerts')).toBeVisible();
  if (status !== 'Open') await matSelect(page, 'filter-alert-status', status);
}

test.describe('Alerts', () => {
  test('list filters by status, severity and store', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    const rows = page.getByTestId('table-alerts').locator('[data-testid^="row-alert-"]');
    // compare with the response the UI itself received (other workers may raise alerts concurrently)
    const alertsResp = (pred: (u: URL) => boolean) => waitForApi(page, '/api/alerts', pred).then((r) => r.json());

    const open = alertsResp((u) => u.searchParams.get('status') === 'OPEN');
    await openAlerts(page);
    const openRes = await open;
    await expect(rows.first()).toBeVisible();
    await expect(page.getByTestId('paginator-alerts')).toContainText(`of ${openRes.total}`);
    // default filter = Open
    for (const v of await rows.getByTestId('chip-status').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))) expect(v).toBe('OPEN');
    expect((await admin.get('/api/alerts', { status: 'OPEN', pageSize: 500 })).items.every((a: any) => a.status === 'OPEN')).toBe(true);

    await matSelect(page, 'filter-alert-status', 'All');
    const high = alertsResp((u) => u.searchParams.get('severity') === 'HIGH' && !u.searchParams.has('status'));
    await matSelect(page, 'filter-alert-severity', 'High');
    const highRes = await high;
    expect(highRes.total).toBeGreaterThan(0);
    expect(highRes.items.every((a: any) => a.severity === 'HIGH')).toBe(true);
    await expect(page.getByTestId('paginator-alerts')).toContainText(`of ${highRes.total}`);
    await expect(rows.first()).toBeVisible();
    for (const v of await rows.getByTestId('chip-severity').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))) expect(v).toBe('HIGH');

    await matSelect(page, 'filter-alert-severity', 'All');
    const anna = alertsResp((u) => u.searchParams.get('storeIds') === '2' && !u.searchParams.has('severity'));
    await matSelect(page, 'filter-alert-store', 'Congruence Anna Nagar');
    const annaRes = await anna;
    await expect(page.getByTestId('paginator-alerts')).toContainText(`of ${annaRes.total}`);
    await expect(rows.first()).toBeVisible();
    const texts = await rows.evaluateAll((els) => els.map((e) => (e.children[2] as HTMLElement).innerText.trim()));
    expect(texts.length).toBe(Math.min(25, annaRes.total));
    for (const t of texts) expect(t).toBe('Congruence Anna Nagar');

    const resolved = alertsResp((u) => u.searchParams.get('status') === 'RESOLVED');
    await matSelect(page, 'filter-alert-status', 'Resolved');
    const resolvedRes = await resolved;
    if (resolvedRes.total) {
      await expect(rows).toHaveCount(Math.min(25, resolvedRes.total));
      for (const v of await rows.getByTestId('chip-status').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))) expect(v).toBe('RESOLVED');
      await expect(rows.first().getByTestId('btn-resolve')).toHaveCount(0);
    } else {
      await expect(page.getByTestId('empty-state')).toBeVisible();
    }
  });

  test('evaluate → acknowledge → resolve an alert', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const rule = await createOfflineRule(admin, `E2E offline ${uid()}`);
    const page = await pageAs('admin');
    await openAlerts(page);
    await page.getByTestId('btn-evaluate-alerts').click();
    await expectToast(page, /new alert\(s\)/);
    const alert = await alertOf(admin, rule.id);
    expect(alert).toMatchObject({ metric: 'CAMERA_OFFLINE', severity: 'CRITICAL', status: 'OPEN', storeName: 'Congruence Adyar' });
    expect(alert.message).toMatch(/camera\(s\) offline at Congruence Adyar/);

    const row = page.getByTestId(`row-alert-${alert.id}`);
    await expect(row).toBeVisible();
    await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'OPEN');
    await expect(row.getByTestId('chip-severity')).toHaveAttribute('data-value', 'CRITICAL');
    await expect(row).toContainText(rule.name);

    await row.getByTestId('btn-ack').click();
    await expectToast(page, 'Alert acknowledged');
    // default filter is Open → the acknowledged alert leaves the list
    await expect(row).toHaveCount(0);
    await matSelect(page, 'filter-alert-status', 'Acknowledged');
    await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'ACKNOWLEDGED');
    await expect(row).toContainText(`by ${(await admin.get('/api/auth/me')).name}`);
    await expect(row.getByTestId('btn-ack')).toHaveCount(0);
    const acked = await alertOf(admin, rule.id);
    expect(acked.status).toBe('ACKNOWLEDGED');
    expect(acked.acknowledgedAt).toBeTruthy();

    await row.getByTestId('btn-resolve').click();
    await expectToast(page, 'Alert resolved');
    await expect(row).toHaveCount(0);
    await matSelect(page, 'filter-alert-status', 'Resolved');
    await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'RESOLVED');
    await expect(row.getByTestId('btn-resolve')).toHaveCount(0);
    const res = await alertOf(admin, rule.id);
    expect(res.status).toBe('RESOLVED');
    expect(res.resolvedAt).toBeTruthy();

    // cooldown: evaluating again does not raise a second alert for the rule
    await admin.post('/api/alerts/evaluate');
    await alertOf(admin, rule.id);
    await admin.delete(`/api/alert-rules/${rule.id}`);
  });

  test('create a ticket from an alert → ticket page shows the linkage', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const rule = await createOfflineRule(admin, `E2E ticket ${uid()}`);
    await admin.post('/api/alerts/evaluate');
    const alert = await alertOf(admin, rule.id);
    const page = await pageAs('manager');
    // the store manager of T Nagar must not see an Adyar alert
    await openAlerts(page, 'All');
    await expect(page.getByTestId(`row-alert-${alert.id}`)).toHaveCount(0);

    const adminPage = await pageAs('admin');
    await openAlerts(adminPage);
    const row = adminPage.getByTestId(`row-alert-${alert.id}`);
    await row.getByTestId('btn-create-ticket').click();
    await expect(adminPage.locator('mat-dialog-container')).toContainText(`Raise a ticket for "${rule.name}" at Congruence Adyar?`);
    await confirmDialog(adminPage);
    await expectToast(adminPage, /Ticket TKT-\d{5} created/);
    // raising a ticket acknowledges the alert → it leaves the default "Open" list
    await expect(row).toHaveCount(0);
    await matSelect(adminPage, 'filter-alert-status', 'Acknowledged');
    await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'ACKNOWLEDGED');
    await expect(row.getByTestId('link-ticket')).toBeVisible();
    await expect(row.getByTestId('btn-create-ticket')).toHaveCount(0);

    const linked = await alertOf(admin, rule.id);
    expect(linked.ticketId).toBeGreaterThan(0);
    const ticket = await admin.get(`/api/tickets/${linked.ticketId}`);
    expect(ticket).toMatchObject({ alertId: alert.id, storeId: 4, status: 'OPEN', category: 'CAMERA' });

    await row.getByTestId('link-ticket').click();
    await expect(adminPage).toHaveURL(new RegExp(`/tickets/${linked.ticketId}$`));
    await expect(adminPage.getByTestId('page-ticket-detail')).toContainText(`Raised from alert #${alert.id}`);
    await expect(adminPage.getByTestId('page-title')).toContainText(ticket.number);
    await expect(adminPage.getByTestId('ticket-status')).toHaveAttribute('data-value', 'OPEN');
    expect(ticket.description).toContain(`Created from alert #${alert.id}`);
    expect(ticket.priority).toBe('URGENT'); // CRITICAL alert → URGENT ticket
    // asking again returns the same ticket instead of creating a duplicate
    const again = await admin.post(`/api/alerts/${alert.id}/ticket`);
    expect(again.id).toBe(linked.ticketId);
    await admin.delete(`/api/alert-rules/${rule.id}`);
  });

  test('notification for an alert opens the alerts page', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const rule = await createOfflineRule(admin, `E2E notif ${uid()}`);
    await admin.post('/api/alerts/evaluate');
    const alert = await alertOf(admin, rule.id);
    const notes = await admin.get('/api/notifications');
    const note = notes.find((n: any) => n.link === `/alerts/${alert.id}`);
    expect(note).toBeTruthy();
    const page = await pageAs('admin');
    await page.goto('/dashboard');
    await page.getByTestId('notif-bell').click();
    await page.getByTestId(`notif-item-${note.id}`).click();
    await expect(page.getByTestId('page-alerts')).toBeVisible();
    await expect(page.getByTestId('page-not-found')).toHaveCount(0);
    await expect.poll(async () => (await admin.get('/api/notifications')).find((n: any) => n.id === note.id).isRead).toBe(true);
    await admin.delete(`/api/alert-rules/${rule.id}`);
  });

  test('alert rule CRUD in admin', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    const name = `E2E rule ${uid()}`;
    await page.goto('/admin/alert-rules');
    await page.getByTestId('btn-create-alert-rule').click();
    const dlg = page.getByTestId('dialog-alert-rule');
    await fillDialog(page, dlg, {
      name,
      storeId: { option: 'Congruence T Nagar' },
      metric: { option: 'Queue wait' },
      threshold: 240,
      severity: { option: 'High' },
      cooldownMin: 15,
    });
    // EMAIL channel reveals the emails field
    await expect(dlg.getByTestId('input-emails')).toHaveCount(0);
    await fillDialog(page, dlg, { channels: { options: ['Email'] } });
    await fillDialog(page, dlg, { emails: 'ops@congruence.in' });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Created');

    const created = (await admin.get('/api/alert-rules')).find((r: any) => r.name === name);
    expect(created).toMatchObject({ storeId: 1, metric: 'QUEUE_WAIT', threshold: 240, severity: 'HIGH', cooldownMin: 15, isActive: true, emails: 'ops@congruence.in' });
    expect([...created.channels].sort()).toEqual(['EMAIL', 'IN_APP']);
    const row = page.getByTestId(`row-alert-rule-${created.id}`);
    await page.getByTestId('input-search').fill(name);
    await expect(row).toContainText('240 seconds of wait');
    await expect(row).toContainText('Congruence T Nagar');

    // edit
    await row.getByTestId('btn-edit').click();
    await fillDialog(page, page.getByTestId('dialog-alert-rule'), { threshold: 300, severity: { option: 'Critical' }, isActive: false });
    await page.getByTestId('dialog-alert-rule').getByTestId('btn-save').click();
    await expectToast(page, 'Saved');
    await expect(row).toContainText('300 seconds of wait');
    await expect(row.locator('[data-value="CRITICAL"]')).toBeVisible();
    const edited = (await admin.get('/api/alert-rules')).find((r: any) => r.id === created.id);
    expect(edited).toMatchObject({ threshold: 300, severity: 'CRITICAL', isActive: false });

    // delete
    await row.getByTestId('btn-delete').click();
    await confirmDialog(page);
    await expect(row).toHaveCount(0);
    expect((await admin.get('/api/alert-rules')).some((r: any) => r.id === created.id)).toBe(false);
  });

  test('v2 metrics in the rule editor (checklist overdue / non-compliance, AI Manager breach, edge offline) with auto-ticket: EDGE_OFFLINE → NETWORK ticket, CAMERA_OFFLINE → CAMERA ticket', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const page = await pageAs('admin');
    await page.goto('/admin/alert-rules');
    const made: any[] = [];
    for (const [metric, label, threshold, store] of [
      ['CHECKLIST_OVERDUE', /^Checklist overdue$/i, 1, 'Congruence T Nagar'],
      ['CHECKLIST_NON_COMPLIANCE', /^Checklist non.compliance$/i, 2, 'Congruence T Nagar'],
      ['AI_MANAGER_BREACH', /^AI manager breach$/i, 3, 'Congruence T Nagar'],
      ['EDGE_OFFLINE', /^Edge offline$/i, 0, 'Congruence Adyar'],
      ['CAMERA_OFFLINE', /^Camera offline$/i, 0, 'Congruence Adyar'],
    ] as const) {
      const name = `E2E ${metric} ${uid()}`;
      await page.getByTestId('btn-create-alert-rule').click();
      const dlg = page.getByTestId('dialog-alert-rule');
      await fillDialog(page, dlg, { name, storeId: { option: store }, metric: { option: label }, threshold, severity: { option: 'High' }, cooldownMin: 600 });
      if (metric === 'EDGE_OFFLINE' || metric === 'CAMERA_OFFLINE') await fillDialog(page, dlg, { autoTicket: true });
      await dlg.getByTestId('btn-save').click();
      await expect(dlg).toBeHidden();
      await expectToast(page, 'Created');
      const r = (await admin.get('/api/alert-rules')).find((x: any) => x.name === name);
      expect(r).toMatchObject({ metric, threshold, severity: 'HIGH', autoTicket: metric === 'EDGE_OFFLINE' || metric === 'CAMERA_OFFLINE' });
      made.push(r);
    }
    // evaluate from the alerts page: Adyar's edge box and one camera are offline (seed) → two alerts, each with its own ticket
    await page.goto('/alerts');
    const ev = page.waitForResponse((r) => r.url().endsWith('/api/alerts/evaluate'));
    await page.getByTestId('btn-evaluate-alerts').click();
    expect((await ev).ok()).toBe(true);
    for (const [rule, category] of [[made[3], 'NETWORK'], [made[4], 'CAMERA']] as const) {
      const alert = await alertOf(admin, rule.id);
      expect(alert.ticketId, `${rule.metric} auto ticket`).toBeTruthy();
      const t = await admin.get(`/api/tickets/${alert.ticketId}`);
      expect(t).toMatchObject({ category, storeId: 4, alertId: alert.id, status: 'OPEN' });
      expect(t.title).toContain(rule.name);
      // the alert row links to the ticket instead of offering "create ticket"
      const row = page.getByTestId(`row-alert-${alert.id}`);
      await expect(row.getByTestId('link-ticket')).toBeVisible();
      await expect(row.getByTestId('btn-create-ticket')).toHaveCount(0);
    }
    // a second evaluation within the cooldown neither duplicates the alert nor the ticket
    await admin.post('/api/alerts/evaluate');
    await alertOf(admin, made[3].id);
    for (const r of made) await admin.delete(`/api/alert-rules/${r.id}`);
  });
});
