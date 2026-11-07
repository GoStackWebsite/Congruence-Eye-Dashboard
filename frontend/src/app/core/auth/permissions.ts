import { Role } from '../models/api.models';

export const ADMINS: Role[] = ['SUPER_ADMIN', 'ADMIN'];
export const SM_PLUS: Role[] = ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER'];
export const ANALYTICS_ROLES: Role[] = [...SM_PLUS, 'AUDITOR'];
export const ALL_ROLES: Role[] = [...ANALYTICS_ROLES, 'STAFF'];

/**
 * Feature → roles allowed. Used by the sidenav, route guards (`data.roles`) and
 * in-page action visibility. Mirrors the "Write permissions" in API_CONTRACT.md.
 */
export const PERMISSIONS = {
  // page access
  dashboard: ANALYTICS_ROLES,
  analytics: ANALYTICS_ROLES,
  live: SM_PLUS,
  alerts: SM_PLUS,
  checklistTemplates: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'AUDITOR'] as Role[],
  checklistAssignments: ALL_ROLES,
  checklistSubmissions: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR'] as Role[],
  compliance: ANALYTICS_ROLES,
  tasks: ALL_ROLES,
  tickets: ALL_ROLES,
  documents: ALL_ROLES,
  vendors: SM_PLUS,
  reports: ANALYTICS_ROLES,
  adminMaster: ADMINS,
  adminStaff: SM_PLUS,
  // actions
  manageTemplates: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'AUDITOR'] as Role[],
  assignChecklists: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR'] as Role[],
  reviewSubmissions: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR'] as Role[],
  createTasks: SM_PLUS,
  verifyTasks: SM_PLUS,
  manageTickets: SM_PLUS,
  uploadDocuments: SM_PLUS,
  manageVendors: SM_PLUS,
  manageAlerts: SM_PLUS,
  evaluateAlerts: ADMINS,
  posImport: SM_PLUS,
  // v2
  imageDirectory: ANALYTICS_ROLES,
  recap: ANALYTICS_ROLES,
  generateRecap: SM_PLUS,
  infraHealth: SM_PLUS,
  checklistDashboard: ANALYTICS_ROLES,
  checklistSchedules: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER', 'STORE_MANAGER', 'AUDITOR'] as Role[],
  aiManager: ANALYTICS_ROLES,
  manageAiRules: ['SUPER_ADMIN', 'ADMIN', 'REGIONAL_MANAGER'] as Role[],
  reviewDetections: SM_PLUS,
  runNudges: ADMINS,
} satisfies Record<string, Role[]>;

export type Permission = keyof typeof PERMISSIONS;

export function can(role: Role | null | undefined, permission: Permission): boolean {
  return !!role && (PERMISSIONS[permission] as Role[]).includes(role);
}

export function isAdmin(role: Role | null | undefined): boolean {
  return !!role && ADMINS.includes(role);
}

/** Landing page after login per role. */
export function homeRouteFor(role: Role | null | undefined): string {
  if (role === 'STAFF') return '/tasks';
  return '/dashboard';
}

export interface NavItem {
  id: string; // used for data-testid="nav-<id>"
  label: string;
  icon: string;
  route: string;
  permission: Permission;
  exact?: boolean;
  /** Live count badge key (see NavCountsService). */
  badge?: NavBadge;
}
export type NavBadge = 'alerts' | 'overdue' | 'tickets';
export interface NavGroup {
  id: string;
  label: string;
  items: NavItem[];
}
/** A rail module: icon in the 64px rail, its pages grouped in the 224px module panel. */
export interface NavModule {
  id: string; // data-testid="rail-<id>"
  label: string;
  icon: string;
  groups: NavGroup[];
  /** All visible items of the module, flattened (group order). */
  items: NavItem[];
}
/** Back-compat alias: a "section" is a module. */
export type NavSection = NavModule;

type ModuleDef = Omit<NavModule, 'items'>;

export const NAV_MODULES: ModuleDef[] = [
  {
    id: 'home',
    label: 'Home',
    icon: 'home',
    groups: [{ id: 'home', label: 'Overview', items: [{ id: 'dashboard', label: 'Dashboard', icon: 'space_dashboard', route: '/dashboard', permission: 'dashboard' }] }],
  },
  {
    id: 'traffic',
    label: 'Traffic',
    icon: 'directions_walk',
    groups: [
      {
        id: 'traffic-analytics',
        label: 'Analytics',
        items: [
          { id: 'traffic', label: 'Footfall & funnel', icon: 'directions_walk', route: '/analytics/traffic', permission: 'analytics' },
          { id: 'demographics', label: 'Demographics', icon: 'groups', route: '/analytics/demographics', permission: 'analytics' },
          { id: 'heatmap', label: 'Heatmap', icon: 'blur_on', route: '/analytics/heatmap', permission: 'analytics' },
          { id: 'benchmark', label: 'Benchmark', icon: 'leaderboard', route: '/analytics/benchmark', permission: 'analytics' },
        ],
      },
      {
        id: 'traffic-media',
        label: 'Media',
        items: [
          { id: 'image-directory', label: 'Image directory', icon: 'photo_library', route: '/traffic/image-directory', permission: 'imageDirectory' },
          { id: 'recap', label: 'Recap video', icon: 'movie', route: '/traffic/recap', permission: 'recap' },
        ],
      },
    ],
  },
  {
    id: 'zone',
    label: 'Zone',
    icon: 'grid_view',
    groups: [
      {
        id: 'zone-analytics',
        label: 'Analytics',
        items: [
          { id: 'zones', label: 'Zone concentration', icon: 'grid_view', route: '/analytics/zones', permission: 'analytics' },
          { id: 'journey', label: 'Customer journey', icon: 'route', route: '/analytics/journey', permission: 'analytics' },
        ],
      },
    ],
  },
  {
    id: 'revenue',
    label: 'Revenue',
    icon: 'payments',
    groups: [
      {
        id: 'revenue-analytics',
        label: 'Analytics',
        items: [
          { id: 'conversion', label: 'Conversion', icon: 'shopping_cart_checkout', route: '/analytics/conversion', permission: 'analytics' },
          { id: 'queue', label: 'Queue', icon: 'queue', route: '/analytics/queue', permission: 'analytics' },
        ],
      },
    ],
  },
  {
    id: 'trax',
    label: 'Trax',
    icon: 'fact_check',
    groups: [
      {
        id: 'trax-overview',
        label: 'Overview',
        items: [
          { id: 'checklist-dashboard', label: 'Dashboard', icon: 'insights', route: '/checklists/dashboard', permission: 'checklistDashboard' },
          { id: 'compliance', label: 'Compliance', icon: 'verified', route: '/checklists/compliance', permission: 'compliance' },
        ],
      },
      {
        id: 'trax-manage',
        label: 'Manage',
        items: [
          { id: 'checklist-templates', label: 'Checklists', icon: 'fact_check', route: '/checklists', permission: 'checklistTemplates', exact: true },
          { id: 'checklist-schedules', label: 'Schedules', icon: 'event_repeat', route: '/checklists/schedules', permission: 'checklistSchedules' },
          { id: 'checklist-assignments', label: 'Assignments', icon: 'assignment_ind', route: '/checklists/assignments', permission: 'checklistAssignments', badge: 'overdue' },
          { id: 'checklist-submissions', label: 'Submissions', icon: 'inventory', route: '/checklists/submissions', permission: 'checklistSubmissions' },
        ],
      },
      {
        id: 'trax-tasks',
        label: 'Tasks',
        items: [{ id: 'tasks', label: 'Tasks', icon: 'task_alt', route: '/tasks', permission: 'tasks' }],
      },
    ],
  },
  {
    id: 'ai-manager',
    label: 'AI Manager',
    icon: 'smart_toy',
    groups: [
      {
        id: 'ai-monitor',
        label: 'Monitor',
        items: [
          { id: 'ai-summary', label: 'Summary', icon: 'donut_small', route: '/ai-manager/summary', permission: 'aiManager' },
          { id: 'ai-detections', label: 'Detections', icon: 'center_focus_strong', route: '/ai-manager/detections', permission: 'aiManager' },
          { id: 'ai-open-close', label: 'Store open / close', icon: 'door_open', route: '/ai-manager/open-close', permission: 'aiManager' },
        ],
      },
      {
        id: 'ai-manage',
        label: 'Manage',
        items: [{ id: 'ai-rules', label: 'AI checklists', icon: 'smart_toy', route: '/ai-manager/rules', permission: 'aiManager' }],
      },
    ],
  },
  {
    id: 'store-ops',
    label: 'Store Ops',
    icon: 'storefront',
    groups: [
      {
        id: 'ops-monitor',
        label: 'Monitor',
        items: [
          { id: 'live', label: 'Live view', icon: 'sensors', route: '/live', permission: 'live' },
          { id: 'alerts', label: 'Alerts', icon: 'notifications_active', route: '/alerts', permission: 'alerts', badge: 'alerts' },
          { id: 'store-ops', label: 'Store activity', icon: 'storefront', route: '/analytics/store-ops', permission: 'analytics' },
          { id: 'infra-health', label: 'Infra health', icon: 'monitor_heart', route: '/infra-health', permission: 'infraHealth' },
        ],
      },
      {
        id: 'ops-service',
        label: 'Service',
        items: [
          { id: 'tickets', label: 'Tickets', icon: 'confirmation_number', route: '/tickets', permission: 'tickets', badge: 'tickets' },
          { id: 'documents', label: 'Documents', icon: 'folder_open', route: '/documents', permission: 'documents' },
          { id: 'vendors', label: 'Vendors', icon: 'handshake', route: '/vendors', permission: 'vendors' },
        ],
      },
    ],
  },
  {
    id: 'reports',
    label: 'Reports',
    icon: 'summarize',
    groups: [{ id: 'reports', label: 'Reports', items: [{ id: 'reports', label: 'Reports & exports', icon: 'summarize', route: '/reports', permission: 'reports' }] }],
  },
  {
    id: 'admin',
    label: 'Admin',
    icon: 'settings',
    groups: [
      {
        id: 'admin-master',
        label: 'Master data',
        items: [
          { id: 'admin-stores', label: 'Stores', icon: 'store', route: '/admin/stores', permission: 'adminMaster' },
          { id: 'admin-regions', label: 'Regions', icon: 'map', route: '/admin/regions', permission: 'adminMaster' },
          { id: 'admin-edge-devices', label: 'Edge devices', icon: 'router', route: '/admin/edge-devices', permission: 'adminMaster' },
        ],
      },
      {
        id: 'admin-people',
        label: 'People',
        items: [
          { id: 'admin-users', label: 'Users', icon: 'manage_accounts', route: '/admin/users', permission: 'adminMaster' },
          { id: 'admin-staff', label: 'Staff roster', icon: 'badge', route: '/admin/staff', permission: 'adminStaff' },
        ],
      },
      {
        id: 'admin-system',
        label: 'System',
        items: [
          { id: 'admin-alert-rules', label: 'Alert rules', icon: 'rule', route: '/admin/alert-rules', permission: 'adminMaster' },
          { id: 'admin-settings', label: 'Settings', icon: 'settings', route: '/admin/settings', permission: 'adminMaster' },
          { id: 'admin-audit-log', label: 'Audit log', icon: 'history', route: '/admin/audit-log', permission: 'adminMaster' },
        ],
      },
    ],
  },
];

/** Back-compat: the flat list of modules (each with its items) without role filtering. */
export const NAV: NavModule[] = NAV_MODULES.map((m) => ({ ...m, items: m.groups.flatMap((g) => g.items) }));

const staffLabel = (role: Role | null | undefined, i: NavItem): NavItem =>
  role === 'STAFF' && i.id === 'checklist-assignments'
    ? { ...i, label: 'My checklists' }
    : role === 'STAFF' && i.id === 'tasks'
      ? { ...i, label: 'My tasks' }
      : i;

/** Modules filtered for a role (empty groups/modules dropped). STAFF sees "My checklists" / "My tasks". */
export function navFor(role: Role | null | undefined): NavModule[] {
  return NAV_MODULES.map((m) => {
    const groups = m.groups
      .map((g) => ({ ...g, items: g.items.filter((i) => can(role, i.permission)).map((i) => staffLabel(role, i)) }))
      .filter((g) => g.items.length > 0);
    return { ...m, groups, items: groups.flatMap((g) => g.items) };
  }).filter((m) => m.items.length > 0);
}

/** Longest-prefix match of a URL path against the nav (for breadcrumbs and the active rail module). */
export function navMatch(modules: NavModule[], url: string): { module: NavModule; group: NavGroup; item: NavItem } | null {
  const path = url.split(/[?#]/)[0];
  let best: { module: NavModule; group: NavGroup; item: NavItem } | null = null;
  let bestLen = -1;
  for (const module of modules)
    for (const group of module.groups)
      for (const item of group.items) {
        const r = item.route;
        const hit = item.exact ? path === r : path === r || path.startsWith(r + '/');
        if (hit && r.length > bestLen) {
          best = { module, group, item };
          bestLen = r.length;
        }
      }
  return best;
}
