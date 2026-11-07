import { test, expect } from '../support/fixtures';
import { media, uid } from '../support/env';
import { cdkDragTo, expectToast, fillDialog, matSelect } from '../support/ui';

test.describe('Tasks', () => {
  test('manager creates → staff drags TODO → IN_PROGRESS → DONE on the kanban → manager verifies', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const staffUser = await (await api('staff')).get('/api/auth/me');
    const title = `E2E restock ${uid()}`;

    // ---- manager creates the task
    const mgr = await pageAs('manager');
    await mgr.goto('/tasks');
    await mgr.getByTestId('btn-create-task').click();
    const dlg = mgr.getByTestId('dialog-task');
    await fillDialog(mgr, dlg, {
      title,
      description: 'Refill the sarees display before the evening peak',
      storeId: { option: 'Congruence T Nagar' },
      type: { option: 'Zone allocation' },
    });
    // ZONE_ALLOCATION reveals the zone picker with T Nagar's section/queue zones
    await fillDialog(mgr, dlg, { zoneId: { option: /^[^—]/ } });
    await fillDialog(mgr, dlg, {
      priority: { option: 'High' },
      assigneeId: { option: staffUser.name },
      dueAt: '2030-01-15T18:30',
    });
    await dlg.getByTestId('btn-save').click();
    await expectToast(mgr, 'Task created');
    const task = (await admin.get('/api/tasks', { storeIds: '1' })).find((t: any) => t.title === title);
    expect(task).toMatchObject({ storeId: 1, type: 'ZONE_ALLOCATION', priority: 'HIGH', status: 'TODO', assigneeId: staffUser.id });
    expect(task.zoneId).toBeGreaterThan(0);
    expect(task.createdByName).toBe((await (await api('manager')).get('/api/auth/me')).name);
    expect(new Date(task.dueAt).toISOString()).toBe('2030-01-15T13:00:00.000Z'); // 18:30 IST

    // ---- staff moves it on the board with real drag & drop
    const staff = await pageAs('staff');
    await staff.goto('/tasks');
    await staff.getByTestId('view-board').click();
    const card = staff.getByTestId(`task-card-${task.id}`);
    await expect(staff.getByTestId('task-column-TODO').getByTestId(`task-card-${task.id}`)).toBeVisible();
    await expect(card.getByTestId('chip-priority')).toHaveAttribute('data-value', 'HIGH');

    await cdkDragTo(staff, card, staff.getByTestId('task-column-IN_PROGRESS').locator('.kanban-list'));
    await expect(staff.getByTestId('task-column-IN_PROGRESS').getByTestId(`task-card-${task.id}`)).toBeVisible();
    await expect.poll(async () => (await admin.get(`/api/tasks/${task.id}`)).status).toBe('IN_PROGRESS');

    // moving to DONE asks for completion proof (photo) and a remark
    await cdkDragTo(staff, card, staff.getByTestId('task-column-DONE').locator('.kanban-list'));
    const done = staff.getByTestId('dialog-complete-task');
    await expect(done).toBeVisible();
    const upload = staff.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
    await done.getByTestId('input-proof-file').setInputFiles(media('task_proof.jpg'));
    const proofUrl: string = (await (await upload).json()).url;
    expect(proofUrl).toMatch(/^\/uploads\//);
    await expect(done.getByTestId('proof-preview')).toHaveAttribute('src', proofUrl);
    // the uploaded proof image really loads
    await expect.poll(() => done.getByTestId('proof-preview').evaluate((img: HTMLImageElement) => img.complete && img.naturalWidth)).toBeGreaterThan(0);
    await done.getByTestId('input-remark').fill('Sarees display refilled');
    await staff.getByTestId('btn-complete-task').click();
    await expect(done).toBeHidden();
    await expect(staff.getByTestId('task-column-DONE').getByTestId(`task-card-${task.id}`)).toBeVisible();
    await expect.poll(async () => (await admin.get(`/api/tasks/${task.id}`)).status).toBe('DONE');
    const doneTask = await admin.get(`/api/tasks/${task.id}`);
    expect(doneTask).toMatchObject({ proofUrl, remark: 'Sarees display refilled' });
    expect(doneTask.completedAt).toBeTruthy();
    await expect(staff.getByTestId(`task-card-${task.id}`).getByTestId('task-proof')).toContainText('Sarees display refilled');
    expect((await staff.request.get(proofUrl)).status()).toBe(200);

    // staff cannot verify: dropping on VERIFIED is refused
    await cdkDragTo(staff, card, staff.getByTestId('task-column-VERIFIED').locator('.kanban-list'));
    await expectToast(staff, 'Only DONE tasks can be verified, by a manager');
    await expect(staff.getByTestId('task-column-DONE').getByTestId(`task-card-${task.id}`)).toBeVisible();
    const denied = await (await api('staff')).ctx.patch(`/api/tasks/${task.id}/verify`);
    expect(denied.status()).toBe(403);

    // ---- manager verifies
    await mgr.reload();
    await mgr.getByTestId('view-board').click();
    const mcard = mgr.getByTestId('task-column-DONE').getByTestId(`task-card-${task.id}`);
    await expect(mcard).toBeVisible();
    await mcard.getByTestId('btn-task-menu').click();
    await mgr.getByTestId('btn-verify-task').click();
    await expectToast(mgr, 'Task verified');
    await expect(mgr.getByTestId('task-column-VERIFIED').getByTestId(`task-card-${task.id}`)).toBeVisible();
    const verified = await admin.get(`/api/tasks/${task.id}`);
    expect(verified.status).toBe('VERIFIED');
    expect(verified.verifiedAt).toBeTruthy();

    await admin.delete(`/api/tasks/${task.id}`);
  });

  test('list view status control, staff scoping and delete', async ({ pageAs, api }) => {
    const manager = await api('manager');
    const staffUser = await (await api('staff')).get('/api/auth/me');
    const title = `E2E list task ${uid()}`;
    const t = await manager.post('/api/tasks', { title, storeId: 1, type: 'GENERAL', priority: 'LOW', assigneeId: staffUser.id });
    const other = await manager.post('/api/tasks', { title: `${title} unassigned`, storeId: 1, type: 'GENERAL', priority: 'LOW' });

    const staff = await pageAs('staff');
    await staff.goto('/tasks');
    await expect(staff.getByTestId('page-title')).toHaveText('My tasks');
    await expect(staff.getByTestId('btn-create-task')).toHaveCount(0);
    await staff.getByTestId('view-list').click();
    const row = staff.getByTestId(`row-task-${t.id}`);
    await expect(row).toBeVisible();
    await expect(staff.getByTestId(`row-task-${other.id}`)).toHaveCount(0); // not assigned to staff
    await matSelect(staff, row.getByTestId('select-task-status'), 'In progress');
    await expect.poll(async () => (await manager.get(`/api/tasks/${t.id}`)).status).toBe('IN_PROGRESS');
    // choosing Done opens the completion dialog; cancelling reverts the status
    await matSelect(staff, row.getByTestId('select-task-status'), 'Done');
    await expect(staff.getByTestId('dialog-complete-task')).toBeVisible();
    await staff.locator('mat-dialog-container').getByTestId('btn-cancel').click();
    await expect(staff.getByTestId('dialog-complete-task')).toBeHidden();
    await expect(row.getByTestId('select-task-status')).toContainText('In progress');
    expect((await manager.get(`/api/tasks/${t.id}`)).status).toBe('IN_PROGRESS');
    // completing with a remark only (proof is optional)
    await matSelect(staff, row.getByTestId('select-task-status'), 'Done');
    await staff.getByTestId('input-remark').fill('Done without photo');
    await staff.getByTestId('btn-complete-task').click();
    await expect.poll(async () => (await manager.get(`/api/tasks/${t.id}`)).status).toBe('DONE');
    expect((await manager.get(`/api/tasks/${t.id}`))).toMatchObject({ remark: 'Done without photo', proofUrl: null });
    await expect(row.getByTestId('btn-verify-task')).toHaveCount(0);
    // the list view preference is remembered
    await staff.reload();
    await expect(staff.getByTestId('table-tasks')).toBeVisible();

    const mgr = await pageAs('manager');
    await mgr.goto('/tasks');
    await mgr.getByTestId('view-list').click();
    await mgr.getByTestId('input-search').fill(title);
    const mrow = mgr.getByTestId(`row-task-${t.id}`);
    await mrow.getByTestId('btn-verify-task').click();
    await expectToast(mgr, 'Task verified');
    await expect(mrow.getByTestId('select-task-status')).toContainText('Verified');
    await mgr.getByTestId(`row-task-${other.id}`).getByTestId('btn-delete').click();
    await mgr.locator('mat-dialog-container').getByTestId('btn-confirm').click();
    await expectToast(mgr, 'Task deleted');
    await expect(mgr.getByTestId(`row-task-${other.id}`)).toHaveCount(0);
    expect((await manager.ctx.get(`/api/tasks/${other.id}`)).status()).toBe(404);
  });

  test('bulk create across stores (assignee defaults to each store manager) and a future start hides the task from the assignee', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const title = `E2E bulk ${uid()}`;
    const page = await pageAs('regional');
    await page.goto('/tasks');
    await page.getByTestId('btn-bulk-tasks').click();
    const dlg = page.getByTestId('dialog-bulk-task');
    await fillDialog(page, dlg, {
      storeIds: { options: ['Congruence T Nagar', 'Congruence Anna Nagar', 'Congruence Adyar'] },
      title,
      description: 'Diwali window display across Chennai',
      type: { option: 'Visual merchandising' },
      priority: { option: 'Urgent' },
      startAt: '2030-01-10T09:00',
      dueAt: '2030-01-12T18:00',
    });
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, '3 task(s) created');

    const created = (await admin.get('/api/tasks')).filter((t: any) => t.title === title);
    expect(created.map((t: any) => t.storeId).sort()).toEqual([1, 2, 4]);
    const users = await admin.get('/api/users');
    for (const t of created) {
      expect(t).toMatchObject({ type: 'VISUAL_MERCHANDISING', priority: 'URGENT', status: 'TODO' });
      expect(new Date(t.startAt).toISOString()).toBe('2030-01-10T03:30:00.000Z');
      const assignee = users.find((u: any) => u.id === t.assigneeId);
      expect(assignee, `store ${t.storeId} manager`).toMatchObject({ role: 'STORE_MANAGER' });
      expect(assignee.storeIds).toContain(t.storeId);
    }
    // the cards are listed with their scheduled start
    await page.getByTestId('view-board').click();
    await page.getByTestId('input-search').fill(title);
    for (const t of created) await expect(page.getByTestId(`task-card-${t.id}`).getByTestId('task-starts')).toBeVisible();

    // the T Nagar manager (assignee) does not see it in "mine" until the start time, but sees it in the store list
    const tn = created.find((t: any) => t.storeId === 1);
    const mgr = await api('manager');
    expect((await mgr.get('/api/tasks', { mine: 'true' })).some((t: any) => t.id === tn.id)).toBe(false);
    expect((await mgr.get('/api/tasks', { storeIds: '1' })).some((t: any) => t.id === tn.id)).toBe(true);
    // the manager of another store never sees T Nagar's copy
    expect((await mgr.get('/api/tasks')).every((t: any) => t.storeId === 1)).toBe(true);
    for (const t of created) await admin.delete(`/api/tasks/${t.id}`);
  });
});
