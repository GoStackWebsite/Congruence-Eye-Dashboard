import { test, expect, Api } from '../support/fixtures';
import { API_URL, PASSWORD, USERS, WEB_URL, uid } from '../support/env';
import { expectToast } from '../support/ui';

async function uiLogin(page: import('@playwright/test').Page, email: string, password: string) {
  await page.getByTestId('input-email').fill(email);
  await page.getByTestId('input-password').fill(password);
  await page.getByTestId('btn-login').click();
}

test.describe('Authentication', () => {
  test('login with valid credentials lands on the role home page and shows the user', async ({ page }) => {
    await page.goto('/login');
    await expect(page.getByTestId('page-login')).toBeVisible();
    await uiLogin(page, USERS.manager, PASSWORD);
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await page.getByTestId('user-menu').click();
    await expect(page.getByTestId('user-email')).toHaveText(USERS.manager);
    await expect(page.getByTestId('user-role')).toHaveText(/store manager/i);
  });

  test('STAFF lands on /tasks after login', async ({ page }) => {
    await page.goto('/login');
    await uiLogin(page, USERS.staff, PASSWORD);
    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('page-tasks')).toBeVisible();
  });

  test('wrong password shows the error message and stays on /login', async ({ page }) => {
    await page.goto('/login');
    await uiLogin(page, USERS.admin, 'wrong-password');
    await expect(page.getByTestId('login-error')).toHaveText(/Invalid email or password/);
    await expect(page).toHaveURL(/\/login/);
    // unknown user gets the same message (no user enumeration)
    await uiLogin(page, 'nobody@congruence.in', PASSWORD);
    await expect(page.getByTestId('login-error')).toHaveText(/Invalid email or password/);
  });

  test('API rejects bad credentials with 401', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: API_URL });
    const r = await ctx.post('/api/auth/login', { data: { email: USERS.admin, password: 'nope' } });
    expect(r.status()).toBe(401);
    const body = await r.json();
    expect(body.statusCode).toBe(401);
    await ctx.dispose();
  });

  test('health endpoint is public (through the web server proxy too) and /auth/me returns the user', async ({ playwright, api }) => {
    for (const base of [API_URL, WEB_URL]) {
      const ctx = await playwright.request.newContext({ baseURL: base });
      const r = await ctx.get('/api/health');
      expect(r.status(), base).toBe(200);
      expect(await r.json()).toMatchObject({ status: 'ok', db: 'up', time: expect.any(String) });
      expect((await ctx.get('/api/auth/me')).status()).toBe(401);
      await ctx.dispose();
    }
    const me = await (await api('manager')).get('/api/auth/me');
    expect(me).toMatchObject({ email: USERS.manager, role: 'STORE_MANAGER', isActive: true, storeIds: [1] });
  });

  test('protected route redirects to /login with returnUrl and returns there after login', async ({ page }) => {
    await page.goto('/analytics/traffic');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fanalytics%2Ftraffic/);
    await uiLogin(page, USERS.admin, PASSWORD);
    await expect(page).toHaveURL(/\/analytics\/traffic$/);
    await expect(page.getByTestId('page-traffic')).toBeVisible();
  });

  test('logout clears the session and protects routes again', async ({ pageAs }) => {
    const page = await pageAs('admin');
    await page.goto('/dashboard');
    await expect(page.getByTestId('page-dashboard')).toBeVisible();
    await page.getByTestId('user-menu').click();
    await page.getByTestId('btn-logout').click();
    await expect(page).toHaveURL(/\/login/);
    expect(await page.evaluate(() => localStorage.getItem('ce.token'))).toBeNull();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login\?returnUrl=%2Fdashboard/);
  });

  test('change password flow on a throwaway user', async ({ page, api }) => {
    const admin = await api('admin');
    const email = `${uid('pw')}@congruence.in`;
    const user = await admin.post('/api/users', { email, name: 'Throwaway PW', role: 'STORE_MANAGER', password: PASSWORD, storeIds: [1] });
    expect(user.id).toBeGreaterThan(0);
    const newPassword = 'NewPassw0rd!x';

    await page.goto('/login');
    await uiLogin(page, email, PASSWORD);
    await expect(page.getByTestId('page-dashboard')).toBeVisible();

    await page.getByTestId('user-menu').click();
    await page.getByTestId('btn-change-password').click();
    const dlg = page.getByTestId('dialog-change-password');
    await dlg.getByTestId('input-current-password').fill(PASSWORD);
    await dlg.getByTestId('input-new-password').fill(newPassword);
    await dlg.getByTestId('input-confirm-password').fill('Mismatch123!');
    await dlg.getByTestId('input-current-password').click(); // blur → touched
    await expect(dlg.getByTestId('error-mismatch')).toHaveText('Passwords do not match');
    await dlg.getByTestId('input-confirm-password').fill(newPassword);
    await expect(dlg.getByTestId('error-mismatch')).toBeHidden();
    await dlg.getByTestId('btn-save').click();
    await expectToast(page, 'Password updated');
    await expect(dlg).toBeHidden();

    // old password no longer works, new one does (API + UI)
    const r = await admin.ctx.post('/api/auth/login', { data: { email, password: PASSWORD } });
    expect(r.status()).toBe(401);
    await page.getByTestId('user-menu').click();
    await page.getByTestId('btn-logout').click();
    await uiLogin(page, email, PASSWORD);
    await expect(page.getByTestId('login-error')).toBeVisible();
    await uiLogin(page, email, newPassword);
    await expect(page.getByTestId('page-dashboard')).toBeVisible();

    // wrong current password is rejected by the API
    const self = await Api.login(email, newPassword);
    const bad = await self.ctx.post('/api/auth/change-password', { data: { currentPassword: 'wrong-one', newPassword: 'Another123!' } });
    expect([400, 401, 403]).toContain(bad.status());
    await self.dispose();
  });

  test('a 401 during the session (user deactivated) logs out to /login', async ({ page, api }) => {
    const admin = await api('admin');
    const email = `${uid('sess')}@congruence.in`;
    const user = await admin.post('/api/users', { email, name: 'Session Victim', role: 'REGIONAL_MANAGER', password: PASSWORD, storeIds: [1, 2] });
    await page.goto('/login');
    await uiLogin(page, email, PASSWORD);
    await expect(page.getByTestId('page-dashboard')).toBeVisible();

    await admin.delete(`/api/users/${user.id}`); // deactivate → token no longer accepted
    const me = await page.request.get('/api/auth/me', {
      headers: { Authorization: `Bearer ${await page.evaluate(() => localStorage.getItem('ce.token'))}` },
    });
    expect(me.status()).toBe(401);

    // rail module → navigates to Traffic (the panel only lists the open module). A background poll (notifications, nav
    // counts) may hit the 401 first and redirect before the click: both paths must end on /login.
    await page.getByTestId('rail-traffic').click({ timeout: 5_000 }).catch(() => undefined);
    await expect(page).toHaveURL(/\/login/);
    await expectToast(page, /session has expired/i);
    expect(await page.evaluate(() => localStorage.getItem('ce.token'))).toBeNull();
  });

  test('a tampered token is rejected and the SPA returns to /login', async ({ browser }) => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify({ sub: 1, email: USERS.admin, role: 'SUPER_ADMIN', exp: Math.floor(Date.now() / 1000) + 3600 })).toString('base64url');
    const forged = `${header}.${payload}.invalidsignature`;
    const ctx = await browser.newContext({
      baseURL: WEB_URL,
      storageState: {
        cookies: [],
        origins: [
          {
            origin: WEB_URL,
            localStorage: [
              { name: 'ce.token', value: forged },
              { name: 'ce.user', value: JSON.stringify({ id: 1, email: USERS.admin, name: 'Admin', role: 'SUPER_ADMIN', isActive: true, storeIds: [], createdAt: new Date().toISOString() }) },
            ],
          },
        ],
      },
    });
    const page = await ctx.newPage();
    await page.goto('/dashboard');
    await expect(page).toHaveURL(/\/login/);
    await ctx.close();
  });
});
