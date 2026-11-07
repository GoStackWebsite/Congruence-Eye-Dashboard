import { Injectable, computed, inject, signal } from '@angular/core';
import { Observable, catchError, finalize, of, shareReplay, tap } from 'rxjs';
import { AuthService } from '../auth/auth.service';
import { Camera, Region, Store, User, Zone } from '../models/api.models';
import { ApiService, silent } from './api.service';

/**
 * Cached reference data used by pickers across the app (stores in scope, regions,
 * users for assignee pickers, cameras/zones per store).
 */
@Injectable({ providedIn: 'root' })
export class LookupService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);

  readonly stores = signal<Store[]>([]);
  readonly storesLoaded = signal(false);
  readonly regions = signal<Region[]>([]);
  readonly users = signal<User[]>([]);

  /** Stores limited to the user's scope (backend already filters; this is a belt-and-braces check). */
  readonly scopedStores = computed(() => {
    const scope = this.auth.scopedStoreIds();
    const all = this.stores();
    return scope === null ? all : all.filter((s) => scope.includes(s.id));
  });
  readonly storeName = computed(() => {
    const m = new Map(this.stores().map((s) => [s.id, s.name] as const));
    return (id: number | null | undefined) => (id === null || id === undefined ? 'All stores' : m.get(id) ?? `Store #${id}`);
  });

  private stores$?: Observable<Store[]>;
  private usersInFlight = false;

  loadStores(force = false): Observable<Store[]> {
    if (!this.stores$ || force) {
      this.stores$ = this.api.get<Store[]>('/stores').pipe(
        tap((s) => {
          this.stores.set([...s].sort((a, b) => a.name.localeCompare(b.name)));
          this.storesLoaded.set(true);
        }),
        catchError(() => {
          this.storesLoaded.set(true);
          return of([] as Store[]);
        }),
        shareReplay(1),
      );
    }
    return this.stores$;
  }

  loadRegions(): void {
    this.api
      .get<Region[]>('/regions', null, silent())
      .pipe(catchError(() => of([] as Region[])))
      .subscribe((r) => this.regions.set(r));
  }

  /**
   * Users for assignee pickers. Non-admin roles may not be allowed to list users;
   * in that case we fall back to the current user only.
   */
  loadUsers(force = false): void {
    if ((this.users().length && !force) || this.usersInFlight) return;
    this.usersInFlight = true;
    this.api
      .get<User[]>('/users', null, silent())
      .pipe(
        catchError(() => {
          const me = this.auth.user();
          return of(me ? [me] : []);
        }),
        finalize(() => (this.usersInFlight = false)),
      )
      .subscribe((u) => this.users.set([...u].filter((x) => x.isActive !== false).sort((a, b) => a.name.localeCompare(b.name))));
  }

  /** Assignable users: active, and (contract v4) working at the store; admins work everywhere. */
  usersForStore(storeId: number | null | undefined): User[] {
    const all = this.users().filter((u) => u.isActive !== false);
    if (!storeId) return all;
    return all.filter((u) => u.role === 'SUPER_ADMIN' || u.role === 'ADMIN' || (u.storeIds ?? []).includes(storeId));
  }

  cameras(storeId: number): Observable<Camera[]> {
    return this.api.get<Camera[]>('/cameras', { storeId });
  }

  zones(storeId: number, cameraId?: number): Observable<Zone[]> {
    return this.api.get<Zone[]>('/zones', { storeId, cameraId });
  }

  clear(): void {
    this.stores.set([]);
    this.storesLoaded.set(false);
    this.users.set([]);
    this.regions.set([]);
    this.stores$ = undefined;
  }
}
