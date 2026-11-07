import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { uid } from '../support/env';
import { expectToast, fillDialog, matSelect } from '../support/ui';

const H = 3600_000;

async function moveTo(page: Page, status: string) {
  await page.getByTestId('ticket-status-actions').getByTestId(`btn-status-${status}`).click();
  await expectToast(page, `Ticket moved to ${status.replace('_', ' ').toLowerCase()}`);
  await expect(page.getByTestId('ticket-status')).toHaveAttribute('data-value', status);
}
async function allowed(page: Page): Promise<string[]> {
  return page
    .getByTestId('ticket-status-actions')
    .locator('[data-testid^="btn-status-"]')
    .evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace('btn-status-', '')).sort());
}

test.describe('Tickets', () => {
  test('staff creates a ticket, comment thread, manager runs OPEN → IN_PROGRESS → RESOLVED → CLOSED → REOPENED', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const title = `E2E ceiling leak ${uid()}`;

    // ---- STAFF creates (no assignee field for non-managers)
    const staff = await pageAs('staff');
    await staff.goto('/tickets');
    await staff.getByTestId('btn-create-ticket').click();
    const dlg = staff.getByTestId('dialog-ticket');
    await expect(dlg.getByTestId('input-assigneeId')).toHaveCount(0);
    await fillDialog(staff, dlg, {
      title,
      description: 'Water dripping above the trial rooms',
      storeId: { option: 'Congruence T Nagar' },
      category: { option: 'Maintenance' },
      priority: { option: 'High' },
    });
    await dlg.getByTestId('btn-save').click();
    await expectToast(staff, /Ticket TKT-\d{5} created/);
    const ticket = (await admin.get('/api/tickets', { storeIds: '1' })).find((t: any) => t.title === title);
    expect(ticket).toMatchObject({ status: 'OPEN', priority: 'HIGH', category: 'MAINTENANCE', storeId: 1, alertId: null, isSlaBreached: false });
    expect(ticket.number).toMatch(/^TKT-\d{5}$/);
    expect(new Date(ticket.slaDueAt).getTime() - new Date(ticket.createdAt).getTime()).toBe(24 * H);

    await staff.getByTestId('input-search').fill(title);
    const row = staff.getByTestId(`row-ticket-${ticket.id}`);
    await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'OPEN');
    await expect(row.getByTestId('chip-priority')).toHaveAttribute('data-value', 'HIGH');
    await row.click();
    await expect(staff).toHaveURL(new RegExp(`/tickets/${ticket.id}$`));
    await expect(staff.getByTestId('ticket-description')).toHaveText('Water dripping above the trial rooms');
    // reporter (not assignee, not manager) cannot change status or edit
    await expect(staff.getByTestId('ticket-status-actions')).toHaveCount(0);
    await expect(staff.getByTestId('btn-edit-ticket')).toHaveCount(0);
    expect((await (await api('staff')).ctx.patch(`/api/tickets/${ticket.id}/status`, { data: { status: 'CLOSED' } })).status()).toBe(403);

    // ---- comment thread
    await staff.getByTestId('input-comment').fill('Bucket placed under the leak');
    await staff.getByTestId('btn-add-comment').click();
    const comments = staff.getByTestId('ticket-comments').locator('[data-testid^="comment-"]');
    await expect(comments).toHaveCount(1);
    await expect(staff.getByTestId('input-comment')).toHaveValue('');

    const mgr = await pageAs('manager');
    await mgr.goto(`/tickets/${ticket.id}`);
    await expect(mgr.getByTestId('ticket-comments')).toContainText('Bucket placed under the leak');
    await mgr.getByTestId('input-comment').fill('Plumber booked for 4 pm');
    await mgr.getByTestId('btn-add-comment').click();
    await expect(mgr.getByTestId('ticket-comments').locator('[data-testid^="comment-"]')).toHaveCount(2);
    const full = await admin.get(`/api/tickets/${ticket.id}`);
    expect(full.comments.map((c: any) => c.body)).toEqual(['Bucket placed under the leak', 'Plumber booked for 4 pm']);
    expect(full.comments[0].userName).toBe((await (await api('staff')).get('/api/auth/me')).name);
    expect(full.comments[1].userName).toBe((await (await api('manager')).get('/api/auth/me')).name);
    await staff.reload();
    await expect(comments).toHaveCount(2);
    await expect(comments.nth(1)).toContainText('Plumber booked for 4 pm');

    // ---- manager assigns via edit, then runs the workflow
    await mgr.getByTestId('btn-edit-ticket').click();
    await fillDialog(mgr, mgr.getByTestId('dialog-ticket'), { assigneeId: { option: full.comments[1].userName } });
    await mgr.getByTestId('dialog-ticket').getByTestId('btn-save').click();
    await expectToast(mgr, 'Ticket updated');
    await expect(mgr.getByTestId('page-ticket-detail')).toContainText(full.comments[1].userName);

    expect(await allowed(mgr)).toEqual(['CLOSED', 'IN_PROGRESS', 'RESOLVED']);
    await moveTo(mgr, 'IN_PROGRESS');
    expect(await allowed(mgr)).toEqual(['OPEN', 'RESOLVED']);
    await moveTo(mgr, 'RESOLVED');
    let t = await admin.get(`/api/tickets/${ticket.id}`);
    expect(t.status).toBe('RESOLVED');
    expect(t.resolvedAt).toBeTruthy();
    await expect(mgr.getByTestId('page-ticket-detail')).toContainText('Resolved');
    expect(await allowed(mgr)).toEqual(['CLOSED', 'REOPENED']);
    await moveTo(mgr, 'CLOSED');
    expect(await allowed(mgr)).toEqual(['REOPENED']);
    await moveTo(mgr, 'REOPENED');
    t = await admin.get(`/api/tickets/${ticket.id}`);
    expect(t.status).toBe('REOPENED');
    expect(t.resolvedAt).toBeNull();
    expect(await allowed(mgr)).toEqual(['IN_PROGRESS', 'RESOLVED']);

    // list filter by status finds it
    await mgr.goto('/tickets');
    await matSelect(mgr, 'filter-ticket-status', 'Reopened');
    await expect(mgr.getByTestId(`row-ticket-${ticket.id}`)).toBeVisible();
    // the row was already listed before filtering → wait for the filtered result
    await expect
      .poll(async () => new Set(await mgr.getByTestId('table-tickets').getByTestId('chip-status').evaluateAll((els) => els.map((e) => e.getAttribute('data-value')))))
      .toEqual(new Set(['REOPENED']));
  });

  test('URGENT tickets get a 4 h SLA and show the breached indicator once it passes', async ({ pageAs, api }) => {
    const manager = await api('manager');
    const title = `E2E urgent POS down ${uid()}`;
    const t = await manager.post('/api/tickets', { title, description: 'Billing counter 2 POS terminal down', storeId: 1, category: 'INFRASTRUCTURE', priority: 'URGENT' });
    expect(new Date(t.slaDueAt).getTime() - new Date(t.createdAt).getTime()).toBe(4 * H);
    expect(t.isSlaBreached).toBe(false);

    const page = await pageAs('manager');
    await page.goto('/tickets');
    await page.getByTestId('input-search').fill(title);
    const row = page.getByTestId(`row-ticket-${t.id}`);
    await expect(row.getByTestId('chip-priority')).toHaveAttribute('data-value', 'URGENT');
    await expect(row.getByTestId('sla-breached')).toHaveCount(0);

    // five hours later (browser clock) the open URGENT ticket is past its SLA
    const ctx = page.context();
    const later = await ctx.newPage();
    await later.clock.install({ time: new Date(Date.now() + 5 * H) });
    await later.goto('/tickets');
    await later.getByTestId('input-search').fill(title);
    await expect(later.getByTestId(`row-ticket-${t.id}`).getByTestId('sla-breached')).toBeVisible();
    await later.getByTestId(`row-ticket-${t.id}`).click();
    await expect(later.getByTestId('sla-breached')).toBeVisible();
    await later.close();

    // seeded tickets the API reports as breached are flagged in the list
    const all = await manager.get('/api/tickets');
    const breached = all.filter((x: any) => x.isSlaBreached);
    expect(breached.length).toBeGreaterThan(0);
    await page.getByTestId('input-search').fill('');
    for (const b of breached.slice(0, 3)) await expect(page.getByTestId(`row-ticket-${b.id}`).getByTestId('sla-breached')).toBeVisible();
    // and a resolved-in-time ticket is not
    const ok = all.find((x: any) => !x.isSlaBreached && ['RESOLVED', 'CLOSED'].includes(x.status));
    if (ok) await expect(page.getByTestId(`row-ticket-${ok.id}`).getByTestId('sla-breached')).toHaveCount(0);
  });
});
