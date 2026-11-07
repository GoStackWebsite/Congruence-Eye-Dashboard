/**
 * Trax v2 (X1–X7, A1, A2, P1): template builder with every question type incl. VIDEO and AI checks with a reference
 * image, smart schedules + generate, section-wise drafts (IN_PROGRESS) and resume, AI-check preview PASS / FAIL against
 * the real ai-service, submit + score + flags, auto task (createTaskOnFail), task from a flagged answer, review,
 * CHECKLIST_NON_COMPLIANCE alert, nudges (reminder + overdue notifications), compliance dashboard, tablet layout.
 *
 * Template built in the UI (weights in brackets) and the answers given by STAFF:
 *   Signage    Q0 YES_NO      [1] "Festive signage installed?"  (task on fail)  → NO                        → 0  flag
 *   Signage    Q1 PHOTO       [2] "Promo wall photo" REFERENCE_MATCH           → poster missing (AI FAIL)  → 0  flag
 *   Grooming   Q2 PHOTO       [2] "Staff grooming photo" UNIFORM              → teal uniform (AI PASS)    → 2
 *   Grooming   Q3 VIDEO       [1] "Store walk-through video"                  → 2 s mp4                   → 1
 *   Operations Q4 MCQ_MULTI   [1] "Which displays are lit?" A,B correct       → A + B                     → 1
 *   Operations Q5 MCQ_SINGLE  [1] "Music playlist" correct "Diwali"           → Regular (wrong)           → 0  flag
 *   Operations Q6 NUMBER      [1] "Chiller °C" 2..8                           → 5                         → 1
 *   Operations Q7 RATING      [5] "Window display quality"                    → 4 stars                   → 4
 *   Operations Q8 TEXT        [1] "Notes"                                     → text                      → 1
 *   max 15 → score 10 → 66.67 %, 3 flags
 */
import * as fs from 'fs';
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { WEB_URL, addDays, media, storageStatePath, todayLocal, uid } from '../support/env';
import { expectToast, fillDialog, fillGo, fmt, kpiText, matMultiSelect, matSelect, presetFilter, submitFill, waitForApi } from '../support/ui';
import { serveMp4AsWebm } from '../support/video';

const MAX = 15;
const SCORE = 10;
const PCT = Math.round((SCORE / MAX) * 10000) / 100;

/** HH:mm in Asia/Kolkata, offset by minutes from now. */
function istHm(offsetMin = 0): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(Date.now() + offsetMin * 60_000));
}

async function addQ(page: Page, type: string, i: number, v: { text: string; section: string; weight: number }) {
  if (i > 0) {
    await page.getByTestId('btn-add-question').click();
    await page.getByTestId(`btn-add-question-${type}`).click();
  }
  const q = page.getByTestId(`question-${i}`);
  await expect(q).toBeVisible();
  await q.getByTestId('input-question-text').fill(v.text);
  await q.getByTestId('input-question-section').fill(v.section);
  await q.getByTestId('input-question-weight').fill(String(v.weight));
  return q;
}

async function aiPreview(page: Page, qid: number, file: string) {
  await fillGo(page, qid);
  const up = page.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
  await page.getByTestId(`input-photo-${qid}`).setInputFiles(file);
  await up;
  await expect(page.getByTestId(`photo-preview-${qid}`)).toBeVisible();
  const check = page.waitForResponse((r) => r.url().endsWith('/api/checklists/ai-check'));
  await page.getByTestId(`btn-ai-check-${qid}`).click();
  const res = await (await check).json();
  const box = page.getByTestId(`ai-result-${qid}`);
  await expect(box).toHaveAttribute('data-status', res.status);
  return { res, box };
}

test.describe('Trax v2: AI-in-checklist, schedules, drafts, flags', () => {
  test.setTimeout(300_000);

  test('builder (all question types, VIDEO, AI checks + reference) → schedule → staff draft/resume → AI preview PASS/FAIL → submit → flags, auto task, task from answer, alert, review', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const staffUser = await (await api('staff')).get('/api/auth/me');
    const managerUser = await (await api('manager')).get('/api/auth/me');
    const name = `E2E Festive rollout ${uid()}`;
    const today = todayLocal();

    // ------------------------------------------------------------ template builder (regional manager)
    const builder = await pageAs('regional');
    let tpl: any;
    await test.step('build the template with every question type, AI checks and a reference image', async () => {
      await builder.goto('/checklists/templates/new');
      await builder.getByTestId('input-template-name').fill(name);
      await matSelect(builder, 'input-template-category', 'Visual merchandising');
      await matSelect(builder, 'input-template-frequency', 'Daily');
      const q0 = await addQ(builder, 'YES_NO', 0, { text: 'Festive signage installed?', section: 'Signage', weight: 1 });
      await q0.getByTestId('input-question-task-on-fail').locator('button[role=switch]').click();
      const q1 = await addQ(builder, 'PHOTO', 1, { text: 'Promo wall photo', section: 'Signage', weight: 2 });
      await matSelect(builder, q1.getByTestId('input-question-ai-check'), 'Reference match');
      // REFERENCE_MATCH without a reference image is refused
      await builder.getByTestId('btn-save-template').click();
      await expect(builder.getByTestId('template-errors')).toContainText(/reference/i);
      const up = builder.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
      await q1.getByTestId('input-question-reference').setInputFiles(media('shelf_reference.jpg'));
      await up;
      await expect(q1.getByTestId('question-reference-thumb')).toBeVisible();
      await expect.poll(() => q1.getByTestId('question-reference-thumb').evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(0);
      const q2 = await addQ(builder, 'PHOTO', 2, { text: 'Staff grooming photo', section: 'Grooming', weight: 2 });
      await matSelect(builder, q2.getByTestId('input-question-ai-check'), 'Uniform / grooming');
      const q3 = await addQ(builder, 'VIDEO', 3, { text: 'Store walk-through video', section: 'Grooming', weight: 1 });
      await expect(q3.getByTestId('input-question-ai-check')).toHaveCount(0); // AI checks are for photos only
      const q4 = await addQ(builder, 'MCQ_MULTI', 4, { text: 'Which displays are lit?', section: 'Operations', weight: 1 });
      await q4.getByTestId('input-question-options').fill('A, B, C');
      await q4.getByTestId('input-question-correct').getByRole('button', { name: 'Correct answer: A' }).click();
      await q4.getByTestId('input-question-correct').getByRole('button', { name: 'Correct answer: B' }).click();
      const q5 = await addQ(builder, 'MCQ_SINGLE', 5, { text: 'Music playlist', section: 'Operations', weight: 1 });
      await q5.getByTestId('input-question-options').fill('Diwali, Regular');
      await q5.getByTestId('input-question-correct').getByRole('button', { name: 'Correct answer: Diwali' }).click();
      const q6 = await addQ(builder, 'NUMBER', 6, { text: 'Chiller °C', section: 'Operations', weight: 1 });
      await q6.getByTestId('input-question-min').fill('2');
      await q6.getByTestId('input-question-max').fill('8');
      await addQ(builder, 'RATING', 7, { text: 'Window display quality', section: 'Operations', weight: 5 });
      await addQ(builder, 'TEXT', 8, { text: 'Notes', section: 'Operations', weight: 1 });
      await expect(builder.getByTestId('page-template-builder')).toContainText(`9 questions · max score ${MAX}`);
      await builder.getByTestId('btn-save').click();
      await expectToast(builder, 'Template saved');
      tpl = (await admin.get('/api/checklists/templates')).find((t: any) => t.name === name);
      tpl.questions.sort((a: any, b: any) => a.sortOrder - b.sortOrder);
      expect(tpl.questions.map((q: any) => q.type)).toEqual(['YES_NO', 'PHOTO', 'PHOTO', 'VIDEO', 'MCQ_MULTI', 'MCQ_SINGLE', 'NUMBER', 'RATING', 'TEXT']);
      expect(tpl.questions[0]).toMatchObject({ section: 'Signage', createTaskOnFail: true });
      expect(tpl.questions[1]).toMatchObject({ aiCheck: 'REFERENCE_MATCH', referenceImageUrl: expect.stringMatching(/^\/uploads\//) });
      expect(tpl.questions[2]).toMatchObject({ aiCheck: 'UNIFORM' });
      expect(tpl.questions[3]).toMatchObject({ type: 'VIDEO', aiCheck: 'NONE' });
      expect((await builder.request.get(tpl.questions[1].referenceImageUrl)).status()).toBe(200);
    });
    const [qYes, qRef, qUni, qVid, qMulti, qSingle, qNum, qRating, qText] = tpl.questions;

    // ------------------------------------------------------------ smart schedule (admin) → generate
    let assignment: any;
    await test.step('schedule for T Nagar assigned to staff, generate now (idempotent)', async () => {
      const page = await pageAs('admin');
      await page.goto('/checklists/schedules');
      await page.getByTestId('btn-create-checklist-schedule').click();
      const dlg = page.getByTestId('dialog-checklist-schedule');
      await matSelect(page, dlg.getByTestId('input-schedule-template'), name);
      await matMultiSelect(page, dlg.getByTestId('input-schedule-stores'), ['Congruence T Nagar']);
      await matSelect(page, dlg.getByTestId('input-schedule-assignee'), staffUser.name);
      await dlg.getByTestId('frequency-WEEKLY').click();
      await expect(dlg.getByTestId('input-schedule-days')).toBeVisible();
      await dlg.getByTestId('frequency-DAILY').click();
      await dlg.getByTestId('input-schedule-repeat').fill('1');
      await dlg.getByTestId('input-schedule-window-start').fill('00:05');
      await dlg.getByTestId('input-schedule-window-end').fill('23:55');
      await dlg.getByTestId('input-schedule-start').fill(today);
      // the end date sits behind "Set defined date range" (reference 06)
      await dlg.getByTestId('toggle-schedule-date-range').locator('button[role=switch]').click();
      await dlg.getByTestId('input-schedule-end').fill(addDays(today, 30));
      await dlg.getByTestId('input-schedule-reminder').fill('30');
      await expect(page.getByTestId('schedule-preview')).not.toBeEmpty();
      await dlg.getByTestId('btn-save').click();
      await expectToast(page, 'Schedule created');
      const sched = (await admin.get('/api/checklists/schedules')).find((s: any) => s.templateId === tpl.id);
      expect(sched).toMatchObject({ storeIds: [1], assigneeId: staffUser.id, frequency: 'DAILY', repeatEvery: 1, windowStart: '00:05', windowEnd: '23:55', startDate: today, endDate: addDays(today, 30), reminderMinutesBefore: 30, isActive: true });
      const row = page.getByTestId(`row-checklist-schedule-${sched.id}`);
      await row.getByTestId('btn-generate-schedule').click();
      await expectToast(page, '1 assignment(s) created for today');
      await row.getByTestId('btn-generate-schedule').click();
      await expectToast(page, '0 assignment(s) created for today');
      const list = (await admin.get('/api/checklists/assignments', { storeIds: '1' })).filter((a: any) => a.templateId === tpl.id);
      expect(list).toHaveLength(1);
      assignment = list[0];
      expect(assignment).toMatchObject({ assigneeId: staffUser.id, scheduleId: sched.id, status: 'PENDING', dueDate: today });
      expect(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Kolkata', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(assignment.dueAt))).toBe('23:55');
    });

    // ------------------------------------------------------------ staff: draft, resume, AI previews, video, submit
    const staff = await pageAs('staff');
    await serveMp4AsWebm(staff); // Playwright's Chromium cannot decode H.264 (see support/video.ts)
    const rule = await admin.post('/api/alert-rules', { name: `E2E non-compliance ${uid()}`, storeId: 1, metric: 'CHECKLIST_NON_COMPLIANCE', threshold: 2, severity: 'MEDIUM', channels: ['IN_APP'], cooldownMin: 1, isActive: true });
    await test.step('section-wise draft → IN_PROGRESS → resume after reload', async () => {
      await staff.goto('/checklists/assignments');
      const row = staff.getByTestId(`row-assignment-${assignment.id}`);
      await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'PENDING');
      await row.getByTestId('btn-fill').click();
      await expect(staff.getByTestId('page-checklist-fill')).toBeVisible();
      await staff.getByTestId(`input-answer-${qYes.id}`).getByTestId('answer-no').click();
      await aiPreview(staff, qRef.id, media('shelf_identical.jpg'));
      const save = staff.waitForResponse((r) => r.url().endsWith(`/api/checklists/assignments/${assignment.id}/draft`));
      await staff.getByTestId('btn-save-section-Signage').click();
      expect((await save).ok()).toBe(true);
      await expectToast(staff, 'Saved “Signage” as draft');
      const a = await admin.get(`/api/checklists/assignments/${assignment.id}`);
      expect(a.status).toBe('IN_PROGRESS');
      expect(a.draftAnswers.find((x: any) => x.questionId === qYes.id).value).toBe('NO');
      expect(a.draftAnswers.find((x: any) => x.questionId === qRef.id).photoUrl).toMatch(/^\/uploads\//);
      // resume
      await staff.reload();
      await expect(staff.getByTestId('draft-banner')).toBeVisible();
      await expect(staff.getByTestId(`input-answer-${qYes.id}`).getByTestId('answer-no')).toHaveClass(/checked/);
      await fillGo(staff, qRef.id);
      await expect(staff.getByTestId(`photo-preview-${qRef.id}`)).toBeVisible();
      await staff.goto('/checklists/assignments');
      await expect(staff.getByTestId(`row-assignment-${assignment.id}`).getByTestId('chip-status')).toHaveAttribute('data-value', 'IN_PROGRESS');
      await staff.getByTestId(`row-assignment-${assignment.id}`).getByTestId('btn-fill').click();
      await expect(staff.getByTestId('draft-banner')).toBeVisible();
    });

    await test.step('AI check preview: reference match PASS then FAIL (poster missing); uniform FAIL (wrong colour) then PASS', async () => {
      // the resumed photo is the identical shot → PASS with an annotated image
      await fillGo(staff, qRef.id);
      const check = staff.waitForResponse((r) => r.url().endsWith('/api/checklists/ai-check'));
      await staff.getByTestId(`btn-ai-check-${qRef.id}`).click();
      const pass = await (await check).json();
      expect(pass).toMatchObject({ status: 'PASS', issues: [] });
      const box = staff.getByTestId(`ai-result-${qRef.id}`);
      await expect(box).toHaveAttribute('data-status', 'PASS');
      await expect(box.getByTestId('ai-status')).toHaveText('PASS');
      await expect(box.getByTestId('ai-message')).toHaveText(pass.message);
      // the poster is missing → FAIL, issue listed, annotated image shows the box
      const fail = await aiPreview(staff, qRef.id, media('shelf_poster_removed.jpg'));
      expect(fail.res).toMatchObject({ status: 'FAIL', message: 'Element not found as per reference' });
      await expect(fail.box.getByTestId('ai-issues')).toContainText('Element not found as per reference');
      const ann = fail.box.getByTestId('ai-annotated');
      await expect.poll(() => ann.evaluate((i: HTMLImageElement) => (i.complete ? i.naturalWidth : 0))).toBeGreaterThan(0);
      // uniform: wrong colour → FAIL "Uniform colour not matched"; teal uniform with ID → PASS "Groomed"
      const wrong = await aiPreview(staff, qUni.id, media('staff_wrong_colour.jpg'));
      expect(wrong.res).toMatchObject({ status: 'FAIL', message: 'Not Groomed' });
      await expect(wrong.box.getByTestId('ai-issues')).toContainText('Uniform colour not matched');
      const ok = await aiPreview(staff, qUni.id, media('staff_uniform_ok.jpg'));
      expect(ok.res).toMatchObject({ status: 'PASS', message: 'Groomed' });
    });

    let submission: any;
    await test.step('video upload plays, remaining answers, submit → score, flags', async () => {
      await fillGo(staff, qVid.id);
      const up = staff.waitForResponse((r) => r.url().endsWith('/api/uploads') && r.request().method() === 'POST');
      await staff.getByTestId(`input-video-${qVid.id}`).setInputFiles(media('checklist_clip.mp4'));
      const videoUrl = (await (await up).json()).url;
      expect(videoUrl).toMatch(/\.mp4$/);
      const vid = staff.getByTestId(`video-preview-${qVid.id}`);
      await expect(vid).toHaveAttribute('src', videoUrl);
      await expect.poll(() => vid.evaluate((v: HTMLVideoElement) => (v.readyState >= 1 ? v.duration : 0)), { timeout: 120_000 }).toBeGreaterThan(1.5);
      await fillGo(staff, qMulti.id);
      await staff.getByTestId(`input-answer-${qMulti.id}`).getByRole('checkbox', { name: 'A' }).check();
      await staff.getByTestId(`input-answer-${qMulti.id}`).getByRole('checkbox', { name: 'B' }).check();
      await fillGo(staff, qSingle.id);
      await staff.getByTestId(`input-answer-${qSingle.id}`).getByRole('radio', { name: 'Regular' }).check();
      await fillGo(staff, qNum.id);
      await staff.getByTestId(`input-answer-${qNum.id}`).fill('5');
      await fillGo(staff, qRating.id);
      await staff.getByTestId(`input-answer-${qRating.id}`).getByTestId('rating-4').click();
      await fillGo(staff, qText.id);
      await staff.getByTestId(`input-answer-${qText.id}`).fill('Diwali stock arrived late');
      await submitFill(staff);
      await expect(staff.getByTestId('checklist-score-result')).toBeVisible({ timeout: 60_000 });
      await expect(staff.getByTestId('result-score-pct')).toHaveText(fmt.pct(PCT));
      await expect(staff.getByTestId('result-score')).toContainText(`Score ${SCORE} / ${MAX}`);
      await expect(staff.getByTestId('result-flags')).toContainText('3 answer(s) flagged');

      const a = await admin.get(`/api/checklists/assignments/${assignment.id}`);
      expect(a.status).toBe('SUBMITTED');
      submission = await admin.get(`/api/checklists/submissions/${a.submissionId}`);
      expect(submission).toMatchObject({ score: SCORE, maxScore: MAX, scorePct: PCT, flags: 3, status: 'SUBMITTED' });
      const ans = (q: any) => submission.answers.find((x: any) => x.questionId === q.id);
      expect(ans(qYes)).toMatchObject({ value: 'NO', score: 0, flagged: true });
      expect(ans(qRef)).toMatchObject({ score: 0, flagged: true, aiResult: { status: 'FAIL', message: 'Element not found as per reference' } });
      expect(ans(qRef).aiResult.annotatedUrl).toMatch(/^\/uploads\/ai\//);
      expect(ans(qUni)).toMatchObject({ score: 2, flagged: false, aiResult: { status: 'PASS' } });
      expect(ans(qVid)).toMatchObject({ value: videoUrl, score: 1 });
      expect(JSON.parse(ans(qMulti).value).sort()).toEqual(['A', 'B']);
      expect(ans(qSingle)).toMatchObject({ value: 'Regular', score: 0, flagged: true });
      expect(ans(qNum)).toMatchObject({ score: 1, flagged: false });
      expect(ans(qRating)).toMatchObject({ score: 4 });
    });

    await test.step('createTaskOnFail opened a follow-up task; CHECKLIST_NON_COMPLIANCE alert raised', async () => {
      const answerYes = submission.answers.find((x: any) => x.questionId === qYes.id);
      await expect.poll(async () => (await admin.get('/api/tasks', { storeIds: '1' })).filter((t: any) => t.checklistAnswerId === answerYes.id).length).toBe(1);
      const t = (await admin.get('/api/tasks', { storeIds: '1' })).find((x: any) => x.checklistAnswerId === answerYes.id);
      expect(t).toMatchObject({ type: 'FOLLOW_UP', storeId: 1 });
      await expect.poll(async () => (await admin.get('/api/alerts', { storeIds: '1', pageSize: 200 })).items.filter((x: any) => x.ruleId === rule.id).length).toBe(1);
      const alert = (await admin.get('/api/alerts', { storeIds: '1', pageSize: 200 })).items.find((x: any) => x.ruleId === rule.id);
      expect(alert).toMatchObject({ metric: 'CHECKLIST_NON_COMPLIANCE', value: 3 });
      await admin.delete(`/api/alert-rules/${rule.id}`);
    });

    await test.step('manager: submission detail shows flags, AI results and the video; creates a task from the flagged MCQ; approves', async () => {
      const mgr = await pageAs('manager');
      await serveMp4AsWebm(mgr);
      await mgr.goto(`/checklists/submissions/${submission.id}`);
      await expect(mgr.getByTestId('kpi-submission-flags')).toContainText('3');
      await expect(mgr.getByTestId('kpi-submission-score')).toContainText(fmt.pct(PCT));
      for (const q of [qYes, qRef, qSingle]) await expect(mgr.getByTestId(`answer-${q.id}`)).toHaveAttribute('data-flagged', 'true');
      await expect(mgr.getByTestId(`answer-${qUni.id}`)).toHaveAttribute('data-flagged', 'false');
      await expect(mgr.getByTestId(`answer-${qRef.id}`).getByTestId('answer-ai-result')).toHaveAttribute('data-status', 'FAIL');
      await expect(mgr.getByTestId(`answer-${qUni.id}`).getByTestId('answer-ai-result')).toHaveAttribute('data-status', 'PASS');
      const v = mgr.getByTestId(`answer-${qVid.id}`).getByTestId('answer-video');
      await expect.poll(() => v.evaluate((x: HTMLVideoElement) => (x.readyState >= 1 ? x.duration : 0)), { timeout: 120_000 }).toBeGreaterThan(1.5);
      await expect(mgr.getByTestId(`answer-${qUni.id}`).getByTestId('btn-answer-task')).toHaveCount(0);
      await mgr.getByTestId(`answer-${qSingle.id}`).getByTestId('btn-answer-task').click();
      const dlg = mgr.getByTestId('dialog-answer-task');
      await expect(dlg.getByTestId('input-title')).toHaveValue('Fix: Music playlist');
      await fillDialog(mgr, dlg, { assigneeId: { option: staffUser.name }, priority: { option: 'Urgent' } });
      await dlg.getByTestId('btn-save').click();
      await expectToast(mgr, 'Task “Fix: Music playlist” created');
      const answerSingle = submission.answers.find((x: any) => x.questionId === qSingle.id);
      const t = (await admin.get('/api/tasks', { storeIds: '1' })).find((x: any) => x.checklistAnswerId === answerSingle.id);
      expect(t).toMatchObject({ type: 'FOLLOW_UP', title: 'Fix: Music playlist', assigneeId: staffUser.id, priority: 'URGENT' });
      // the staff member sees it on the board, marked as coming from a checklist
      await staff.goto('/tasks');
      await staff.getByTestId('view-board').click();
      await expect(staff.getByTestId(`task-card-${t.id}`).getByTestId('task-from-checklist')).toBeVisible();
      // approve
      await mgr.getByTestId('btn-start-review').click();
      await mgr.getByTestId('input-review-status').getByTestId('review-approve').click();
      await mgr.getByTestId('input-review-comment').fill('Fix the playlist today');
      await mgr.getByTestId('btn-submit-review').click();
      await expect(mgr.getByTestId('kpi-submission-status').getByTestId('chip-status')).toHaveAttribute('data-value', 'APPROVED');
      expect((await admin.get(`/api/checklists/assignments/${assignment.id}`)).status).toBe('APPROVED');
      expect(managerUser.role).toBe('STORE_MANAGER');
    });
  });

  test('multi-store weekly schedule: generate creates one assignment per store for each store manager', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const tpl = (await admin.get('/api/checklists/templates')).find((t: any) => t.isActive);
    const dow = new Date(`${todayLocal()}T12:00:00Z`).getUTCDay();
    const page = await pageAs('regional');
    await page.goto('/checklists/schedules');
    await page.getByTestId('btn-create-checklist-schedule').click();
    const dlg = page.getByTestId('dialog-checklist-schedule');
    await matSelect(page, dlg.getByTestId('input-schedule-template'), tpl.name);
    await matMultiSelect(page, dlg.getByTestId('input-schedule-stores'), ['Congruence Anna Nagar', 'Congruence Adyar']);
    await dlg.getByTestId('frequency-WEEKLY').click();
    for (let d = 0; d < 7; d++) {
      const box = dlg.getByTestId(`day-${d}`).locator('input[type=checkbox]');
      if ((await box.isChecked()) !== (d === dow)) await box.click();
    }
    await dlg.getByTestId('input-schedule-window-start').fill('09:30');
    await dlg.getByTestId('input-schedule-window-end').fill('23:50');
    await dlg.getByTestId('input-schedule-start').fill(todayLocal());
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Schedule created');
    const s = (await admin.get('/api/checklists/schedules')).filter((x: any) => x.templateId === tpl.id && x.storeIds.length === 2).pop();
    expect(s).toMatchObject({ frequency: 'WEEKLY', daysOfWeek: [dow], assigneeId: null });
    expect(s.storeIds.sort()).toEqual([2, 4]);
    await page.getByTestId(`row-checklist-schedule-${s.id}`).getByTestId('btn-generate-schedule').click();
    await expectToast(page, '2 assignment(s) created for today');
    const created = (await admin.get('/api/checklists/assignments', { storeIds: '2,4' })).filter((a: any) => a.scheduleId === s.id);
    expect(created.map((a: any) => a.storeId).sort()).toEqual([2, 4]);
    const users = await admin.get('/api/users');
    for (const a of created) {
      const u = users.find((x: any) => x.id === a.assigneeId);
      expect(u.role).toBe('STORE_MANAGER');
      expect(u.storeIds).toContain(a.storeId);
    }
    // edit + delete
    await page.getByTestId(`row-checklist-schedule-${s.id}`).getByTestId('btn-delete').click();
    await page.locator('mat-dialog-container').getByTestId('btn-confirm').click();
    await expectToast(page, 'Schedule deleted');
    expect((await admin.get('/api/checklists/schedules')).some((x: any) => x.id === s.id)).toBe(false);
  });

  test('nudges: reminder before the deadline, then overdue once it passes → staff bell updates live with both, reminder opens the fill page', async ({ pageAs, api }) => {
    test.setTimeout(300_000);
    const ist = istHm();
    test.skip(ist < '01:00' || ist > '23:50', 'the checklist window must end later today (IST)');
    const admin = await api('admin');
    const staffApi = await api('staff');
    const staffUser = await staffApi.get('/api/auth/me');
    const tpl = await admin.post('/api/checklists/templates', {
      name: `E2E nudge ${uid()}`, description: '', category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [{ section: 'General', text: 'Lights on?', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 }],
    });
    // staff keeps the tasks page open while the deadline passes and an admin runs the nudges
    const staff = await pageAs('staff');
    await staff.goto('/tasks');
    await expect(staff.getByTestId('notif-bell')).toBeVisible();
    const unread = async () => (await staffApi.get('/api/notifications')).filter((n: any) => !n.isRead).length;
    const before = await unread();
    const bell = async () => ((await staff.getByTestId('notif-count').count()) ? Number(await staff.getByTestId('notif-count').innerText()) : 0);
    await expect.poll(bell).toBe(before);

    // window ends in ~2 minutes (HH:mm) → the assignment is PENDING and due within the 60 min reminder lead time
    const end = istHm(2);
    const sched = await admin.post('/api/checklists/schedules', {
      templateId: tpl.id, storeIds: [1], assigneeId: staffUser.id, frequency: 'DAILY', repeatEvery: 1, daysOfWeek: [], dayOfMonth: null,
      windowStart: istHm(-60), windowEnd: end, startDate: todayLocal(), endDate: null, reminderMinutesBefore: 60, isActive: true,
    });
    expect((await admin.post(`/api/checklists/schedules/${sched.id}/generate`)).created).toBe(1);
    const a = (await admin.get('/api/checklists/assignments', { storeIds: '1' })).find((x: any) => x.scheduleId === sched.id);
    expect(a.status).toBe('PENDING');

    // 1) reminder, run from Settings → "Run nudges now"
    const adm = await pageAs('admin');
    await adm.goto('/admin/settings');
    const run = adm.waitForResponse((r) => r.url().endsWith('/api/checklists/nudges/run'));
    await adm.getByTestId('btn-run-nudges').click();
    const res = await (await run).json();
    expect(res.reminders).toBeGreaterThanOrEqual(1);
    const reminder = (await staffApi.get('/api/notifications')).find((n: any) => n.link === `/checklists/assignments/${a.id}`);
    expect(reminder).toMatchObject({ title: `Reminder: ${tpl.name}`, isRead: false });
    expect(reminder.body).toContain(`due at ${end}`);
    expect((await admin.post('/api/checklists/nudges/run')).reminders).toBe(0); // never twice
    // the bell updates without a reload (SSE) to the server's unread count (other due checklists may be reminded too)
    const afterReminder = await unread();
    expect(afterReminder).toBeGreaterThan(before);
    await expect.poll(bell, { timeout: 20_000 }).toBe(afterReminder);

    // 2) the deadline passes → the nudge job marks it OVERDUE and notifies the assignee and the store manager
    await expect
      .poll(async () => {
        await admin.post('/api/checklists/nudges/run');
        return (await admin.get(`/api/checklists/assignments/${a.id}`)).status;
      }, { timeout: 200_000, intervals: [5_000] })
      .toBe('OVERDUE');
    const overdue = (await staffApi.get('/api/notifications')).find((n: any) => n.link === `/checklists/assignments/${a.id}` && n.id !== reminder.id);
    expect(overdue.title).toBe(`Overdue: ${tpl.name}`);
    expect((await (await api('manager')).get('/api/notifications')).some((n: any) => n.link === `/checklists/assignments/${a.id}` && /^Overdue/.test(n.title))).toBe(true);
    const afterOverdue = await unread();
    expect(afterOverdue).toBeGreaterThan(afterReminder);
    await expect.poll(bell, { timeout: 20_000 }).toBe(afterOverdue);

    // kinds and deep link
    await staff.getByTestId('notif-bell').click();
    await expect(staff.getByTestId(`notif-item-${reminder.id}`)).toHaveAttribute('data-kind', 'reminder');
    await expect(staff.getByTestId(`notif-item-${overdue.id}`)).toHaveAttribute('data-kind', 'overdue');
    await staff.getByTestId(`notif-item-${reminder.id}`).click();
    await expect(staff.getByTestId('page-checklist-fill')).toBeVisible();
    await expect(staff).toHaveURL(new RegExp(`/checklists/(fill|assignments)/${a.id}`));
    await expect(staff.getByTestId(`question-${tpl.questions[0].id}`)).toBeVisible();
    await expect.poll(bell).toBe(afterOverdue - 1); // opening it marked it read
    await admin.delete(`/api/checklists/schedules/${sched.id}`);
  });

  test('compliance dashboard: tiles equal /checklists/dashboard, checklist / store / user tabs, CSV export', async ({ pageAs, api }) => {
    const page = await pageAs('auditor');
    await presetFilter(page, { preset: 'last30' });
    const resp = waitForApi(page, '/api/checklists/dashboard');
    await page.goto('/checklists/dashboard');
    const ui = await (await resp).json();
    const u = new URL((await resp).url());
    const d = await (await api('auditor')).get('/api/checklists/dashboard', { from: u.searchParams.get('from')!, to: u.searchParams.get('to')! });
    expect(ui).toEqual(d);
    expect(d.checklistInstances).toBeGreaterThan(0);
    expect(d.totalFlags).toBeGreaterThan(0);
    expect(d.completionScorePct).toBeCloseTo((d.submitted / d.checklistInstances) * 100, 1);
    for (const [id, v] of [['trax-active', d.activeChecklists], ['trax-instances', d.checklistInstances], ['trax-not-submitted', d.notSubmitted], ['trax-open', d.open], ['trax-in-progress', d.inProgress], ['trax-submitted', d.submitted], ['trax-flags', d.totalFlags]] as const) {
      expect(await kpiText(page, id), id).toBe(fmt.number(v));
    }
    expect(await kpiText(page, 'trax-completion')).toBe(fmt.pct(d.completionScorePct));
    expect(await kpiText(page, 'trax-compliance')).toBe(fmt.pct(d.complianceScorePct));
    const tabs = page.getByTestId('trax-tabs');
    const check = async (tab: string, rows: any[], idKey: string) => {
      const table = page.getByTestId(`table-trax-${tab}`);
      await expect(table.locator('[data-testid^="row-trax-"]')).toHaveCount(rows.length);
      const r = rows[0];
      await expect(page.getByTestId(`row-trax-${tab}-${r[idKey]}`)).toContainText(String(r.submitted));
    };
    await check('checklist', d.byChecklist, 'templateId');
    await tabs.getByRole('tab', { name: /Store/ }).click();
    await check('store', d.byStore, 'storeId');
    await tabs.getByRole('tab', { name: /User/ }).click();
    await check('user', d.byUser, 'userId');
    const dl = page.waitForEvent('download');
    await page.getByTestId('btn-export-dashboard').click();
    const file = await dl;
    expect(file.suggestedFilename()).toMatch(/^checklist-user-performance_.*\.csv$/);
    const csv = (await (await import('fs')).promises.readFile((await file.path())!, 'utf8')).replace(/^﻿/, '');
    expect(csv.split(/\r?\n/)[0]).toBe('User,Assigned,Submitted,Flags,Completion %,Compliance %');
    expect(csv.split(/\r?\n/).filter(Boolean)).toHaveLength(d.byUser.length + 1);
  });

  test('tablet (iPad portrait): STAFF fills a checklist on the mobile layout (PWA use)', async ({ browser, api }) => {
    const admin = await api('admin');
    const staffUser = await (await api('staff')).get('/api/auth/me');
    const tpl = await admin.post('/api/checklists/templates', {
      name: `E2E tablet ${uid()}`, description: '', category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [
        { section: 'General', text: 'Shutters fully open?', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 },
        { section: 'General', text: 'Entrance photo', type: 'PHOTO', required: true, weight: 1, requiresPhoto: true, sortOrder: 1 },
      ],
    });
    const a = await admin.post('/api/checklists/assignments', { templateId: tpl.id, storeId: 1, assigneeId: staffUser.id, dueDate: todayLocal() });
    const tablet = await browser.newContext({
      storageState: storageStatePath('staff'),
      baseURL: WEB_URL,
      viewport: { width: 768, height: 1024 },
      deviceScaleFactor: 2,
      isMobile: true,
      hasTouch: true,
      timezoneId: 'Asia/Kolkata',
      serviceWorkers: 'block',
    });
    const page = await tablet.newPage();
    await page.goto(`/checklists/fill/${a.id}`);
    await expect(page.getByTestId('page-checklist-fill')).toBeVisible();
    // mobile shell: hamburger instead of the fixed sidenav, no horizontal scrolling
    await expect(page.getByTestId('btn-menu')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    const q = tpl.questions.sort((x: any, y: any) => x.sortOrder - y.sortOrder);
    await page.getByTestId(`input-answer-${q[0].id}`).getByTestId('answer-yes').tap();
    // one question per screen: Next is a full-size touch target
    const next = page.getByTestId('btn-fill-next');
    expect((await next.boundingBox())!.height).toBeGreaterThanOrEqual(40);
    await next.tap();
    // camera capture input for photos
    await expect(page.getByTestId(`input-photo-${q[1].id}`)).toHaveAttribute('capture', 'environment');
    await page.getByTestId(`input-photo-${q[1].id}`).setInputFiles(media('task_proof.jpg'));
    await expect(page.getByTestId(`photo-preview-${q[1].id}`)).toBeVisible();
    await page.getByTestId('btn-fill-review').tap();
    const submit = page.getByTestId('btn-submit-checklist');
    await submit.scrollIntoViewIfNeeded();
    const box = (await submit.boundingBox())!;
    expect(box.x + box.width).toBeLessThanOrEqual(768);
    expect(box.height).toBeGreaterThanOrEqual(36); // touch-sized target
    await submit.tap();
    await page.locator('mat-dialog-container').getByTestId('btn-confirm').tap();
    await expect(page.getByTestId('result-score-pct')).toHaveText('100.0%');
    await tablet.close();
    expect((await admin.get(`/api/checklists/assignments/${a.id}`)).status).toBe('SUBMITTED');
  });
});
