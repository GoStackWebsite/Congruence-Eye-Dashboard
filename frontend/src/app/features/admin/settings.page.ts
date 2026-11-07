import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { AuthService } from '../../core/auth/auth.service';
import { Settings } from '../../core/models/api.models';
import { ApiService, silent } from '../../core/services/api.service';
import { V2Api } from '../../core/services/v2.api';
import { DS } from '../../shared/ds';
import { UiService } from '../../shared/ui/ui.service';
import { useOpsStyles } from '../../shared/ds/ops.styles';
import { apiErrorText } from './recorders/recorder.helpers';

const SECTIONS = [
  { id: 'set-general', label: 'General', icon: 'tune', keys: ['companyName', 'currency'] },
  { id: 'set-metrics', label: 'Visitor metrics', icon: 'directions_walk', keys: ['engagedStoreDwellSec', 'bounceSec', 'repeatWindowDays'] },
  { id: 'set-ai', label: 'AI & checklists', icon: 'smart_toy', keys: ['aiServiceUrl', 'checklistReminderMinutes'] },
  { id: 'set-email', label: 'Email delivery', icon: 'mail', keys: ['alertEmailEnabled', 'smtpHost', 'smtpPort', 'smtpUser', 'smtpFrom'] },
];

/** Alert emails need an SMTP host and a from address. */
function emailDelivery(g: AbstractControl): ValidationErrors | null {
  const v = g.value as { alertEmailEnabled?: boolean; smtpHost?: string | null; smtpFrom?: string | null };
  return v.alertEmailEnabled && (!v.smtpHost?.trim() || !v.smtpFrom?.trim()) ? { smtpIncomplete: true } : null;
}

/** Admin › Settings: sectioned form with an outline, inline validation and a sticky save bar. */
@Component({
  selector: 'ce-settings-page',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSlideToggleModule, MatIconModule, MatProgressSpinnerModule, ...DS],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <section data-testid="page-admin-settings">
      <ce-page title="Settings" description="How visitor metrics are counted, how the AI service is reached and how alerts are delivered">
        @if (loadError()) {
          <ce-card>
            <ce-empty-state kind="error" [message]="loadError()">
              <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="load()" data-testid="btn-retry">Retry</button>
            </ce-empty-state>
          </ce-card>
        } @else {
          <div class="ops-settings">
            <nav class="ops-settings-nav" aria-label="Settings sections">
              @for (s of sections; track s.id) {
                <a [href]="'#' + s.id" (click)="jump($event, s.id)" [class.invalid]="invalid(s.keys)"><span class="material-symbols-outlined" aria-hidden="true">{{ invalid(s.keys) ? 'error' : s.icon }}</span>{{ s.label }}</a>
              }
            </nav>
            @if (loading()) {
              <div class="ops-stack"><ce-skeleton kind="chart" height="180px" /><ce-skeleton kind="chart" height="220px" /></div>
            } @else {
              <form [formGroup]="form" (ngSubmit)="save()" class="ops-settings-sections" data-testid="form-settings" novalidate>
                <ce-form-section title="General" anchor="set-general" description="Shown on reports and exports.">
                  <div class="ops-form-grid">
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-company">Company name</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-company" matInput formControlName="companyName" data-testid="input-companyName" /><mat-error>Company name is required</mat-error></mat-form-field>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-cur">Currency</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-cur" matInput formControlName="currency" maxlength="3" data-testid="input-currency" /><mat-error>Use a 3-letter code, e.g. INR</mat-error></mat-form-field>
                    </div>
                  </div>
                </ce-form-section>

                <ce-form-section title="Visitor metrics" anchor="set-metrics" info="Changes apply to data processed from now on; past days are not recalculated." description="Definitions used by traffic, zones and conversion.">
                  <div class="ops-form-grid">
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-eng">Engaged store dwell (seconds)</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-eng" matInput type="number" min="0" formControlName="engagedStoreDwellSec" data-testid="input-engagedStoreDwellSec" /><mat-error>0 or more</mat-error></mat-form-field>
                      <div class="caption">A visit counts as engaged after this long in the store</div>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-bounce">Bounce threshold (seconds)</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-bounce" matInput type="number" min="0" formControlName="bounceSec" data-testid="input-bounceSec" /><mat-error>0 or more</mat-error></mat-form-field>
                      <div class="caption">Shorter non-engaged visits are bounces</div>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-rep">Repeat visitor window (days)</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-rep" matInput type="number" min="1" formControlName="repeatWindowDays" data-testid="input-repeatWindowDays" /><mat-error>1 or more</mat-error></mat-form-field>
                    </div>
                  </div>
                </ce-form-section>

                <ce-form-section title="AI & checklists" anchor="set-ai" description="AI checks on checklist photos and checklist reminders.">
                  <div class="ops-form-grid">
                    <div class="ops-field full">
                      <label class="ce-field-label" for="s-ai">AI service URL</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-ai" matInput formControlName="aiServiceUrl" placeholder="http://localhost:8000" spellcheck="false" data-testid="input-aiServiceUrl" /><mat-error>Start with http:// or https://</mat-error></mat-form-field>
                      <div class="caption">Used for reference-match and uniform checks</div>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-rem">Checklist reminder (minutes before due)</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-rem" matInput type="number" min="0" formControlName="checklistReminderMinutes" data-testid="input-checklistReminderMinutes" /><mat-error>0 or more</mat-error></mat-form-field>
                    </div>
                  </div>
                  @if (auth.can('runNudges')) {
                    <div sectionActions>
                      <button type="button" class="ce-btn ce-btn-secondary ce-btn-sm" (click)="runNudges()" [disabled]="nudging()" data-testid="btn-run-nudges"><mat-icon>notifications</mat-icon> Run checklist nudges now</button>
                    </div>
                  }
                </ce-form-section>

                <ce-form-section title="Email delivery" anchor="set-email" description="SMTP server used for alert emails and scheduled reports.">
                  <ce-toggle-row label="Send alert emails" helper="Rules with the Email channel send to their recipients" [checked]="!!form.value.alertEmailEnabled" (checkedChange)="form.controls.alertEmailEnabled.setValue($event); form.markAsDirty()" testId="input-alertEmailEnabled" [alwaysShowBody]="true">
                    @if (form.hasError('smtpIncomplete') && form.touched) {
                      <ce-info-banner tone="warning" data-testid="smtp-incomplete">Add the SMTP host and a from address, or turn alert emails off.</ce-info-banner>
                    }
                  </ce-toggle-row>
                  <div class="ops-form-grid" style="margin-top: 12px">
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-host">SMTP host</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-host" matInput formControlName="smtpHost" placeholder="smtp.office365.com" data-testid="input-smtpHost" /></mat-form-field>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-port">SMTP port</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-port" matInput type="number" min="1" max="65535" formControlName="smtpPort" placeholder="587" data-testid="input-smtpPort" /><mat-error>Port must be 1–65535</mat-error></mat-form-field>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-user">SMTP user</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-user" matInput formControlName="smtpUser" autocomplete="off" data-testid="input-smtpUser" /></mat-form-field>
                    </div>
                    <div class="ops-field">
                      <label class="ce-field-label" for="s-from">From address</label>
                      <mat-form-field appearance="outline" subscriptSizing="dynamic"><input id="s-from" matInput type="email" formControlName="smtpFrom" placeholder="eye@congruence.in" data-testid="input-smtpFrom" /><mat-error>Enter a valid email address</mat-error></mat-form-field>
                    </div>
                  </div>
                </ce-form-section>

                <div class="ops-savebar" role="region" aria-label="Save settings">
                  @if (saveError()) {
                    <span class="ops-inline-error" role="alert">{{ saveError() }}</span>
                  } @else if (form.invalid && form.touched) {
                    <span class="ops-inline-error">Fix the highlighted fields</span>
                  } @else {
                    <span class="caption">{{ dirty() ? 'You have unsaved changes' : 'All changes saved' }}</span>
                  }
                  <span class="ops-spacer"></span>
                  <button type="button" class="ce-btn ce-btn-ghost" (click)="discard()" [disabled]="!dirty() || saving()" data-testid="btn-discard">Discard</button>
                  <button type="submit" class="ce-btn ce-btn-primary" [disabled]="saving()" data-testid="btn-save">
                    @if (saving()) {
                      <mat-spinner diameter="16" />
                    } @else {
                      <mat-icon>save</mat-icon>
                    }
                    Save settings
                  </button>
                </div>
              </form>
            }
          </div>
        }
      </ce-page>
    </section>
  `,
})
export class SettingsPage {
  protected readonly opsCss = useOpsStyles();
  private readonly api = inject(ApiService);
  private readonly ui = inject(UiService);
  protected readonly auth = inject(AuthService);
  private readonly v2 = inject(V2Api);
  readonly sections = SECTIONS;
  readonly loading = signal(true);
  readonly loadError = signal<string | null>(null);
  readonly saving = signal(false);
  readonly nudging = signal(false);
  readonly saveError = signal<string | null>(null);
  private original: Settings | null = null;
  readonly form = inject(FormBuilder).group(
    {
      companyName: ['Congruence', Validators.required],
      currency: ['INR', [Validators.required, Validators.pattern(/^[A-Za-z]{3}$/)]],
      engagedStoreDwellSec: [300, [Validators.required, Validators.min(0)]],
      bounceSec: [60, [Validators.required, Validators.min(0)]],
      repeatWindowDays: [30, [Validators.required, Validators.min(1)]],
      alertEmailEnabled: [false],
      smtpHost: [null as string | null],
      smtpPort: [null as number | null, [Validators.min(1), Validators.max(65535)]],
      smtpUser: [null as string | null],
      smtpFrom: [null as string | null, Validators.email],
      aiServiceUrl: [null as string | null, Validators.pattern(/^https?:\/\/.+/)],
      checklistReminderMinutes: [60 as number | null, Validators.min(0)],
    },
    { validators: emailDelivery },
  );
  private readonly status = toSignal(this.form.statusChanges, { initialValue: this.form.status });
  private readonly changes = toSignal(this.form.valueChanges);
  readonly dirty = computed(() => {
    this.changes();
    this.status();
    return this.form.dirty;
  });

  constructor() {
    this.load();
  }

  load(): void {
    this.loading.set(true);
    this.loadError.set(null);
    this.api.get<Settings>('/settings', null, silent()).subscribe({
      next: (s) => {
        this.original = s;
        this.form.reset(this.form.getRawValue());
        this.form.patchValue(s);
        this.form.markAsPristine();
        this.loading.set(false);
      },
      error: (e) => {
        this.loading.set(false);
        this.loadError.set(apiErrorText(e, 'Couldn’t load the settings.'));
      },
    });
  }

  invalid(keys: string[]): boolean {
    this.status();
    return keys.some((k) => {
      const c = this.form.get(k);
      return !!c && c.invalid && c.touched;
    }) || (keys.includes('alertEmailEnabled') && this.form.hasError('smtpIncomplete') && this.form.touched);
  }

  jump(e: Event, id: string): void {
    e.preventDefault();
    document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  discard(): void {
    if (this.original) this.form.patchValue(this.original);
    this.form.markAsPristine();
    this.form.markAsUntouched();
    this.saveError.set(null);
  }

  runNudges(): void {
    this.nudging.set(true);
    this.v2.runNudges().subscribe({
      next: (r) => {
        this.nudging.set(false);
        this.ui.toast(`Sent ${r.reminders} reminder(s); ${r.overdue} marked overdue`);
      },
      error: () => this.nudging.set(false),
    });
  }

  save(): void {
    if (this.saving()) return;
    this.saveError.set(null);
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      const first = SECTIONS.find((s) => this.invalid(s.keys));
      if (first) document.getElementById(first.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      return;
    }
    const v = this.form.getRawValue();
    const body: Settings = {
      companyName: v.companyName!.trim(),
      currency: v.currency!.toUpperCase(),
      engagedStoreDwellSec: Number(v.engagedStoreDwellSec),
      bounceSec: Number(v.bounceSec),
      repeatWindowDays: Number(v.repeatWindowDays),
      alertEmailEnabled: !!v.alertEmailEnabled,
      smtpHost: v.smtpHost?.trim() || null,
      smtpPort: v.smtpPort ? Number(v.smtpPort) : null,
      smtpUser: v.smtpUser?.trim() || null,
      smtpFrom: v.smtpFrom?.trim() || null,
      aiServiceUrl: v.aiServiceUrl?.trim() || null,
      checklistReminderMinutes: v.checklistReminderMinutes === null || (v.checklistReminderMinutes as unknown) === '' ? 60 : Number(v.checklistReminderMinutes),
    };
    this.saving.set(true);
    this.api.put<Settings>('/settings', body, silent()).subscribe({
      next: (s) => {
        this.saving.set(false);
        this.original = s ?? body;
        this.form.markAsPristine();
        this.ui.toast('Settings saved');
      },
      error: (e) => {
        this.saving.set(false);
        this.saveError.set(apiErrorText(e, 'The settings could not be saved.'));
      },
    });
  }
}
