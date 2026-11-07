import { Routes } from '@angular/router';
import { unsavedChangesGuard } from '../../shared/ds/unsaved-changes.guard';

export const AI_MANAGER_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'detections' },
  { path: 'rules', title: 'AI checklists · Congruence Eye', loadComponent: () => import('./rules.page').then((m) => m.AiRulesPage) },
  {
    path: 'rules/:ruleId',
    title: 'AI checklist · Congruence Eye',
    data: { navId: 'ai-rules', crumb: 'Editor' },
    canDeactivate: [unsavedChangesGuard],
    loadComponent: () => import('./rule-editor.page').then((m) => m.AiRuleEditorPage),
  },
  {
    path: 'detections',
    title: 'AI Manager detections · Congruence Eye',
    data: { filter: true },
    loadComponent: () => import('./detections.page').then((m) => m.DetectionsPage),
  },
  {
    path: 'summary',
    title: 'AI Manager summary · Congruence Eye',
    data: { filter: true },
    loadComponent: () => import('./summary.page').then((m) => m.AiSummaryPage),
  },
  {
    path: 'open-close',
    title: 'Store open / close · Congruence Eye',
    data: { filter: true },
    loadComponent: () => import('./open-close.page').then((m) => m.OpenClosePage),
  },
];
