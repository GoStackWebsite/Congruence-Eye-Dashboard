import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, tap } from 'rxjs';
import { environment } from '../../../environments/environment';
import { ChangePasswordRequest, LoginResponse, Role, User } from '../models/api.models';
import { safeStorage } from '../utils/storage';
import { Permission, can, homeRouteFor, isAdmin } from './permissions';

const TOKEN_KEY = 'ce.token';
const USER_KEY = 'ce.user';

/** Decodes a JWT payload without verifying it (client side only needs exp). */
export function decodeJwt(token: string): Record<string, unknown> | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const b64 = part.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

export function isTokenExpired(token: string | null, nowMs = Date.now()): boolean {
  if (!token) return true;
  const payload = decodeJwt(token);
  const exp = payload?.['exp'];
  if (typeof exp !== 'number') return false; // opaque/no-exp tokens: let the server decide
  return exp * 1000 <= nowMs;
}

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly _token = signal<string | null>(null);
  private readonly _user = signal<User | null>(null);

  readonly token = this._token.asReadonly();
  readonly user = this._user.asReadonly();
  readonly role = computed<Role | null>(() => this._user()?.role ?? null);
  readonly isLoggedIn = computed(() => !!this._token() && !!this._user());
  readonly isAdmin = computed(() => isAdmin(this.role()));

  constructor() {
    const token = safeStorage.getString(TOKEN_KEY);
    const user = safeStorage.get<User | null>(USER_KEY, null);
    if (token && user && !isTokenExpired(token)) {
      this._token.set(token);
      this._user.set(user);
    } else {
      this.clear();
    }
  }

  login(email: string, password: string): Observable<LoginResponse> {
    return this.http.post<LoginResponse>(`${environment.apiBaseUrl}/auth/login`, { email, password }).pipe(
      tap((res) => {
        this._token.set(res.accessToken);
        this._user.set(res.user);
        safeStorage.set(TOKEN_KEY, res.accessToken);
        safeStorage.set(USER_KEY, res.user);
      }),
    );
  }

  refreshMe(): Observable<User> {
    return this.http.get<User>(`${environment.apiBaseUrl}/auth/me`).pipe(
      tap((u) => {
        this._user.set(u);
        safeStorage.set(USER_KEY, u);
      }),
    );
  }

  changePassword(body: ChangePasswordRequest): Observable<{ ok: boolean }> {
    return this.http.post<{ ok: boolean }>(`${environment.apiBaseUrl}/auth/change-password`, body);
  }

  logout(redirect = true): void {
    const wasLoggedIn = !!this._token();
    this.clear();
    if (redirect) {
      const current = this.router.url;
      const returnUrl = wasLoggedIn || current.startsWith('/login') ? undefined : current;
      void this.router.navigate(['/login'], { queryParams: returnUrl && returnUrl !== '/' ? { returnUrl } : {} });
    }
  }

  /**
   * The session ended under the user (401: token expired / revoked). Unlike a sign-out, the current page is kept as
   * `returnUrl` so signing in again brings the user back to where they were (editors keep a local copy of unsaved
   * work — see the checklist fill page).
   */
  expire(): void {
    const current = this.router.url;
    this.clear();
    const returnUrl = current && current !== '/' && !current.startsWith('/login') ? current : undefined;
    void this.router.navigate(['/login'], { queryParams: returnUrl ? { returnUrl, expired: 1 } : { expired: 1 } });
  }

  can(permission: Permission): boolean {
    return can(this.role(), permission);
  }

  homeRoute(): string {
    return homeRouteFor(this.role());
  }

  /** Store ids the user may see; `null` means all (admins). */
  scopedStoreIds(): number[] | null {
    const u = this._user();
    if (!u) return [];
    return isAdmin(u.role) ? null : u.storeIds ?? [];
  }

  private clear(): void {
    this._token.set(null);
    this._user.set(null);
    safeStorage.remove(TOKEN_KEY);
    safeStorage.remove(USER_KEY);
  }
}
