import { test, expect } from '../support/fixtures';
import { RoleKey } from '../support/env';

const V2_ANALYTICS = ['image-directory', 'recap', 'checklist-dashboard', 'checklist-schedules', 'ai-detections', 'ai-summary', 'ai-open-close', 'ai-rules'];
const ALL_NAV = [
  ...V2_ANALYTICS, 'infra-health',
  'dashboard', 'live', 'traffic', 'demographics', 'zones', 'heatmap', 'journey', 'conversion', 'queue', 'store-ops', 'benchmark',
  'alerts', 'checklist-templates', 'checklist-assignments', 'checklist-submissions', 'compliance', 'tasks', 'tickets', 'documents',
  'vendors', 'reports', 'admin-stores', 'admin-regions', 'admin-edge-devices', 'admin-users', 'admin-staff', 'admin-alert-rules',
  'admin-settings', 'admin-audit-log',
];
const ANALYTICS = ['traffic', 'demographics', 'zones', 'heatmap', 'journey', 'conversion', 'queue', 'store-ops', 'benchmark'];
const ADMIN_MASTER = ['admin-stores', 'admin-regions', 'admin-edge-devices', 'admin-users', 'admin-alert-rules', 'admin-settings', 'admin-audit-log'];
const OPS_SM = ['alerts', 'checklist-assignments', 'checklist-submissions', 'compliance', 'tasks', 'tickets', 'documents', 'vendors', 'reports'];

// Expected menu per role (frontend/README.md "Role → menu mapping")
const EXPECTED_NAV: Record<RoleKey, string[]> = {
  admin: ALL_NAV,
  regional: ['dashboard', 'live', 'infra-health', ...ANALYTICS, ...V2_ANALYTICS, ...OPS_SM, 'checklist-templates', 'admin-staff'],
  manager: ['dashboard', 'live', 'infra-health', ...ANALYTICS, ...V2_ANALYTICS, ...OPS_SM, 'admin-staff'],
  auditor: ['dashboard', ...ANALYTICS, ...V2_ANALYTICS, 'checklist-templates', 'checklist-assignments', 'checklist-submissions', 'compliance', 'tasks', 'tickets', 'documents', 'reports'],
  staff: ['checklist-assignments', 'tasks', 'tickets', 'documents'],
};

test.describe('RBAC: menu visibility', () => {
  for (const role of Object.keys(EXPECTED_NAV) as RoleKey[]) {
    test(`${role} sees exactly the expected menu`, async ({ pageAs }) => {
      const page = await pageAs(role);
      await page.goto(role === 'staff' ? '/tasks' : '/dashboard');
      // shell: icon rail (one item per module) + module panel listing that module's pages
      const nav = page.getByTestId('sidenav');
      const rail = nav.locator('[data-testid^="rail-"]:not([data-testid="rail-user"])');
      await expect(rail.first()).toBeVisible();
      const modules = await rail.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace(/^rail-/, '')));
      const seen: string[] = [];
      for (const m of modules) {
        const item = nav.getByTestId(`rail-${m}`);
        await item.click();
        await expect(nav.locator('.mp-title')).toHaveText((await item.getAttribute('aria-label'))!);
        const links = nav.locator('.module-panel [data-testid^="nav-"]:not([data-testid^="nav-group-"]):not([data-testid^="nav-badge-"])');
        await expect(links.first()).toBeVisible();
        seen.push(...(await links.evaluateAll((els) => els.map((e) => e.getAttribute('data-testid')!.replace(/^nav-/, '')))));
      }
      // every expected page exactly once, nothing else
      expect([...seen].sort()).toEqual([...EXPECTED_NAV[role]].sort());
      if (role === 'staff') {
        await nav.getByTestId('rail-trax').click();
        await expect(nav.getByTestId('nav-checklist-assignments')).toContainText('My checklists');
        await expect(nav.getByTestId('nav-tasks')).toContainText('My tasks');
        await expect(nav.getByTestId('rail-admin')).toHaveCount(0);
        await expect(nav.getByTestId('rail-traffic')).toHaveCount(0);
      }
      if (role === 'auditor') {
        await expect(nav.getByTestId('rail-traffic')).toBeVisible();
        await expect(nav.getByTestId('rail-admin')).toHaveCount(0);
      }
    });
  }
});

test.describe('RBAC: route guards', () => {
  test('STAFF is redirected to /tasks from admin and analytics routes', async ({ pageAs }) => {
    const page = await pageAs('staff');
    for (const url of ['/admin/users', '/analytics/traffic', '/analytics/benchmark', '/dashboard', '/alerts', '/checklists', '/vendors', '/reports']) {
      await page.goto(url);
      await expect(page, `STAFF → ${url}`).toHaveURL(/\/tasks$/);
      await expect(page.getByTestId('page-tasks')).toBeVisible();
    }
    // allowed pages still open
    for (const [url, id] of [['/tickets', 'page-tickets'], ['/documents', 'page-documents'], ['/checklists/assignments', 'page-checklist-assignments']]) {
      await page.goto(url);
      await expect(page.getByTestId(id)).toBeVisible();
    }
  });

  test('AUDITOR can open analytics and checklists but not admin, alerts or live', async ({ pageAs }) => {
    const page = await pageAs('auditor');
    for (const [url, id] of [
      ['/analytics/traffic', 'page-traffic'],
      ['/analytics/zones', 'page-zones'],
      ['/checklists', 'page-checklist-templates'],
      ['/checklists/compliance', 'page-compliance'],
      ['/checklists/submissions', 'page-checklist-submissions'],
    ]) {
      await page.goto(url);
      await expect(page.getByTestId(id), url).toBeVisible();
    }
    for (const url of ['/admin/users', '/admin/stores', '/admin/settings', '/alerts', '/live', '/vendors']) {
      await page.goto(url);
      await expect(page, `AUDITOR → ${url}`).toHaveURL(/\/dashboard$/);
    }
  });

  test('STORE_MANAGER only sees T Nagar in the store filter and its data is scoped', async ({ pageAs, api }) => {
    const page = await pageAs('manager');
    await page.goto('/dashboard');
    await expect(page.getByTestId('kpi-footfall').getByTestId('kpi-value')).not.toHaveText(/^\s*(—|--)?\s*$/);
    await page.getByTestId('filter-stores').click();
    const options = page.locator('.cdk-overlay-pane mat-option');
    await expect(options).toHaveCount(1);
    await expect(page.getByTestId('filter-store-option-1')).toHaveText(/T Nagar/);
    await page.keyboard.press('Escape');

    const mgr = await api('manager');
    const stores = await mgr.get('/api/stores');
    expect(stores.map((s: any) => s.id)).toEqual([1]);
    // single-store request outside scope → 403
    const r = await mgr.ctx.get('/api/stores/2');
    expect(r.status()).toBe(403);
    // list requests outside scope are silently filtered
    const bench = await mgr.get('/api/analytics/benchmark', { storeIds: '1,2,3' });
    expect(bench.map((b: any) => b.storeId)).toEqual([1]);
    // admin pages are blocked in the UI
    await page.goto('/admin/users');
    await expect(page).toHaveURL(/\/dashboard$/);
  });

  test('regional manager sees only the Chennai stores in the filter', async ({ pageAs }) => {
    const page = await pageAs('regional');
    await page.goto('/dashboard');
    await expect(page.getByTestId('kpi-footfall').getByTestId('kpi-value')).not.toHaveText(/^\s*(—|--)?\s*$/);
    await page.getByTestId('filter-stores').click();
    await expect(page.locator('.cdk-overlay-pane mat-option')).toHaveCount(5);
    await expect(page.getByTestId('filter-store-option-6')).toHaveCount(0);
    await page.keyboard.press('Escape');
  });

  test('API enforces write permissions (403 for STAFF on master data)', async ({ api }) => {
    const staff = await api('staff');
    const r = await staff.ctx.post('/api/stores', {
      data: { code: 'X-1', name: 'Nope', regionId: 1, city: 'Chennai', address: 'x', timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:00', areaSqft: 100 },
    });
    expect(r.status()).toBe(403);
    expect((await r.json()).statusCode).toBe(403);
    for (const [method, url, data] of [
      ['post', '/api/users', { email: 'x@y.in', name: 'x', role: 'STAFF', password: 'Password@123' }],
      ['post', '/api/alert-rules', { name: 'x', metric: 'QUEUE_LENGTH', threshold: 1, severity: 'LOW', channels: ['IN_APP'], cooldownMin: 1 }],
      ['put', '/api/settings', { companyName: 'Hacked' }],
      ['post', '/api/alerts/evaluate', {}],
      ['post', '/api/checklists/templates', { name: 'x', category: 'OTHER', frequency: 'ADHOC', questions: [] }],
    ] as const) {
      const res = await (staff.ctx as any)[method](url, { data });
      expect(res.status(), `${method.toUpperCase()} ${url}`).toBe(403);
    }
    const auditor = await api('auditor');
    expect((await auditor.ctx.post('/api/staff', { data: { storeId: 1, code: 'Z', name: 'Z', designation: 'x', shiftStart: '10:00', shiftEnd: '18:00' } })).status()).toBe(403);
    expect((await auditor.ctx.get('/api/audit-logs')).status()).toBe(403);
    // unauthenticated → 401
    const anon = await staff.ctx.get('/api/stores', { headers: { Authorization: '' } });
    expect(anon.status()).toBe(401);
  });
});
