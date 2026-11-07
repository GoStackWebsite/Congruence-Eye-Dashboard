import { Routes } from '@angular/router';
import { permissionGuard } from '../../core/auth/guards';
import { unsavedChangesGuard } from '../../shared/ds/unsaved-changes.guard';

export const CHECKLIST_ROUTES: Routes = [
  {
    path: '',
    pathMatch: 'full',
    title: 'Checklist templates · Congruence Eye',
    canActivate: [permissionGuard('checklistTemplates')],
    loadComponent: () => import('./templates.page').then((m) => m.TemplatesPage),
  },
  {
    path: 'templates/new',
    title: 'New template · Congruence Eye',
    data: { navId: 'checklist-templates', crumb: 'New checklist' },
    canActivate: [permissionGuard('manageTemplates')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./template-builder.page').then((m) => m.TemplateBuilderPage),
  },
  {
    path: 'templates/:id',
    title: 'Edit template · Congruence Eye',
    data: { navId: 'checklist-templates', crumb: 'Checklist builder' },
    canActivate: [permissionGuard('checklistTemplates')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./template-builder.page').then((m) => m.TemplateBuilderPage),
  },
  {
    path: 'dashboard',
    title: 'Checklist dashboard · Congruence Eye',
    data: { filter: true },
    canActivate: [permissionGuard('checklistDashboard')],
    loadComponent: () => import('./trax-dashboard.page').then((m) => m.TraxDashboardPage),
  },
  {
    path: 'schedules',
    title: 'Checklist schedules · Congruence Eye',
    canActivate: [permissionGuard('checklistSchedules')],
    loadComponent: () => import('./schedules.page').then((m) => m.SchedulesPage),
  },
  {
    // notification deep link: /checklists/assignments/:id opens the fill page
    path: 'assignments/:assignmentId',
    redirectTo: 'fill/:assignmentId',
  },
  {
    path: 'assignments',
    title: 'Checklist assignments · Congruence Eye',
    canActivate: [permissionGuard('checklistAssignments')],
    loadComponent: () => import('./assignments.page').then((m) => m.AssignmentsPage),
  },
  {
    path: 'fill/:assignmentId',
    title: 'Fill checklist · Congruence Eye',
    data: { navId: 'checklist-assignments', crumb: 'Fill checklist' },
    canActivate: [permissionGuard('checklistAssignments')],
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./fill.page').then((m) => m.FillChecklistPage),
  },
  {
    path: 'submissions',
    title: 'Submissions · Congruence Eye',
    data: { filter: true },
    canActivate: [permissionGuard('checklistSubmissions')],
    loadComponent: () => import('./submissions.page').then((m) => m.SubmissionsPage),
  },
  {
    path: 'submissions/:id',
    title: 'Submission · Congruence Eye',
    data: { crumb: 'Submission' },
    canActivate: [permissionGuard('checklistAssignments')],
    loadComponent: () => import('./submission-detail.page').then((m) => m.SubmissionDetailPage),
  },
  {
    path: 'compliance',
    title: 'Compliance · Congruence Eye',
    data: { filter: true },
    canActivate: [permissionGuard('compliance')],
    loadComponent: () => import('./compliance.page').then((m) => m.CompliancePage),
  },
];
