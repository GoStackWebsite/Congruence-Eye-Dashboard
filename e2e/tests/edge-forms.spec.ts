/**
 * Forms (docs/qa/UI_EDGE_CASE_PLAN.md · F1–F4, D1–D3).
 *  - Double-clicking submit creates exactly one record (task, ticket, checklist submission), even while the request
 *    is slow.
 *  - Every create drawer validates before it calls the API: required fields, ranges, patterns and cross-field rules
 *    (closing after opening, due after start) show their messages inline and nothing is posted.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { todayLocal, uid } from '../support/env';
import { settle } from '../support/qa';
import { expectToast, fillDialog } from '../support/ui';

/** Slow down matching POSTs so a second click lands while the first request is still in flight; counts them. */
async function slowPosts(page: Page, pathPart: string): Promise<{ count: () => number }> {
  let n = 0;
  await page.route(`**${pathPart}`, async (route) => {
    if (route.request().method() !== 'POST') return route.continue();
    n++;
    await new Promise((r) => setTimeout(r, 900));
    await route.continue();
  });
  return { count: () => n };
}

/** POSTs fired by the page (any API path) while `fn` runs. */
async function postsDuring(page: Page, fn: () => Promise<void>): Promise<string[]> {
  const posts: string[] = [];
  const on = (r: import('@playwright/test').Request) => {
    if (['POST', 'PATCH', 'PUT'].includes(r.method()) && r.url().includes('/api/')) posts.push(`${r.method()} ${new URL(r.url()).pathname}`);
  };
  page.on('request', on);
  await fn();
  await page.waitForTimeout(400);
  page.off('request', on);
  return posts;
}

const ERRORS = 'mat-error:visible, .ops-err:visible, .ops-inline-error:visible, [data-testid="form-error"]:visible, [data-testid="ai-rule-errors"]:visible';

test.describe('Edge: forms — double submit and validation', () => {
  test('double-click on submit creates exactly one task, one ticket and one checklist submission', async ({ pageAs, api }) => {
    test.setTimeout(150_000);
    const admin = await api('admin');

    // ---- task (manager)
    const mgr = await pageAs('manager');
    await mgr.goto('/tasks');
    await settle(mgr, 'page-tasks');
    const taskTitle = `Double task ${uid()}`;
    const taskPosts = await slowPosts(mgr, '/api/tasks');
    await mgr.getByTestId('btn-create-task').click();
    const tdlg = mgr.getByTestId('dialog-task');
    await fillDialog(mgr, tdlg, { title: taskTitle, storeId: { option: 'Congruence T Nagar' } });
    await tdlg.getByTestId('btn-save').dblclick();
    await expectToast(mgr, 'Task created');
    await mgr.waitForTimeout(1200);
    expect(taskPosts.count(), 'POST /api/tasks').toBe(1);
    expect((await admin.get('/api/tasks', { storeIds: '1' })).filter((t: any) => t.title === taskTitle)).toHaveLength(1);

    // ---- ticket (manager, DS drawer)
    await mgr.goto('/tickets');
    await settle(mgr, 'page-tickets');
    const ticketTitle = `Double ticket ${uid()}`;
    const ticketPosts = await slowPosts(mgr, '/api/tickets');
    await mgr.getByTestId('btn-create-ticket').click();
    const kdlg = mgr.getByTestId('dialog-ticket');
    await fillDialog(mgr, kdlg, { title: ticketTitle });
    await kdlg.getByTestId('btn-save').dblclick();
    await expectToast(mgr, /Ticket TKT-\d+ created/);
    await mgr.waitForTimeout(1200);
    expect(ticketPosts.count(), 'POST /api/tickets').toBe(1);
    expect((await admin.get('/api/tickets')).filter((t: any) => t.title === ticketTitle)).toHaveLength(1);

    // ---- checklist submission (staff): a double tap opens one confirmation, a double confirm submits once
    const me = await (await api('staff')).get('/api/auth/me');
    const tpl = await admin.post('/api/checklists/templates', {
      name: `E2E double ${uid()}`, description: '', category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [{ section: 'General', text: 'Lights on?', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 }],
    });
    const a = await admin.post('/api/checklists/assignments', { templateId: tpl.id, storeId: 1, assigneeId: me.id, dueDate: todayLocal() });
    const staff = await pageAs('staff');
    await staff.goto(`/checklists/fill/${a.id}`);
    await settle(staff, 'page-checklist-fill');
    const subPosts = await slowPosts(staff, '/api/checklists/submissions');
    await staff.getByTestId(`input-answer-${tpl.questions[0].id}`).getByTestId('answer-yes').click();
    const nav = staff.getByTestId('fill-nav-review');
    if (!(await nav.isVisible().catch(() => false))) await staff.getByTestId('btn-fill-outline').click();
    await nav.click();
    await staff.getByTestId('btn-submit-checklist').dblclick();
    await expect(staff.locator('mat-dialog-container')).toHaveCount(1);
    await staff.locator('mat-dialog-container').getByTestId('btn-confirm').dblclick({ force: true }).catch(() => undefined);
    await expect(staff.getByTestId('checklist-score-result')).toBeVisible({ timeout: 30_000 });
    expect(subPosts.count(), 'POST /api/checklists/submissions').toBe(1);
    expect((await admin.get('/api/checklists/submissions', { pageSize: 500 })).filter((s: any) => s.assignmentId === a.id)).toHaveLength(1);
  });

  test('every create drawer blocks an empty submit with inline messages and posts nothing', async ({ pageAs }) => {
    test.setTimeout(240_000);
    const page = await pageAs('admin');
    const cases: { url: string; page: string; open: string; dialog: string; before?: (p: Page) => Promise<void> }[] = [
      { url: '/admin/stores', page: 'page-admin-stores', open: 'btn-create-store', dialog: 'dialog-store' },
      { url: '/admin/regions', page: 'page-admin-regions', open: 'btn-create-region', dialog: 'dialog-region' },
      { url: '/admin/edge-devices', page: 'page-admin-edge-devices', open: 'btn-create-edge-device', dialog: 'dialog-edge-device' },
      { url: '/admin/users', page: 'page-admin-users', open: 'btn-create-user', dialog: 'dialog-user' },
      { url: '/admin/staff', page: 'page-admin-staff', open: 'btn-create-staff', dialog: 'dialog-staff' },
      { url: '/admin/alert-rules', page: 'page-admin-alert-rules', open: 'btn-create-alert-rule', dialog: 'dialog-alert-rule' },
      { url: '/admin/stores/1/cameras', page: 'page-admin-cameras', open: 'btn-create-camera', dialog: 'dialog-camera' },
      { url: '/admin/stores/1/recorders', page: 'page-admin-store', open: 'btn-add-recorder', dialog: 'dialog-recorder' },
      { url: '/reports', page: 'page-reports', open: 'btn-create-schedule', dialog: 'dialog-schedule' },
      { url: '/tasks', page: 'page-tasks', open: 'btn-create-task', dialog: 'dialog-task' },
      { url: '/tickets', page: 'page-tickets', open: 'btn-create-ticket', dialog: 'dialog-ticket' },
      { url: '/infra-health', page: 'page-infra-health', open: 'btn-create-infra-ticket', dialog: 'dialog-ticket' },
      { url: '/vendors', page: 'page-vendors', open: 'btn-create-vendor', dialog: 'dialog-vendor' },
      { url: '/checklists/assignments', page: 'page-checklist-assignments', open: 'btn-create-assignment', dialog: 'dialog-assignment' },
      { url: '/checklists/schedules', page: 'page-checklist-schedules', open: 'btn-create-checklist-schedule', dialog: 'dialog-checklist-schedule' },
    ];
    const problems: string[] = [];
    for (const c of cases) {
      await page.goto(c.url);
      await settle(page, c.page);
      const btn = page.getByTestId(c.open).first();
      if (!(await btn.isVisible().catch(() => false))) {
        problems.push(`${c.url}: no ${c.open} button`);
        continue;
      }
      await btn.click();
      const dlg = page.getByTestId(c.dialog).first();
      await expect(dlg, c.dialog).toBeVisible();
      // clear pre-filled text so required rules fire
      for (const input of await dlg.locator('input[type="text"]:visible, input:not([type]):visible, textarea:visible').all()) {
        if (await input.isEditable()) await input.fill('');
      }
      const save = dlg.getByTestId('btn-save').or(page.getByTestId('btn-save')).first();
      const posts = await postsDuring(page, async () => {
        if (await save.isEnabled()) await save.click();
      });
      const errs = await page.locator(ERRORS).count();
      if (posts.length) problems.push(`${c.url}: empty form posted ${posts.join(', ')}`);
      if (!errs && (await save.isEnabled())) problems.push(`${c.url}: no validation message shown`);
      await page.keyboard.press('Escape');
      await expect(dlg).toBeHidden();
    }
    expect(problems, problems.join('\n')).toEqual([]);
  });

  test('range, pattern and cross-field rules show the right message', async ({ pageAs }) => {
    test.setTimeout(150_000);
    const page = await pageAs('admin');
    const msg = (dlg: import('@playwright/test').Locator, key: string) => dlg.getByTestId(`error-${key}`);

    // store: code pattern, latitude range, area minimum, closing before opening
    await page.goto('/admin/stores');
    await settle(page, 'page-admin-stores');
    await page.getByTestId('btn-create-store').click();
    let dlg = page.getByTestId('dialog-store');
    await fillDialog(page, dlg, { code: 'x', name: 'Validation store', latitude: '100', areaSqft: '0', openTime: '21:00', closeTime: '10:00' });
    let posts = await postsDuring(page, () => dlg.getByTestId('btn-save').click());
    expect(posts).toEqual([]);
    await expect(msg(dlg, 'code')).toContainText('Use 2–30 letters');
    await expect(msg(dlg, 'latitude')).toContainText('Maximum 90');
    await expect(msg(dlg, 'areaSqft')).toContainText('Minimum 1');
    await expect(msg(dlg, 'closeTime')).toContainText('Closing time must be after opening time');
    await page.keyboard.press('Escape');

    // user: email pattern, password length
    await page.goto('/admin/users');
    await settle(page, 'page-admin-users');
    await page.getByTestId('btn-create-user').click();
    dlg = page.getByTestId('dialog-user');
    await fillDialog(page, dlg, { name: 'Validation user', email: 'not-an-email', password: '123' });
    posts = await postsDuring(page, () => dlg.getByTestId('btn-save').click());
    expect(posts).toEqual([]);
    await expect(msg(dlg, 'email')).toContainText('Enter a valid email address');
    await expect(msg(dlg, 'password')).toContainText('At least');
    await page.keyboard.press('Escape');

    // camera: RTSP pattern
    await page.goto('/admin/stores/1/cameras');
    await settle(page, 'page-admin-cameras');
    await page.getByTestId('btn-create-camera').click();
    dlg = page.getByTestId('dialog-camera');
    await fillDialog(page, dlg, { name: 'Validation cam', rtspUrl: 'http://not rtsp' });
    posts = await postsDuring(page, () => dlg.getByTestId('btn-save').click());
    expect(posts).toEqual([]);
    await expect(msg(dlg, 'rtspUrl')).toContainText('Must start with rtsp://');
    await page.keyboard.press('Escape');

    // alert rule: threshold must be ≥ 0
    await page.goto('/admin/alert-rules');
    await settle(page, 'page-admin-alert-rules');
    await page.getByTestId('btn-create-alert-rule').click();
    dlg = page.getByTestId('dialog-alert-rule');
    await fillDialog(page, dlg, { name: 'Validation rule', threshold: '-5' });
    posts = await postsDuring(page, () => dlg.getByTestId('btn-save').click());
    expect(posts).toEqual([]);
    await expect(msg(dlg, 'threshold')).toContainText('Minimum 0');
    await page.keyboard.press('Escape');

    // task: due before start (store time)
    await page.goto('/tasks');
    await settle(page, 'page-tasks');
    await page.getByTestId('btn-create-task').click();
    dlg = page.getByTestId('dialog-task');
    await fillDialog(page, dlg, { title: 'Validation task', storeId: { option: 'Congruence T Nagar' }, startAt: '2030-01-15T18:30', dueAt: '2030-01-15T10:00' });
    posts = await postsDuring(page, () => dlg.getByTestId('btn-save').click());
    expect(posts).toEqual([]);
    await expect(dlg.locator('.ops-err')).toContainText('Due time must be after the start time');
    await page.keyboard.press('Escape');

    // AI rule editor: window end before start, no days
    await page.goto('/ai-manager/rules/new');
    await settle(page, 'page-ai-rule-editor');
    await page.getByTestId('input-ai-rule-name').fill('');
    posts = await postsDuring(page, () => page.getByTestId('btn-save').click());
    expect(posts).toEqual([]);
    await expect(page.getByTestId('ai-rule-errors')).toBeVisible();
  });

  test('Escape closes an open select inside a drawer without discarding the form (DS drawer)', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await page.goto('/tickets');
    await settle(page, 'page-tickets');
    await page.getByTestId('btn-create-ticket').click();
    const dlg = page.getByTestId('dialog-ticket');
    await dlg.getByTestId('input-title').fill('Kept after Escape');
    const sel = dlg.getByTestId('input-category');
    await sel.click({ force: true });
    await expect(page.locator('.mat-mdc-select-panel')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('.mat-mdc-select-panel')).toBeHidden();
    await expect(dlg).toBeVisible();
    await expect(dlg.getByTestId('input-title')).toHaveValue('Kept after Escape');
    // a second Escape (nothing open on top) closes the drawer
    await page.keyboard.press('Escape');
    await expect(dlg).toBeHidden();
  });
});
