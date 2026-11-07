import { Routes, UrlMatchResult, UrlSegment } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';

const admin = [permissionGuard('adminMaster')];

/** Matches stores/:id and stores/:id/:tab. */
export function storeDetailMatcher(segs: UrlSegment[]): UrlMatchResult | null {
  if (segs.length < 2 || segs.length > 3 || segs[0].path !== 'stores' || !/^\d+$/.test(segs[1].path)) return null;
  const posParams: Record<string, UrlSegment> = { id: segs[1] };
  if (segs[2]) posParams['tab'] = segs[2];
  return { consumed: segs, posParams };
}

export const ADMIN_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'stores' },
  { path: 'stores', title: 'Stores · Admin', canActivate: admin, loadComponent: () => import('./stores.page').then((m) => m.StoresPage) },
  {
    // /admin/stores/:id and /admin/stores/:id/:tab share one route so switching tabs keeps the page
    matcher: storeDetailMatcher,
    data: { crumb: 'Store', navId: 'admin-stores' },
    title: 'Store · Admin',
    canActivate: admin,
    loadComponent: () => import('./store-detail.page').then((m) => m.StoreDetailPage),
  },
  { path: 'regions', title: 'Regions · Admin', canActivate: admin, loadComponent: () => import('./regions.page').then((m) => m.RegionsPage) },
  {
    path: 'edge-devices',
    title: 'Edge devices · Admin',
    canActivate: admin,
    loadComponent: () => import('./edge-devices.page').then((m) => m.EdgeDevicesPage),
  },
  { path: 'users', title: 'Users · Admin', canActivate: admin, loadComponent: () => import('./users.page').then((m) => m.UsersPage) },
  {
    path: 'staff',
    title: 'Staff roster · Admin',
    canActivate: [permissionGuard('adminStaff')],
    loadComponent: () => import('./staff.page').then((m) => m.StaffPage),
  },
  {
    path: 'alert-rules',
    title: 'Alert rules · Admin',
    canActivate: admin,
    loadComponent: () => import('./alert-rules.page').then((m) => m.AlertRulesPage),
  },
  { path: 'settings', title: 'Settings · Admin', canActivate: admin, loadComponent: () => import('./settings.page').then((m) => m.SettingsPage) },
  {
    path: 'audit-log',
    title: 'Audit log · Admin',
    canActivate: admin,
    loadComponent: () => import('./audit-log.page').then((m) => m.AuditLogPage),
  },
];
