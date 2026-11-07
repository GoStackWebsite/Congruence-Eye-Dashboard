import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { ActivatedRoute, Router } from '@angular/router';
import { environment } from '../../../environments/environment';
import { AuthService } from '../../core/auth/auth.service';

/** Seed users offered as one-click sign-ins in the online demo. */
export const DEMO_USERS = [
  { key: 'admin', label: 'Admin', email: 'admin@congruence.in', icon: 'admin_panel_settings' },
  { key: 'regional', label: 'Regional manager', email: 'regional@congruence.in', icon: 'map' },
  { key: 'manager', label: 'Store manager', email: 'manager.tnagar@congruence.in', icon: 'storefront' },
  { key: 'auditor', label: 'Auditor', email: 'auditor@congruence.in', icon: 'fact_check' },
  { key: 'staff', label: 'Staff', email: 'staff.tnagar@congruence.in', icon: 'badge' },
];
import { ThemeService } from '../../core/services/theme.service';
import { errorMessage } from '../../core/utils/format';
import { BrandMarkComponent } from '../../layout/brand-mark.component';

@Component({
  selector: 'ce-login-page',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatButtonModule, MatIconModule, MatProgressSpinnerModule, BrandMarkComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="login-wrap" data-testid="page-login">
      <section class="login-visual" aria-hidden="true">
        <div class="lv-brand"><ce-brand-mark [size]="34" /><span>Congruence <b>Eye</b></span></div>
        <div class="lv-copy">
          <h2>Every store, every hour,<br />in one calm view.</h2>
          <p>Footfall, conversion, zones and store operations from your CCTV — with checklists and AI checks that keep every Congruence store on standard.</p>
        </div>
        <div class="lv-stage">
          <svg class="lv-plan" viewBox="0 0 520 340" role="presentation">
            <defs>
              <radialGradient id="lvHot" cx="50%" cy="50%" r="50%">
                <stop offset="0" stop-color="#F97316" stop-opacity=".95" />
                <stop offset=".45" stop-color="#FDE047" stop-opacity=".65" />
                <stop offset=".75" stop-color="#36BFFA" stop-opacity=".35" />
                <stop offset="1" stop-color="#7A5AF8" stop-opacity="0" />
              </radialGradient>
              <radialGradient id="lvWarm" cx="50%" cy="50%" r="50%">
                <stop offset="0" stop-color="#36BFFA" stop-opacity=".8" />
                <stop offset=".6" stop-color="#2E90FA" stop-opacity=".35" />
                <stop offset="1" stop-color="#7A5AF8" stop-opacity="0" />
              </radialGradient>
              <pattern id="lvGrid" width="20" height="20" patternUnits="userSpaceOnUse">
                <path d="M20 0H0V20" fill="none" stroke="#ffffff" stroke-opacity=".05" />
              </pattern>
            </defs>
            <rect x="10" y="10" width="500" height="320" rx="18" fill="#13234A" stroke="#2A3D6B" />
            <rect x="10" y="10" width="500" height="320" rx="18" fill="url(#lvGrid)" />
            <!-- fixtures -->
            <rect x="40" y="40" width="440" height="22" rx="5" fill="#1D3260" />
            <rect x="40" y="96" width="120" height="16" rx="4" fill="#1D3260" />
            <rect x="40" y="132" width="120" height="16" rx="4" fill="#1D3260" />
            <rect x="40" y="168" width="120" height="16" rx="4" fill="#1D3260" />
            <rect x="214" y="110" width="110" height="70" rx="10" fill="#1D3260" />
            <rect x="372" y="96" width="108" height="88" rx="10" fill="#1D3260" />
            <rect x="372" y="236" width="108" height="56" rx="8" fill="#22396B" />
            <text x="426" y="268" fill="#8C96AB" font-size="11" font-family="Inter, sans-serif" text-anchor="middle">Billing</text>
            <!-- zones -->
            <rect x="30" y="84" width="142" height="112" rx="10" fill="none" stroke="#7A5AF8" stroke-width="1.5" stroke-dasharray="5 5" />
            <rect x="200" y="96" width="138" height="98" rx="12" fill="none" stroke="#0BA5EC" stroke-width="1.5" />
            <rect x="360" y="84" width="132" height="112" rx="10" fill="none" stroke="#7A5AF8" stroke-width="1.5" stroke-dasharray="5 5" />
            <!-- heat -->
            <circle cx="268" cy="146" r="72" fill="url(#lvHot)" />
            <circle cx="96" cy="140" r="54" fill="url(#lvWarm)" />
            <circle cx="420" cy="250" r="50" fill="url(#lvWarm)" />
            <!-- entrance + path -->
            <rect x="210" y="318" width="100" height="6" rx="3" fill="#0BA5EC" />
            <path d="M260 316 C 260 270, 250 230, 266 196 M 260 300 C 330 290, 380 280, 404 264" fill="none" stroke="#0BA5EC" stroke-width="2" stroke-dasharray="2 6" stroke-linecap="round" />
            <circle cx="248" cy="232" r="5" fill="#fff" /><circle cx="300" cy="150" r="5" fill="#fff" /><circle cx="110" cy="128" r="5" fill="#fff" />
            <circle cx="396" cy="258" r="5" fill="#fff" /><circle cx="280" cy="128" r="5" fill="#fff" />
          </svg>
          <div class="lv-card lv-kpi">
            <div class="lv-k-label">Footfall today</div>
            <div class="lv-k-value">12,480</div>
            <div class="lv-k-delta">&#8599; 8.2% vs last week</div>
            <svg viewBox="0 0 120 32" class="lv-spark"><polyline points="0,26 15,22 30,24 45,15 60,18 75,9 90,12 105,5 120,8" fill="none" stroke="#0BA5EC" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" /></svg>
          </div>
          <div class="lv-card lv-conv">
            <div class="lv-k-label">Conversion</div>
            <div class="lv-bars">
              <span style="height: 40%"></span><span style="height: 58%"></span><span style="height: 46%"></span><span style="height: 72%"></span><span style="height: 64%"></span><span class="hi" style="height: 88%"></span>
            </div>
            <div class="lv-k-value sm">31.4%</div>
          </div>
          <div class="lv-card lv-status">
            <span class="lv-dot"></span>
            <div>
              <div class="lv-s-title">T Nagar opened on time</div>
              <div class="lv-s-sub">09:58 AM &middot; opening snap verified</div>
            </div>
          </div>
        </div>
        <ul class="lv-points">
          <li><span class="material-symbols-outlined">directions_walk</span>Traffic &amp; zones</li>
          <li><span class="material-symbols-outlined">fact_check</span>Trax checklists</li>
          <li><span class="material-symbols-outlined">smart_toy</span>AI Manager</li>
        </ul>
      </section>

      <section class="login-panel">
        <form class="login-card" [formGroup]="form" (ngSubmit)="submit()" novalidate data-testid="form-login">
          <div class="lc-brand"><ce-brand-mark [size]="40" /></div>
          <h1>Sign in to Congruence Eye</h1>
          <p class="lc-sub">Welcome back. Use your Congruence work account.</p>
          @if (expired() && !error()) {
            <div class="info-banner" role="status" data-testid="session-expired">
              <mat-icon>schedule</mat-icon><span>Your session expired. Sign in again to continue where you left off.</span>
            </div>
          }
          @if (error()) {
            <div class="error-banner" role="alert" data-testid="login-error">
              <mat-icon>error</mat-icon><span>{{ error() }}</span>
            </div>
          }
          <label class="ce-field-label" for="login-email">Email</label>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="lc-field">
            <mat-icon matPrefix>mail</mat-icon>
            <input id="login-email" matInput type="email" formControlName="email" autocomplete="username" placeholder="you@congruence.in" data-testid="input-email" />
            <mat-error>Enter a valid email</mat-error>
          </mat-form-field>
          <label class="ce-field-label" for="login-password">Password</label>
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="lc-field">
            <mat-icon matPrefix>lock</mat-icon>
            <input id="login-password" matInput [type]="show() ? 'text' : 'password'" formControlName="password" autocomplete="current-password" placeholder="Your password" data-testid="input-password" />
            <button mat-icon-button matSuffix type="button" (click)="show.set(!show())" [attr.aria-label]="show() ? 'Hide password' : 'Show password'">
              <mat-icon>{{ show() ? 'visibility_off' : 'visibility' }}</mat-icon>
            </button>
            <mat-error>Password is required</mat-error>
          </mat-form-field>
          <button type="submit" class="ce-btn ce-btn-primary login-btn" [disabled]="loading()" data-testid="btn-login">
            @if (loading()) {
              <mat-spinner diameter="16" />
            }
            Sign in
          </button>
          @if (demo) {
            <div class="demo-logins" data-testid="demo-logins">
              <div class="dl-head"><span>Online demo</span> sign in as</div>
              <div class="dl-grid">
                @for (d of demoUsers; track d.key) {
                  <button type="button" class="dl-btn" (click)="demoLogin(d.email)" [disabled]="loading()" [attr.data-testid]="'btn-demo-login-' + d.key">
                    <span class="material-symbols-outlined">{{ d.icon }}</span>{{ d.label }}
                  </button>
                }
              </div>
              <div class="caption">All demo users share the password <code>Password&#64;123</code>.</div>
            </div>
          }
          <div class="lc-foot">
            <span>&copy; {{ year }} Congruence Retail</span>
            <button type="button" class="ce-link-btn" (click)="theme.toggle()">{{ theme.isDark() ? 'Light' : 'Dark' }} theme</button>
          </div>
        </form>
      </section>
    </div>
  `,
})
export class LoginPage {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  protected readonly theme = inject(ThemeService);

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** Arrived here because the session expired (AuthService.expire). */
  readonly expired = signal(this.route.snapshot.queryParamMap.get('expired') === '1');
  readonly show = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group({
    email: ['', [Validators.required, Validators.email]],
    password: ['', Validators.required],
  });

  readonly demo = environment.demo;
  readonly demoUsers = DEMO_USERS;
  readonly year = new Date().getFullYear();

  demoLogin(email: string): void {
    this.form.setValue({ email, password: 'Password@123' });
    this.submit();
  }

  submit(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.loading.set(true);
    this.error.set(null);
    const { email, password } = this.form.getRawValue();
    this.auth.login(email.trim(), password).subscribe({
      next: () => {
        const returnUrl = this.route.snapshot.queryParamMap.get('returnUrl');
        const target = returnUrl && returnUrl.startsWith('/') && !returnUrl.startsWith('/login') ? returnUrl : this.auth.homeRoute();
        void this.router.navigateByUrl(target);
      },
      error: (e) => {
        this.loading.set(false);
        this.error.set(e?.status === 401 ? 'Invalid email or password' : errorMessage(e));
      },
    });
  }
}
