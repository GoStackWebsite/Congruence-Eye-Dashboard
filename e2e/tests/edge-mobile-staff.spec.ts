/**
 * Mobile staff journey on a phone (390×844, touch) — docs/qa/UI_EDGE_CASE_PLAN.md · Q1.
 * Sign in → bottom tab "Checklists" (My checklists) → fill every question type (yes/no, single, multi, text, number,
 * rating, photo with an AI check, video) → save draft → leave and resume (draft restored) → submit → open the
 * follow-up task and complete it with a proof photo. No horizontal scrolling at any step.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { PASSWORD, USERS, WEB_URL, media, todayLocal, uid } from '../support/env';
import { expectNoOverflow, settle } from '../support/qa';
import { fillGo } from '../support/ui';

async function go(page: Page, qid: number) {
  await fillGo(page, qid);
}

test('staff on a phone: login → My checklists → all question types incl. photo + AI check → draft → resume → submit → task proof', async ({ browser, api }) => {
  test.setTimeout(240_000);
  const admin = await api('admin');
  const staffApi = await api('staff');
  const me = await staffApi.get('/api/auth/me');
  const tpl = await admin.post('/api/checklists/templates', {
    name: `Phone journey ${uid()}`, description: 'Morning walk-through', category: 'OPENING', frequency: 'DAILY', isActive: true,
    questions: [
      { section: 'Entrance', text: 'Shutter fully open?', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 },
      { section: 'Entrance', text: 'Music', type: 'MCQ_SINGLE', options: ['Regular', 'Festive'], correctOptions: ['Festive'], required: true, weight: 1, requiresPhoto: false, sortOrder: 1 },
      { section: 'Floor', text: 'Displays refilled', type: 'MCQ_MULTI', options: ['Sarees', 'Kurtas', 'Kids'], required: true, weight: 1, requiresPhoto: false, sortOrder: 2 },
      { section: 'Floor', text: 'Customers waiting at open', type: 'NUMBER', minValue: 0, maxValue: 50, required: true, weight: 1, requiresPhoto: false, sortOrder: 3 },
      { section: 'Floor', text: 'Floor cleanliness', type: 'RATING', required: true, weight: 1, requiresPhoto: false, sortOrder: 4 },
      { section: 'Team', text: 'Staff in uniform (photo)', type: 'PHOTO', aiCheck: 'UNIFORM', required: true, weight: 2, requiresPhoto: true, sortOrder: 5 },
      { section: 'Team', text: 'Huddle clip', type: 'VIDEO', required: false, weight: 0, requiresPhoto: false, sortOrder: 6 },
      { section: 'Team', text: 'Notes', type: 'TEXT', required: false, weight: 0, requiresPhoto: false, sortOrder: 7 },
    ],
  });
  const q = [...tpl.questions].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
  const a = await admin.post('/api/checklists/assignments', { templateId: tpl.id, storeId: 1, assigneeId: me.id, dueDate: todayLocal() });
  const taskTitle = `Phone task ${uid()}`;
  const task = await admin.post('/api/tasks', { title: taskTitle, storeId: 1, type: 'GENERAL', priority: 'HIGH', assigneeId: me.id });

  const ctx = await browser.newContext({ baseURL: WEB_URL, viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, timezoneId: 'Asia/Kolkata', locale: 'en-IN', serviceWorkers: 'block' });
  const page = await ctx.newPage();

  await test.step('login and open My checklists from the bottom tabs', async () => {
    await page.goto('/login');
    await page.getByTestId('input-email').fill(USERS.staff);
    await page.getByTestId('input-password').fill(PASSWORD);
    await page.getByTestId('btn-login').tap();
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('tabbar')).toBeVisible();
    await expectNoOverflow(page, 'tasks');
    await page.getByTestId('tab-checklists').tap();
    await settle(page, 'page-checklist-assignments');
    await expectNoOverflow(page, 'my checklists');
    await page.getByTestId('input-table-search').first().fill(tpl.name.slice(0, 20)).catch(() => undefined);
    const open = page.locator(`a[href="/checklists/fill/${a.id}"]`).first();
    await expect(open).toBeVisible();
    await open.tap();
    await settle(page, 'page-checklist-fill');
    await expectNoOverflow(page, 'fill');
  });

  await test.step('answer every type; photo with AI uniform check; video', async () => {
    await page.getByTestId(`input-answer-${q[0].id}`).getByTestId('answer-yes').tap();
    await go(page, q[1].id);
    await page.getByTestId(`input-answer-${q[1].id}`).getByRole('radio', { name: 'Festive' }).check();
    await go(page, q[2].id);
    await page.getByTestId(`input-answer-${q[2].id}`).getByRole('checkbox', { name: 'Sarees' }).check();
    await page.getByTestId(`input-answer-${q[2].id}`).getByRole('checkbox', { name: 'Kids' }).check();
    await go(page, q[3].id);
    await page.getByTestId(`input-answer-${q[3].id}`).fill('4');
    await go(page, q[4].id);
    await page.getByTestId(`input-answer-${q[4].id}`).getByTestId('rating-5').tap();
    await go(page, q[5].id);
    await expect(page.getByTestId(`input-photo-${q[5].id}`)).toHaveAttribute('capture', 'environment');
    const up = page.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
    await page.getByTestId(`input-photo-${q[5].id}`).setInputFiles(media('staff_uniform_ok.jpg'));
    expect((await up).status()).toBeLessThan(300);
    await expect(page.getByTestId(`photo-preview-${q[5].id}`)).toBeVisible();
    const check = page.waitForResponse((r) => r.url().endsWith('/api/checklists/ai-check'));
    await page.getByTestId(`btn-ai-check-${q[5].id}`).tap();
    const res = await (await check).json();
    expect(res.status).toBe('PASS');
    await expect(page.getByTestId(`ai-result-${q[5].id}`)).toHaveAttribute('data-status', 'PASS');
    await expectNoOverflow(page, 'photo + AI result');
    await go(page, q[6].id);
    const vup = page.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
    await page.getByTestId(`input-video-${q[6].id}`).setInputFiles(media('checklist_clip.mp4'));
    await vup;
    await expect(page.getByTestId(`video-preview-${q[6].id}`)).toBeVisible();
    await go(page, q[7].id);
    await page.getByTestId(`input-answer-${q[7].id}`).fill('All good — கடை திறந்தது');
  });

  await test.step('save draft, leave, resume with every answer restored', async () => {
    await page.getByTestId('btn-save-draft').tap();
    await expect(page.locator('mat-snack-bar-container')).toContainText('Draft saved');
    expect(((await admin.get(`/api/checklists/assignments/${a.id}`)).draftAnswers ?? []).length).toBe(8);
    await page.getByTestId('tab-tasks').tap();
    await expect(page).toHaveURL(/\/tasks$/); // nothing unsaved → no prompt
    await page.goto(`/checklists/fill/${a.id}`);
    await settle(page, 'page-checklist-fill');
    await expect(page.getByTestId('draft-banner')).toBeVisible();
    await go(page, q[3].id);
    await expect(page.getByTestId(`input-answer-${q[3].id}`)).toHaveValue('4');
    await go(page, q[7].id);
    await expect(page.getByTestId(`input-answer-${q[7].id}`)).toHaveValue('All good — கடை திறந்தது');
  });

  await test.step('submit → score', async () => {
    const nav = page.getByTestId('fill-nav-review');
    if (!(await nav.isVisible().catch(() => false))) await page.getByTestId('btn-fill-outline').tap();
    await nav.tap();
    const submit = page.getByTestId('btn-submit-checklist');
    await submit.scrollIntoViewIfNeeded();
    const box = (await submit.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(40);
    expect(box.x + box.width).toBeLessThanOrEqual(390);
    await submit.tap();
    await page.locator('mat-dialog-container').getByTestId('btn-confirm').tap();
    await expect(page.getByTestId('checklist-score-result')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('result-score-pct')).toHaveText('100.0%');
    expect((await admin.get(`/api/checklists/assignments/${a.id}`)).status).toBe('SUBMITTED');
  });

  await test.step('task: open, mark done with a proof photo', async () => {
    await page.getByTestId('tab-tasks').tap();
    await settle(page, 'page-tasks');
    const viewList = page.getByTestId('view-list');
    if (await viewList.isVisible().catch(() => false)) await viewList.tap();
    await page.getByTestId('input-search').fill(taskTitle);
    await page.getByTestId(`row-task-${task.id}`).locator('.ce-text-link').first().tap();
    await expect(page.getByTestId('drawer-task')).toBeVisible();
    await expectNoOverflow(page, 'task drawer');
    await page.getByTestId('btn-detail-done').tap();
    const done = page.getByTestId('dialog-complete-task');
    await expect(done).toBeVisible();
    const up = page.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
    await done.getByTestId('input-proof-file').setInputFiles(media('task_proof.jpg'));
    const proofUrl: string = (await (await up).json()).url;
    await expect(done.getByTestId('proof-preview')).toHaveAttribute('src', proofUrl);
    await done.getByTestId('input-remark').fill('Done from the phone');
    await page.getByTestId('btn-complete-task').tap();
    await expect.poll(async () => (await admin.get(`/api/tasks/${task.id}`)).status).toBe('DONE');
    expect(await admin.get(`/api/tasks/${task.id}`)).toMatchObject({ proofUrl, remark: 'Done from the phone' });
    await expectNoOverflow(page, 'tasks after completion');
  });
  await ctx.close();
});
