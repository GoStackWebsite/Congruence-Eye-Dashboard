import { Routes } from '@angular/router';

export const ANALYTICS_ROUTES: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'traffic' },
  { path: 'traffic', title: 'Traffic · Congruence Eye', loadComponent: () => import('./traffic.page').then((m) => m.TrafficPage) },
  {
    path: 'demographics',
    title: 'Demographics · Congruence Eye',
    loadComponent: () => import('./demographics.page').then((m) => m.DemographicsPage),
  },
  { path: 'zones', title: 'Zones · Congruence Eye', loadComponent: () => import('./zones.page').then((m) => m.ZonesPage) },
  { path: 'heatmap', title: 'Heatmap · Congruence Eye', loadComponent: () => import('./heatmap.page').then((m) => m.HeatmapPage) },
  { path: 'journey', title: 'Journey · Congruence Eye', loadComponent: () => import('./journey.page').then((m) => m.JourneyPage) },
  {
    path: 'conversion',
    title: 'Conversion · Congruence Eye',
    loadComponent: () => import('./conversion.page').then((m) => m.ConversionPage),
  },
  { path: 'queue', title: 'Queue · Congruence Eye', loadComponent: () => import('./queue.page').then((m) => m.QueuePage) },
  {
    path: 'store-ops',
    title: 'Store ops · Congruence Eye',
    loadComponent: () => import('./store-ops.page').then((m) => m.StoreOpsPage),
  },
  {
    path: 'benchmark',
    title: 'Benchmark · Congruence Eye',
    loadComponent: () => import('./benchmark.page').then((m) => m.BenchmarkPage),
  },
];
