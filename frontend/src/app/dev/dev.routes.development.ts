import { Routes } from '@angular/router';

/** Dev-only routes (non-production builds): the living style guide of the design system. */
export const DEV_ROUTES: Routes = [
  {
    path: '_styleguide',
    title: 'Style guide · Congruence Eye',
    data: { crumb: 'Style guide' },
    loadComponent: () => import('./styleguide.page').then((m) => m.StyleguidePage),
  },
];
