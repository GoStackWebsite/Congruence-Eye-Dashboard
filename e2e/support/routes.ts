/**
 * Catalogue of every SPA route (frontend/src/app/app.routes.ts + feature route files) with the permission that guards
 * it (frontend/src/app/core/auth/permissions.ts). Used by the edge-* sweeps (overflow, console, axe, empty store,
 * role access). Dynamic ids are resolved from the seeded data at run time (`resolveRoutes`).
 */
import { RoleKey } from './env';
import { Api } from './fixtures';

type Role = 'SUPER_ADMIN' | 'ADMIN' | 'REGIONAL_MANAGER' | 'STORE_MANAGER' | 'AUDITOR' | 'STAFF';
export const ROLE_OF: Record<RoleKey, Role> = { admin: 'SUPER_ADMIN', regional: 'REGIONAL_MANAGER', manager: 'STORE_MANAGER', auditor: 'AUDITOR', staff: 'STAFF' };

const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN'];
const SM_PLUS: Role[] = [...ADMINS, 'REGIONAL_MANAGER', 'STORE_MANAGER'];
const ANALYTICS: Role[] = [...SM_PLUS, 'AUDITOR'];
const ALL: Role[] = [...ANALYTICS, 'STAFF'];
const TEMPLATES: Role[] = [...ADMINS, 'REGIONAL_MANAGER', 'AUDITOR'];
const NOT_STAFF: Role[] = [...SM_PLUS, 'AUDITOR'];

export interface RouteDef {
  /** URL; `{template}`, `{assignment}`, `{submission}`, `{ticket}`, `{rule}`, `{alert}` are resolved at run time. */
  path: string;
  /** data-testid of the page root that proves the page rendered. */
  page: string;
  roles: Role[];
  /** Page shows the global filter (analytics-style data pages). */
  filter?: boolean;
  /** Analytics / ops page that must show an empty state for a store without data. */
  data?: boolean;
}

export const ROUTES: RouteDef[] = [
  { path: '/dashboard', page: 'page-dashboard', roles: ANALYTICS, filter: true, data: true },
  { path: '/live', page: 'page-live', roles: SM_PLUS, data: true },
  { path: '/analytics/traffic', page: 'page-traffic', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/demographics', page: 'page-demographics', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/zones', page: 'page-zones', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/heatmap', page: 'page-heatmap', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/journey', page: 'page-journey', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/conversion', page: 'page-conversion', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/queue', page: 'page-queue', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/store-ops', page: 'page-store-ops', roles: ANALYTICS, filter: true, data: true },
  { path: '/analytics/benchmark', page: 'page-benchmark', roles: ANALYTICS, filter: true, data: true },
  { path: '/traffic/image-directory', page: 'page-image-directory', roles: ANALYTICS, filter: true, data: true },
  { path: '/traffic/recap', page: 'page-recap', roles: ANALYTICS, filter: true, data: true },
  { path: '/alerts', page: 'page-alerts', roles: SM_PLUS, data: true },
  { path: '/alerts/{alert}', page: 'page-alerts', roles: SM_PLUS },
  { path: '/infra-health', page: 'page-infra-health', roles: SM_PLUS, data: true },
  { path: '/ai-manager/summary', page: 'page-ai-summary', roles: ANALYTICS, filter: true, data: true },
  { path: '/ai-manager/detections', page: 'page-ai-detections', roles: ANALYTICS, filter: true, data: true },
  { path: '/ai-manager/open-close', page: 'page-ai-open-close', roles: ANALYTICS, filter: true, data: true },
  { path: '/ai-manager/rules', page: 'page-ai-rules', roles: ANALYTICS },
  { path: '/ai-manager/rules/new', page: 'page-ai-rule-editor', roles: ANALYTICS },
  { path: '/ai-manager/rules/{rule}', page: 'page-ai-rule-editor', roles: ANALYTICS },
  { path: '/checklists', page: 'page-checklist-templates', roles: TEMPLATES },
  { path: '/checklists/templates/new', page: 'page-template-builder', roles: TEMPLATES },
  { path: '/checklists/templates/{template}', page: 'page-template-builder', roles: TEMPLATES },
  { path: '/checklists/dashboard', page: 'page-checklist-dashboard', roles: ANALYTICS, filter: true, data: true },
  { path: '/checklists/schedules', page: 'page-checklist-schedules', roles: NOT_STAFF },
  { path: '/checklists/assignments', page: 'page-checklist-assignments', roles: ALL },
  { path: '/checklists/fill/{assignment}', page: 'page-checklist-fill', roles: ALL },
  { path: '/checklists/submissions', page: 'page-checklist-submissions', roles: NOT_STAFF, filter: true, data: true },
  { path: '/checklists/submissions/{submission}', page: 'page-submission-detail', roles: ALL },
  { path: '/checklists/compliance', page: 'page-compliance', roles: ANALYTICS, filter: true, data: true },
  { path: '/tasks', page: 'page-tasks', roles: ALL },
  { path: '/tickets', page: 'page-tickets', roles: ALL },
  { path: '/tickets/{ticket}', page: 'page-ticket-detail', roles: ALL },
  { path: '/documents', page: 'page-documents', roles: ALL },
  { path: '/vendors', page: 'page-vendors', roles: SM_PLUS },
  { path: '/reports', page: 'page-reports', roles: ANALYTICS, filter: true },
  { path: '/admin/stores', page: 'page-admin-stores', roles: ADMINS },
  { path: '/admin/stores/1', page: 'page-admin-store', roles: ADMINS },
  { path: '/admin/stores/1/cameras', page: 'page-admin-cameras', roles: ADMINS },
  { path: '/admin/stores/1/zones', page: 'page-admin-store', roles: ADMINS },
  { path: '/admin/stores/1/recorders', page: 'page-admin-store', roles: ADMINS },
  { path: '/admin/stores/1/edge', page: 'page-admin-store', roles: ADMINS },
  { path: '/admin/stores/1/staff', page: 'page-admin-store', roles: ADMINS },
  { path: '/admin/regions', page: 'page-admin-regions', roles: ADMINS },
  { path: '/admin/edge-devices', page: 'page-admin-edge-devices', roles: ADMINS },
  { path: '/admin/users', page: 'page-admin-users', roles: ADMINS },
  { path: '/admin/staff', page: 'page-admin-staff', roles: SM_PLUS },
  { path: '/admin/alert-rules', page: 'page-admin-alert-rules', roles: ADMINS },
  { path: '/admin/settings', page: 'page-admin-settings', roles: ADMINS },
  { path: '/admin/audit-log', page: 'page-admin-audit-log', roles: ADMINS },
  { path: '/this-page-does-not-exist', page: 'page-not-found', roles: ALL },
];

export const allowed = (r: RouteDef, role: RoleKey) => r.roles.includes(ROLE_OF[role]);

/** The route list for a role, with run-time ids filled in (store-scoped ids for managers / staff). */
export async function resolveRoutes(api: Api, role: RoleKey): Promise<{ def: RouteDef; url: string }[]> {
  const ids: Record<string, string> = {};
  const first = <T>(x: T[] | { items: T[] }) => (Array.isArray(x) ? x : x.items)[0];
  const lazy: Record<string, () => Promise<string | undefined>> = {
    template: async () => String(first(await api.get('/api/checklists/templates'))?.['id' as never] ?? ''),
    assignment: async () => {
      const list = await api.get('/api/checklists/assignments', { status: 'PENDING', pageSize: 50 });
      const rows = (Array.isArray(list) ? list : list.items) as { id: number; dueDate: string }[];
      return rows.length ? String(rows.sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0].id) : undefined;
    },
    submission: async () => String((first(await api.get('/api/checklists/submissions', { pageSize: 1 })) as { id: number })?.id ?? ''),
    ticket: async () => String((first(await api.get('/api/tickets', { pageSize: 1 })) as { id: number })?.id ?? ''),
    rule: async () => String((first(await api.get('/api/ai-manager/rules')) as { id: number })?.id ?? ''),
    alert: async () => String((first(await api.get('/api/alerts', { pageSize: 1 })) as { id: number })?.id ?? ''),
  };
  const out: { def: RouteDef; url: string }[] = [];
  for (const def of ROUTES.filter((r) => allowed(r, role))) {
    let url = def.path;
    let ok = true;
    for (const m of def.path.matchAll(/\{(\w+)\}/g)) {
      if (!(m[1] in ids)) ids[m[1]] = (await lazy[m[1]]().catch(() => undefined)) ?? '';
      if (!ids[m[1]]) ok = false;
      url = url.replace(m[0], ids[m[1]]);
    }
    if (ok) out.push({ def, url });
  }
  return out;
}
