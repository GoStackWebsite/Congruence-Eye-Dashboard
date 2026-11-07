import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { LoginPage } from './login.page';

describe('LoginPage', () => {
  let http: HttpTestingController;

  beforeEach(() => {
    localStorage.clear();
    TestBed.configureTestingModule({
      imports: [LoginPage],
      providers: [provideRouter([]), provideHttpClient(), provideHttpClientTesting()],
    });
    http = TestBed.inject(HttpTestingController);
  });

  function setup() {
    const fixture = TestBed.createComponent(LoginPage);
    const el = fixture.nativeElement as HTMLElement;
    const type = (id: string, v: string) => {
      const input = el.querySelector(`[data-testid="${id}"]`) as HTMLInputElement;
      input.value = v;
      input.dispatchEvent(new Event('input'));
    };
    return { fixture, el, type };
  }

  it('has testids for the form', async () => {
    const { fixture, el } = setup();
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="page-login"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="input-email"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="input-password"]')).not.toBeNull();
    expect(el.querySelector('[data-testid="btn-login"]')).not.toBeNull();
  });

  it('does not submit an invalid form', async () => {
    const { fixture, el } = setup();
    await fixture.whenStable();
    (el.querySelector('[data-testid="btn-login"]') as HTMLButtonElement).click();
    http.expectNone('/api/auth/login');
  });

  it('logs in and navigates to the role home', async () => {
    const { fixture, el, type } = setup();
    const router = TestBed.inject(Router);
    const nav = vi.spyOn(router, 'navigateByUrl').mockResolvedValue(true);
    await fixture.whenStable();
    type('input-email', 'admin@congruence.in');
    type('input-password', 'Password@123');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    const req = http.expectOne('/api/auth/login');
    req.flush({ accessToken: 'tok', user: { id: 1, email: 'admin@congruence.in', name: 'Admin', role: 'SUPER_ADMIN', isActive: true, storeIds: [], createdAt: '' } });
    expect(nav).toHaveBeenCalledWith('/dashboard');
  });

  it('shows an error on 401', async () => {
    const { fixture, el, type } = setup();
    await fixture.whenStable();
    type('input-email', 'admin@congruence.in');
    type('input-password', 'wrong');
    (el.querySelector('form') as HTMLFormElement).dispatchEvent(new Event('submit'));
    http.expectOne('/api/auth/login').flush({ statusCode: 401, message: 'Unauthorized' }, { status: 401, statusText: 'Unauthorized' });
    await fixture.whenStable();
    expect(el.querySelector('[data-testid="login-error"]')?.textContent).toContain('Invalid email or password');
  });
});
