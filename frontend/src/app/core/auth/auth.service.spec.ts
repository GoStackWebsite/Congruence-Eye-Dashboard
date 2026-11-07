import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { HttpClient } from '@angular/common/http';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { User } from '../models/api.models';
import { AuthService, decodeJwt, isTokenExpired } from './auth.service';
import { authInterceptor, errorInterceptor } from './interceptors';

function jwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => btoa(JSON.stringify(o)).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

const user: User = { id: 1, email: 'admin@congruence.in', name: 'Admin', role: 'SUPER_ADMIN', isActive: true, storeIds: [], createdAt: '2026-01-01T00:00:00Z' };

describe('AuthService', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideRouter([]), provideHttpClient(withInterceptors([authInterceptor, errorInterceptor])), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => http.verify());

  it('logs in, stores the token and exposes the role', () => {
    const auth = TestBed.inject(AuthService);
    const token = jwt({ sub: 1, exp: Math.floor(Date.now() / 1000) + 3600 });
    let done = false;
    auth.login('admin@congruence.in', 'Password@123').subscribe(() => (done = true));
    const req = http.expectOne('/api/auth/login');
    expect(req.request.method).toBe('POST');
    expect(req.request.body).toEqual({ email: 'admin@congruence.in', password: 'Password@123' });
    req.flush({ accessToken: token, user });
    expect(done).toBe(true);
    expect(auth.isLoggedIn()).toBe(true);
    expect(auth.role()).toBe('SUPER_ADMIN');
    expect(auth.can('adminMaster')).toBe(true);
    expect(localStorage.getItem('ce.token')).toBe(token);
  });

  it('adds the bearer header to API calls', () => {
    const auth = TestBed.inject(AuthService);
    auth.login('a@b.c', 'x').subscribe();
    http.expectOne('/api/auth/login').flush({ accessToken: 'tok', user });
    TestBed.inject(HttpClient).get('/api/stores').subscribe();
    const req = http.expectOne('/api/stores');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    req.flush([]);
  });

  it('logs out and redirects to /login on 401', async () => {
    const auth = TestBed.inject(AuthService);
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigate').mockResolvedValue(true);
    auth.login('a@b.c', 'x').subscribe();
    http.expectOne('/api/auth/login').flush({ accessToken: 'tok', user });
    TestBed.inject(HttpClient).get('/api/analytics/overview').subscribe({ error: () => undefined });
    http.expectOne('/api/analytics/overview').flush({ statusCode: 401 }, { status: 401, statusText: 'Unauthorized' });
    expect(auth.isLoggedIn()).toBe(false);
    expect(nav).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('restores a valid session and discards an expired one', () => {
    localStorage.setItem('ce.token', jwt({ exp: Math.floor(Date.now() / 1000) + 60 }));
    localStorage.setItem('ce.user', JSON.stringify(user));
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(true);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()] });
    localStorage.setItem('ce.token', jwt({ exp: Math.floor(Date.now() / 1000) - 60 }));
    localStorage.setItem('ce.user', JSON.stringify(user));
    expect(TestBed.inject(AuthService).isLoggedIn()).toBe(false);
    expect(localStorage.getItem('ce.token')).toBeNull();
    http = TestBed.inject(HttpTestingController);
  });

  it('home route depends on role', () => {
    const auth = TestBed.inject(AuthService);
    auth.login('a@b.c', 'x').subscribe();
    http.expectOne('/api/auth/login').flush({ accessToken: 'tok', user: { ...user, role: 'STAFF', storeIds: [1] } });
    expect(auth.homeRoute()).toBe('/tasks');
    expect(auth.scopedStoreIds()).toEqual([1]);
  });
});

describe('jwt helpers', () => {
  it('decodes payloads and checks expiry', () => {
    const t = jwt({ exp: 100 });
    expect(decodeJwt(t)?.['exp']).toBe(100);
    expect(isTokenExpired(t, 200_000)).toBe(true);
    expect(isTokenExpired(t, 50_000)).toBe(false);
    expect(isTokenExpired(null)).toBe(true);
    expect(isTokenExpired('opaque-token')).toBe(false);
    expect(decodeJwt('garbage')).toBeNull();
  });
});
