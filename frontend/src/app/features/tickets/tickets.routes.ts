import { Routes } from '@angular/router';

export const TICKET_ROUTES: Routes = [
  { path: '', title: 'Tickets · Congruence Eye', loadComponent: () => import('./tickets.page').then((m) => m.TicketsPage) },
  { path: ':id', title: 'Ticket · Congruence Eye', data: { crumb: 'Ticket' }, loadComponent: () => import('./ticket-detail.page').then((m) => m.TicketDetailPage) },
];
