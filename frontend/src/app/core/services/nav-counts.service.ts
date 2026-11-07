import { Injectable, inject, signal } from '@angular/core';
import { Observable, catchError, forkJoin, map, of } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { NavBadge } from '../auth/permissions';
import { Alert, Assignment, Paged, Ticket } from '../models/api.models';
import { ApiService, silent } from './api.service';

/**
 * Count badges for the module panel (open alerts, overdue checklists, open tickets), read from the existing list
 * endpoints. Silent: a failing count never shows an error, it just hides the badge.
 */
@Injectable({ providedIn: 'root' })
export class NavCountsService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  readonly counts = signal<Partial<Record<NavBadge, number>>>({});
  private timer: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.refresh();
    if (!this.timer) this.timer = setInterval(() => this.refresh(), 120_000);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.counts.set({});
  }

  refresh(): void {
    const role = this.auth.role();
    if (!role) return;
    const jobs: Record<string, Observable<number | null>> = {};
    if (this.auth.can('alerts'))
      jobs['alerts'] = this.api.get<Paged<Alert>>('/alerts', { status: 'OPEN', page: 1, pageSize: 1 }, silent()).pipe(map((p) => p.total ?? p.items?.length ?? 0), catchError(() => of(null)));
    if (this.auth.can('checklistAssignments'))
      jobs['overdue'] = this.api
        .get<Assignment[]>('/checklists/assignments', { status: 'OVERDUE', mine: role === 'STAFF' ? true : undefined }, silent())
        .pipe(map((a) => (Array.isArray(a) ? a.length : 0)), catchError(() => of(null)));
    if (this.auth.can('tickets'))
      jobs['tickets'] = this.api.get<Ticket[]>('/tickets', { status: 'OPEN' }, silent()).pipe(map((t) => (Array.isArray(t) ? t.length : 0)), catchError(() => of(null)));
    if (!Object.keys(jobs).length) return;
    forkJoin(jobs).subscribe((r) => {
      const next: Partial<Record<NavBadge, number>> = {};
      for (const [k, v] of Object.entries(r)) if (v !== null) next[k as NavBadge] = v;
      this.counts.set(next);
    });
  }
}
