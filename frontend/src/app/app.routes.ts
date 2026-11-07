import { inject } from '@angular/core';
import { Routes } from '@angular/router';
import { AuthService } from './core/auth/auth.service';
import { authGuard, guestGuard, permissionGuard } from './core/auth/guards';
import { DEV_ROUTES } from './dev/dev.routes';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    title: 'Sign in · Congruence Eye',
    loadComponent: () => import('./features/auth/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then((m) => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: () => inject(AuthService).homeRoute() },
      {
        path: 'dashboard',
        title: 'Dashboard · Congruence Eye',
        data: { filter: true },
        canActivate: [permissionGuard('dashboard')],
        loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'live',
        title: 'Live · Congruence Eye',
        canActivate: [permissionGuard('live')],
        loadComponent: () => import('./features/live/live.page').then((m) => m.LivePage),
      },
      {
        path: 'analytics',
        data: { filter: true },
        canActivate: [permissionGuard('analytics')],
        loadChildren: () => import('./features/analytics/analytics.routes').then((m) => m.ANALYTICS_ROUTES),
      },
      {
        path: 'alerts',
        title: 'Alerts · Congruence Eye',
        canActivate: [permissionGuard('alerts')],
        loadComponent: () => import('./features/alerts/alerts.page').then((m) => m.AlertsPage),
      },
      {
        // notification deep link (/alerts/:id) — the page highlights that alert
        path: 'alerts/:alertId',
        title: 'Alert · Congruence Eye',
        data: { crumb: 'Alert' },
        canActivate: [permissionGuard('alerts')],
        loadComponent: () => import('./features/alerts/alerts.page').then((m) => m.AlertsPage),
      },
      {
        path: 'traffic/image-directory',
        title: 'Image directory · Congruence Eye',
        data: { filter: true },
        canActivate: [permissionGuard('imageDirectory')],
        loadComponent: () => import('./features/traffic/image-directory.page').then((m) => m.ImageDirectoryPage),
      },
      {
        path: 'traffic/recap',
        title: 'Recap video · Congruence Eye',
        data: { filter: true },
        canActivate: [permissionGuard('recap')],
        loadComponent: () => import('./features/traffic/recap.page').then((m) => m.RecapPage),
      },
      {
        path: 'infra-health',
        title: 'Infra health · Congruence Eye',
        canActivate: [permissionGuard('infraHealth')],
        loadComponent: () => import('./features/infra/infra-health.page').then((m) => m.InfraHealthPage),
      },
      {
        path: 'ai-manager',
        canActivate: [permissionGuard('aiManager')],
        loadChildren: () => import('./features/ai-manager/ai-manager.routes').then((m) => m.AI_MANAGER_ROUTES),
      },
      // alert notifications link to /alerts/<id> (backend NotificationService) → show the alerts list
      { path: 'alerts/:id', redirectTo: 'alerts' },
      {
        path: 'checklists',
        loadChildren: () => import('./features/checklists/checklists.routes').then((m) => m.CHECKLIST_ROUTES),
      },
      {
        path: 'tasks',
        title: 'Tasks · Congruence Eye',
        canActivate: [permissionGuard('tasks')],
        loadComponent: () => import('./features/tasks/tasks.page').then((m) => m.TasksPage),
      },
      {
        path: 'tickets',
        canActivate: [permissionGuard('tickets')],
        loadChildren: () => import('./features/tickets/tickets.routes').then((m) => m.TICKET_ROUTES),
      },
      {
        path: 'documents',
        title: 'Documents · Congruence Eye',
        canActivate: [permissionGuard('documents')],
        loadComponent: () => import('./features/documents/documents.page').then((m) => m.DocumentsPage),
      },
      {
        path: 'vendors',
        title: 'Vendors · Congruence Eye',
        canActivate: [permissionGuard('vendors')],
        loadComponent: () => import('./features/vendors/vendors.page').then((m) => m.VendorsPage),
      },
      {
        path: 'reports',
        title: 'Reports · Congruence Eye',
        data: { filter: true },
        canActivate: [permissionGuard('reports')],
        loadComponent: () => import('./features/reports/reports.page').then((m) => m.ReportsPage),
      },
      {
        path: 'admin',
        loadChildren: () => import('./features/admin/admin.routes').then((m) => m.ADMIN_ROUTES),
      },
      // dev-only (/_styleguide) — empty outside the development build
      ...DEV_ROUTES,
      {
        path: '**',
        title: 'Not found · Congruence Eye',
        loadComponent: () => import('./features/not-found.page').then((m) => m.NotFoundPage),
      },
    ],
  },
];
