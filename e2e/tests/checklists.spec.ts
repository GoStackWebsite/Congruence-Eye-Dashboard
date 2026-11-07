import * as path from 'path';
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { FIXTURES, addDays, todayLocal, uid } from '../support/env';
import { expectToast, fillDialog, fillGo, fmt, kpiText, matSelect, presetFilter, submitFill, waitForApi } from '../support/ui';

/**
 * Template (weights in brackets) and the answers given by STAFF:
 *   Q0 YES_NO     [2]  "Entrance swept and mopped?"       → YES                    → 2
 *   Q1 MCQ_SINGLE [3]  "Which playlist is running?"        → Playlist B (correct)   → 3
 *   Q2 NUMBER     [2]  "Chiller temperature (°C)" 2..8     → 12 (out of range)      → 0   (redo → 5 → 2)
 *   Q3 RATING     [5]  "Window display quality" (Display)  → 4 stars                → 4
 *   Q4 PHOTO      [1]  "Photo of the promo shelf" (Display)→ shelf.png              → 1
 * max = 13 → first submission 10/13 = 76.92 %, after redo 12/13 = 92.31 %
 */
const W = { yes: 2, mcq: 3, num: 2, rating: 5, photo: 1 };
const MAX = W.yes + W.mcq + W.num + W.rating + W.photo;
const FIRST = W.yes + W.mcq + 0 + (4 / 5) * W.rating + W.photo;
const SECOND = FIRST + W.num;
const pct2 = (s: number) => Math.round((s / MAX) * 10000) / 100;

async function setQuestion(page: Page, i: number, v: { text: string; section?: string; weight: number }) {
  const q = page.getByTestId(`question-${i}`);
  await q.getByTestId('input-question-text').fill(v.text);
  if (v.section) await q.getByTestId('input-question-section').fill(v.section);
  await q.getByTestId('input-question-weight').fill(String(v.weight));
  return q;
}
async function addQuestion(page: Page, type: string) {
  await page.getByTestId('btn-add-question').click();
  await page.getByTestId(`btn-add-question-${type}`).click();
}

test.describe('Checklists & audits', () => {
  test.setTimeout(240_000);

  test('build template → assign → staff fills (photo) → score → auditor REDO → resubmit → APPROVED → compliance', async ({ pageAs, api }) => {
    const admin = await api('admin');
    const staffUser = (await (await api('staff')).get('/api/auth/me'));
    const name = `E2E Hygiene audit ${uid()}`;
    const today = todayLocal();
    const complianceBefore = (await admin.get('/api/checklists/compliance', { storeIds: '1', from: today, to: today }))[0];

    // ---------------------------------------------------------------- build (auditor)
    const auditor = await pageAs('auditor');
    let template: any;
    await test.step('auditor builds the template in the UI', async () => {
      await auditor.goto('/checklists');
      await auditor.getByTestId('btn-create-template').click();
      await expect(auditor.getByTestId('page-template-builder')).toBeVisible();
      await auditor.getByTestId('input-template-name').fill(name);
      await matSelect(auditor, 'input-template-category', 'Hygiene');
      await matSelect(auditor, 'input-template-frequency', 'Daily');
      await auditor.getByTestId('input-template-description').fill('Created by Playwright');

      // validation: empty question text is rejected
      await auditor.getByTestId('btn-save-template').click();
      await expect(auditor.getByTestId('template-errors')).toBeVisible();

      await setQuestion(auditor, 0, { text: 'Entrance swept and mopped?', weight: W.yes });

      await addQuestion(auditor, 'MCQ_SINGLE');
      const q1 = await setQuestion(auditor, 1, { text: 'Which playlist is running?', weight: W.mcq });
      await q1.getByTestId('input-question-options').fill('Playlist A, Playlist B, Playlist C');
      // correct answers are marked on the option rows
      await q1.getByTestId('input-question-correct').getByRole('button', { name: 'Correct answer: Playlist B' }).click();

      await addQuestion(auditor, 'NUMBER');
      const q2 = await setQuestion(auditor, 2, { text: 'Chiller temperature (°C)', weight: W.num });
      await q2.getByTestId('input-question-min').fill('2');
      await q2.getByTestId('input-question-max').fill('8');

      await addQuestion(auditor, 'RATING');
      await setQuestion(auditor, 3, { text: 'Window display quality', section: 'Display', weight: W.rating });
      await addQuestion(auditor, 'PHOTO');
      const q4 = await setQuestion(auditor, 4, { text: 'Photo of the promo shelf', section: 'Display', weight: W.photo });
      await expect(q4.getByTestId('input-question-photo').locator('input')).toBeChecked();

      await expect(auditor.getByTestId('question-list').locator('[data-testid^="question-"]')).toHaveCount(5);
      await expect(auditor.getByTestId('section-Display')).toBeVisible();
      await expect(auditor.getByTestId('page-template-builder')).toContainText(`max score ${MAX}`);
      await auditor.getByTestId('btn-save').click();
      await expectToast(auditor, 'Template saved');
      await expect(auditor).toHaveURL(/\/checklists$/);

      template = (await admin.get('/api/checklists/templates')).find((t: any) => t.name === name);
      expect(template).toMatchObject({ category: 'HYGIENE', frequency: 'DAILY', isActive: true });
      const qs = [...template.questions].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
      expect(qs.map((q: any) => q.type)).toEqual(['YES_NO', 'MCQ_SINGLE', 'NUMBER', 'RATING', 'PHOTO']);
      expect(qs.map((q: any) => q.weight)).toEqual([W.yes, W.mcq, W.num, W.rating, W.photo]);
      expect(qs[1]).toMatchObject({ options: ['Playlist A', 'Playlist B', 'Playlist C'], correctOptions: ['Playlist B'] });
      expect(qs[2]).toMatchObject({ minValue: 2, maxValue: 8 });
      expect(qs[3].section).toBe('Display');
      expect(qs[4]).toMatchObject({ section: 'Display', requiresPhoto: true });
      template.questions = qs;
    });
    const [qYes, qMcq, qNum, qRating, qPhoto] = template.questions;

    // ---------------------------------------------------------------- assign (auditor, from the template row)
    let assignment: any;
    await test.step('assign to staff.tnagar for T Nagar', async () => {
      await auditor.getByTestId('input-search').fill(name);
      await auditor.getByTestId(`row-template-${template.id}`).getByTestId('btn-assign').click();
      const dlg = auditor.getByTestId('dialog-assignment');
      await expect(dlg).toBeVisible();
      await expect(dlg.getByTestId('input-templateId')).toContainText(name);
      await fillDialog(auditor, dlg, {
        storeId: { option: 'Congruence T Nagar' },
        assigneeId: { option: new RegExp(`^${staffUser.name} \\(staff\\)`) },
        dueDate: addDays(today, 1),
      });
      await dlg.getByTestId('btn-save').click();
      await expectToast(auditor, 'Checklist assigned');
      assignment = (await admin.get('/api/checklists/assignments', { storeIds: '1' })).find((a: any) => a.templateId === template.id);
      expect(assignment).toMatchObject({ storeId: 1, assigneeId: staffUser.id, dueDate: addDays(today, 1), status: 'PENDING', submissionId: null });
    });

    // ---------------------------------------------------------------- fill (staff)
    const staff = await pageAs('staff');
    let submissionId = 0;
    await test.step('staff fills and submits; score equals the hand-computed value', async () => {
      await staff.goto('/checklists/assignments');
      const row = staff.getByTestId(`row-assignment-${assignment.id}`);
      await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'PENDING');
      await row.getByTestId('btn-fill').click();
      await expect(staff.getByTestId('page-checklist-fill')).toBeVisible();
      await expect(staff.getByTestId('fill-section-General')).toBeVisible();
      await expect(staff.getByTestId('fill-section-Display')).toBeVisible();

      // the review screen lists the unanswered required questions and blocks submitting
      await staff.getByTestId('fill-nav-review').click();
      await expect(staff.getByTestId(`review-missing-${qYes.id}`)).toContainText('This question is required');
      await expect(staff.getByTestId(`review-missing-${qPhoto.id}`)).toContainText('A photo is required');
      await expect(staff.getByTestId('btn-submit-checklist')).toBeDisabled();
      // jumping back shows the error on the question itself
      await staff.getByTestId(`review-missing-${qPhoto.id}`).click();
      await expect(staff.getByTestId(`question-${qPhoto.id}`).getByTestId('question-error')).toHaveText('A photo is required');
      await fillGo(staff, qYes.id);
      await expect(staff.getByTestId(`question-${qYes.id}`).getByTestId('question-error')).toBeVisible();

      await staff.getByTestId(`input-answer-${qYes.id}`).getByTestId('answer-yes').click();
      await expect(staff.getByTestId(`question-${qYes.id}`).getByTestId('question-error')).toHaveCount(0);
      await fillGo(staff, qMcq.id);
      await staff.getByTestId(`input-answer-${qMcq.id}`).getByRole('radio', { name: 'Playlist B' }).check();
      await fillGo(staff, qNum.id);
      await staff.getByTestId(`input-answer-${qNum.id}`).fill('12');
      await fillGo(staff, qRating.id);
      await staff.getByTestId(`input-answer-${qRating.id}`).getByTestId('rating-4').click();
      await fillGo(staff, qPhoto.id);
      await staff.getByTestId(`input-photo-${qPhoto.id}`).setInputFiles(path.join(FIXTURES, 'shelf.png'));
      await expect(staff.getByTestId(`photo-preview-${qPhoto.id}`)).toBeVisible();
      await fillGo(staff, qNum.id);
      await staff.getByTestId(`btn-remark-${qNum.id}`).click();
      await staff.getByTestId(`input-remark-${qNum.id}`).fill('Compressor noisy');

      await expect(staff.getByTestId('score-preview')).toContainText(`${FIRST} / ${MAX} (${fmt.pct(Math.round((FIRST / MAX) * 1000) / 10)})`);
      await submitFill(staff);
      const result = staff.getByTestId('checklist-score-result');
      await expect(result).toBeVisible();
      await expect(staff.getByTestId('result-score-pct')).toHaveText(fmt.pct(pct2(FIRST)));
      await expect(staff.getByTestId('result-score')).toContainText(`Score ${FIRST} / ${MAX}`);

      const sub = (await admin.get('/api/checklists/submissions', { storeIds: '1', templateId: template.id }))[0];
      expect(sub).toMatchObject({ score: FIRST, maxScore: MAX, scorePct: pct2(FIRST), status: 'SUBMITTED', submittedById: staffUser.id });
      submissionId = sub.id;
      const full = await admin.get(`/api/checklists/submissions/${sub.id}`);
      const ans = (q: any) => full.answers.find((a: any) => a.questionId === q.id);
      expect(ans(qYes)).toMatchObject({ value: 'YES', score: W.yes });
      expect(ans(qMcq)).toMatchObject({ value: 'Playlist B', score: W.mcq });
      expect(ans(qNum)).toMatchObject({ value: '12', score: 0, remark: 'Compressor noisy' });
      expect(ans(qRating)).toMatchObject({ value: '4', score: 4 });
      expect(ans(qPhoto).photoUrl).toMatch(/^\/uploads\/.+\.png$/);
      expect(ans(qPhoto).score).toBe(W.photo);
      // the uploaded photo is served
      const img = await staff.request.get(ans(qPhoto).photoUrl);
      expect(img.status()).toBe(200);
      expect((await img.body()).subarray(1, 4).toString()).toBe('PNG');
    });

    // ---------------------------------------------------------------- review REDO (auditor)
    await test.step('auditor requests a redo of the temperature question', async () => {
      await auditor.goto(`/checklists/submissions/${submissionId}`);
      await expect(auditor.getByTestId('kpi-submission-score')).toContainText(fmt.pct(pct2(FIRST)));
      await expect(auditor.getByTestId('kpi-submission-status').getByTestId('chip-status')).toHaveAttribute('data-value', 'SUBMITTED');
      await expect(auditor.getByTestId(`answer-${qNum.id}`).getByTestId('answer-value')).toContainText('12');
      await auditor.getByTestId('btn-start-review').click();
      await auditor.getByTestId(`redo-flag-${qNum.id}`).locator('input').check();
      await expect(auditor.getByTestId('input-review-status').getByTestId('review-redo')).toHaveClass(/checked/);
      await auditor.getByTestId('input-review-comment').fill('Re-measure the chiller');
      await auditor.getByTestId('btn-submit-review').click();
      await expect(auditor.getByTestId('kpi-submission-status').getByTestId('chip-status')).toHaveAttribute('data-value', 'REDO');
      const s = await admin.get(`/api/checklists/submissions/${submissionId}`);
      expect(s.status).toBe('REDO');
      expect(s.reviewerComment).toBe('Re-measure the chiller');
      expect(s.answers.find((a: any) => a.questionId === qNum.id).redo).toBe(true);
      expect(s.answers.filter((a: any) => a.redo)).toHaveLength(1);
      expect((await admin.get(`/api/checklists/assignments/${assignment.id}`)).status).toBe('REDO');
    });

    // ---------------------------------------------------------------- redo (staff)
    await test.step('staff redoes the checklist', async () => {
      await staff.goto('/checklists/assignments');
      const row = staff.getByTestId(`row-assignment-${assignment.id}`);
      await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'REDO');
      await expect(row.getByTestId('btn-fill')).toHaveText(/Redo/);
      await row.getByTestId('btn-fill').click();
      await expect(staff.getByTestId('redo-banner')).toContainText('Re-measure the chiller');
      await expect(staff.getByTestId(`question-${qNum.id}`)).toHaveClass(/redo/);
      // previous answers are pre-filled
      await expect(staff.getByTestId(`input-answer-${qNum.id}`)).toHaveValue('12');
      await staff.getByTestId(`input-answer-${qNum.id}`).fill('5');
      await expect(staff.getByTestId('score-preview')).toContainText(`${SECOND} / ${MAX}`);
      await submitFill(staff);
      await expect(staff.getByTestId('result-score-pct')).toHaveText(fmt.pct(pct2(SECOND)));
    });

    // ---------------------------------------------------------------- approve (auditor)
    let second: any;
    await test.step('auditor approves the resubmission', async () => {
      const a = await admin.get(`/api/checklists/assignments/${assignment.id}`);
      expect(a.status).toBe('SUBMITTED');
      expect(a.submissionId).not.toBe(submissionId);
      second = await admin.get(`/api/checklists/submissions/${a.submissionId}`);
      expect(second).toMatchObject({ score: SECOND, scorePct: pct2(SECOND), status: 'SUBMITTED' });

      await auditor.goto('/checklists/submissions');
      await auditor.getByTestId(`row-submission-${second.id}`).click();
      await expect(auditor).toHaveURL(new RegExp(`/checklists/submissions/${second.id}$`));
      await auditor.getByTestId('btn-start-review').click();
      await auditor.getByTestId('input-review-status').getByTestId('review-approve').click();
      await auditor.getByTestId('input-review-comment').fill('All good now');
      await auditor.getByTestId('btn-submit-review').click();
      await expect(auditor.getByTestId('kpi-submission-status').getByTestId('chip-status')).toHaveAttribute('data-value', 'APPROVED');
      expect((await admin.get(`/api/checklists/assignments/${assignment.id}`)).status).toBe('APPROVED');

      // staff sees the approved status and can open the submission read-only
      await staff.goto('/checklists/assignments');
      const row = staff.getByTestId(`row-assignment-${assignment.id}`);
      await expect(row.getByTestId('chip-status')).toHaveAttribute('data-value', 'APPROVED');
      await expect(row.getByTestId('btn-fill')).toHaveCount(0);
      await row.getByTestId('btn-view-submission').click();
      await expect(staff.getByTestId('kpi-submission-score')).toContainText(fmt.pct(pct2(SECOND)));
      await expect(staff.getByTestId('review-panel')).toHaveCount(0);
    });

    // ---------------------------------------------------------------- compliance
    await test.step('compliance reflects both submissions', async () => {
      const after = (await admin.get('/api/checklists/compliance', { storeIds: '1', from: today, to: today }))[0];
      expect(after.submissions - complianceBefore.submissions).toBe(2);
      const expectedAvg = (complianceBefore.avgScorePct * complianceBefore.submissions + pct2(FIRST) + pct2(SECOND)) / (complianceBefore.submissions + 2);
      expect(after.avgScorePct).toBeCloseTo(expectedAvg, 1);
      expect(after.byCategory.some((c: any) => c.category === 'HYGIENE')).toBe(true);

      await presetFilter(auditor, { preset: 'today', storeIds: [1] });
      const resp = waitForApi(auditor, '/api/checklists/compliance', (u) => u.searchParams.get('from') === today && u.searchParams.get('storeIds') === '1');
      await auditor.goto('/checklists/compliance');
      const ui = (await (await resp).json())[0];
      expect(ui.submissions).toBe(after.submissions);
      await expect(auditor.getByTestId('row-compliance-1')).toContainText(fmt.pct(after.avgScorePct));
      expect(await kpiText(auditor, 'compliance-submissions')).toBe(fmt.number(after.submissions));
      expect(await kpiText(auditor, 'compliance-avg')).toBe(fmt.pct(after.avgScorePct));
    });
  });

  test('STAFF cannot create templates and only sees own assignments', async ({ api, pageAs }) => {
    const staff = await api('staff');
    const me = await staff.get('/api/auth/me');
    const mine = await staff.get('/api/checklists/assignments', { mine: true });
    expect(mine.length).toBeGreaterThan(0);
    for (const a of mine) expect(a.assigneeId).toBe(me.id);
    const page = await pageAs('staff');
    await page.goto('/checklists/assignments');
    await expect(page.getByTestId('page-title')).toHaveText('My checklists');
    await expect(page.getByTestId('btn-create-assignment')).toHaveCount(0);
    await expect(page.getByTestId('toggle-mine')).toHaveCount(0);
    await page.goto('/checklists/templates/new');
    await expect(page).toHaveURL(/\/tasks$/);
  });
});
