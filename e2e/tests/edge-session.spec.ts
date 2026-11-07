/**
 * Session expiry and unsaved-changes guards (docs/qa/UI_EDGE_CASE_PLAN.md · H1–H3, U1–U3).
 *  - The token expires mid-checklist: the next API call answers 401 → /login?returnUrl=<fill page>&expired=1 with a
 *    "session expired" notice; signing in again returns to the checklist and the unsaved answers are restored from
 *    the device (never silently lost).
 *  - An expired token in storage at start-up → /login?returnUrl=<requested page>; after sign-in the user lands there.
 *  - Leaving the template builder, the fill page or the AI rule editor with unsaved changes asks first; "Cancel"
 *    keeps the page and the edits, "Leave page" navigates.
 */
import { Page } from '@playwright/test';
import { test, expect } from '../support/fixtures';
import { PASSWORD, USERS, WEB_URL, todayLocal, uid } from '../support/env';
import { settle } from '../support/qa';

async function login(page: Page, email: string) {
  await page.getByTestId('input-email').fill(email);
  await page.getByTestId('input-password').fill(PASSWORD);
  await page.getByTestId('btn-login').click();
}

/** A JWT whose exp is in the past (the SPA only decodes it; the signature is never checked client side). */
function expiredJwt(): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: 5, exp: Math.floor(Date.now() / 1000) - 60 })}.sig`;
}

test.describe('Edge: session expiry and unsaved changes', () => {
  test('token expires mid-checklist → login with returnUrl, then back to the checklist with the unsaved answers restored', async ({ browser, api }) => {
    const admin = await api('admin');
    const me = await (await api('staff')).get('/api/auth/me');
    const tpl = await admin.post('/api/checklists/templates', {
      name: `E2E expiry ${uid()}`, description: '', category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [
        { section: 'General', text: 'Lights on?', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 },
        { section: 'General', text: 'Remarks', type: 'TEXT', required: false, weight: 0, requiresPhoto: false, sortOrder: 1 },
      ],
    });
    const q = [...tpl.questions].sort((a: any, b: any) => a.sortOrder - b.sortOrder);
    const a = await admin.post('/api/checklists/assignments', { templateId: tpl.id, storeId: 1, assigneeId: me.id, dueDate: todayLocal() });

    // a fresh login (own token) so the staff storage state of other tests is untouched
    const ctx = await browser.newContext({ baseURL: WEB_URL, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block', viewport: { width: 390, height: 844 } });
    const page = await ctx.newPage();
    await page.goto('/login');
    await login(page, USERS.staff);
    await expect(page).toHaveURL(/\/tasks$/);
    await page.goto(`/checklists/fill/${a.id}`);
    await settle(page, 'page-checklist-fill');
    await page.getByTestId(`input-answer-${q[0].id}`).getByTestId('answer-yes').click();
    await page.getByTestId('btn-fill-next').click();
    await page.getByTestId(`input-answer-${q[1].id}`).fill('Typed before the session expired');

    // the session ends: every API call now answers 401 (token expired / revoked server side)
    await page.route('**/api/**', (r) => (r.request().url().includes('/auth/login') ? r.continue() : r.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } })));
    await page.getByTestId('btn-save-draft').click();
    await expect(page).toHaveURL(new RegExp(`/login\\?returnUrl=%2Fchecklists%2Ffill%2F${a.id}&expired=1`));
    await expect(page.getByTestId('session-expired')).toBeVisible();
    await expect(page.locator('mat-snack-bar-container')).toContainText('session has expired');
    // no "leave without saving?" dialog blocked the redirect
    await expect(page.locator('mat-dialog-container')).toHaveCount(0);
    await page.unroute('**/api/**');

    await login(page, USERS.staff);
    await expect(page).toHaveURL(new RegExp(`/checklists/fill/${a.id}$`));
    await settle(page, 'page-checklist-fill');
    await expect(page.getByTestId('local-draft-banner')).toBeVisible();
    await expect(page.getByTestId('local-draft-banner')).toContainText('2 answer(s)');
    // on a phone the outline is a sheet behind a button; click() waits for the entry once the sheet has opened
    const nav = page.getByTestId('fill-nav-' + q[1].id);
    if (!(await nav.isVisible())) await page.getByTestId('btn-fill-outline').click();
    await nav.click();
    await expect(page.getByTestId(`input-answer-${q[1].id}`)).toHaveValue('Typed before the session expired');
    // saving the draft now reaches the server and clears the device copy
    await page.getByTestId('btn-save-draft').click();
    await expect.poll(async () => ((await admin.get(`/api/checklists/assignments/${a.id}`)).draftAnswers ?? []).length).toBe(2);
    await expect(page.getByTestId('local-draft-banner')).toHaveCount(0);
    expect(await page.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith('ce.fillBackup.')).length)).toBe(0);
    await ctx.close();
  });

  test('expired token at start-up → /login?returnUrl=…, sign-in returns to the requested page', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: WEB_URL, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const user = { id: 3, name: 'Kavitha', email: USERS.manager, role: 'STORE_MANAGER', storeIds: [1] };
    await page.addInitScript(([t, u]) => {
      if (!sessionStorage.getItem('seeded')) {
        localStorage.setItem('ce.token', t);
        localStorage.setItem('ce.user', u);
        sessionStorage.setItem('seeded', '1');
      }
    }, [expiredJwt(), JSON.stringify(user)]);
    await page.goto('/analytics/queue?x=1');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fanalytics%2Fqueue%3Fx%3D1/);
    await login(page, USERS.manager);
    await expect(page).toHaveURL(/\/analytics\/queue\?x=1$/);
    await expect(page.getByTestId('page-queue')).toBeVisible();
    await ctx.close();
  });

  test('a 401 on any page (revoked token) → login with returnUrl and back after sign-in', async ({ browser }) => {
    const ctx = await browser.newContext({ baseURL: WEB_URL, timezoneId: 'Asia/Kolkata', serviceWorkers: 'block' });
    const page = await ctx.newPage();
    await page.goto('/login');
    await login(page, USERS.regional);
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await page.goto('/tickets');
    await settle(page, 'page-tickets');
    await page.route('**/api/tickets**', (r) => r.fulfill({ status: 401, json: { statusCode: 401, message: 'Unauthorized' } }));
    await page.reload();
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Ftickets/);
    await page.unroute('**/api/tickets**');
    await login(page, USERS.regional);
    await expect(page).toHaveURL(/\/tickets$/);
    await ctx.close();
  });

  test('unsaved-changes guard: template builder, checklist fill and AI rule editor ask before leaving', async ({ pageAs, api }) => {
    // template builder (regional manager can edit templates)
    const reg = await pageAs('admin');
    await reg.goto('/checklists/templates/new');
    await settle(reg, 'page-template-builder');
    await reg.getByTestId('input-template-name').fill(`Unsaved ${uid()}`);
    await reg.getByTestId('nav-dashboard').or(reg.getByTestId('rail-home')).first().click();
    const dlg = reg.locator('mat-dialog-container');
    await expect(dlg).toContainText('Leave without saving?');
    await dlg.getByTestId('btn-cancel').click();
    await expect(reg).toHaveURL(/\/checklists\/templates\/new$/);
    await expect(reg.getByTestId('input-template-name')).toHaveValue(/^Unsaved /);
    await reg.getByTestId('rail-home').click();
    await dlg.getByTestId('btn-confirm').click();
    await expect(reg).toHaveURL(/\/dashboard$/);

    // AI rule editor
    await reg.goto('/ai-manager/rules/new');
    await settle(reg, 'page-ai-rule-editor');
    const name = reg.getByTestId('input-ai-rule-name');
    await name.fill(`Unsaved rule ${uid()}`);
    await reg.getByTestId('rail-home').click();
    await expect(dlg).toContainText('Leave without saving?');
    await dlg.getByTestId('btn-cancel').click();
    await expect(reg).toHaveURL(/\/ai-manager\/rules\/new$/);
    // an untouched existing rule leaves without asking
    const rule = (await (await api('admin')).get('/api/ai-manager/rules'))[0];
    await reg.goto(`/ai-manager/rules/${rule.id}`);
    await expect(dlg).toHaveCount(0);
    await settle(reg, 'page-ai-rule-editor');
    await reg.getByTestId('rail-home').click();
    await expect(reg).toHaveURL(/\/dashboard$/);
    await expect(dlg).toHaveCount(0);

    // checklist fill (staff)
    const admin = await api('admin');
    const me = await (await api('staff')).get('/api/auth/me');
    const tpl = await admin.post('/api/checklists/templates', {
      name: `E2E guard ${uid()}`, description: '', category: 'OPENING', frequency: 'DAILY', isActive: true,
      questions: [{ section: 'General', text: 'Lights on?', type: 'YES_NO', required: true, weight: 1, requiresPhoto: false, sortOrder: 0 }],
    });
    const a = await admin.post('/api/checklists/assignments', { templateId: tpl.id, storeId: 1, assigneeId: me.id, dueDate: todayLocal() });
    const staff = await pageAs('staff');
    await staff.goto(`/checklists/fill/${a.id}`);
    await settle(staff, 'page-checklist-fill');
    await staff.getByTestId(`input-answer-${tpl.questions[0].id}`).getByTestId('answer-yes').click();
    await staff.getByTestId('rail-trax').or(staff.getByTestId('nav-tasks')).first().click();
    await staff.getByTestId('nav-tasks').click();
    const sdlg = staff.locator('mat-dialog-container');
    await expect(sdlg).toContainText('Leave without saving?');
    await sdlg.getByTestId('btn-cancel').click();
    await expect(staff).toHaveURL(new RegExp(`/checklists/fill/${a.id}$`));
    await expect(staff.getByTestId(`input-answer-${tpl.questions[0].id}`).getByTestId('answer-yes')).toHaveClass(/checked/);
  });
});
