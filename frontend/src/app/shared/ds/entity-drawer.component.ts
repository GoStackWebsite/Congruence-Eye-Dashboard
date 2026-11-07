import { ChangeDetectionStrategy, Component, ViewEncapsulation, computed, effect, input, model, output, signal, untracked } from '@angular/core';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable, Subscription } from 'rxjs';
import { apiErrorText, httpStatus } from '../../core/utils/http-errors';
import { FieldDef, fromControlValue, resolveOptions, toControlValue, validatorsFor } from '../crud/field';
import { DrawerComponent, InfoBannerComponent } from './layout.components';
import { useOpsStyles } from './ops.styles';

/** A form field for the admin drawers: the shared FieldDef plus an optional custom check and a group heading. */
export interface AdminField extends FieldDef {
  /** Extra validation on the raw form value; returns a message or null. */
  validate?: (value: unknown, all: Record<string, unknown>) => string | null;
  /** Starts a titled group of fields. */
  group?: string;
  /** Short helper shown under the label. */
  helper?: string;
}

/** Maps an API error to a field (e.g. 409 duplicate code → `code`). */
export type ServerErrorMapper = (status: number, message: string) => { field: string; message: string } | null;

/**
 * Create / edit form in a right-side drawer (ce-drawer) built from field definitions. Keeps the testids of the
 * old entity dialog: `dialog-<entity>`, `input-<key>`, `btn-save`, `btn-cancel`. Inline validation, server errors
 * shown in place (409 on the field it concerns), and the Save button is locked while a request is in flight.
 */
@Component({
  selector: 'ce-entity-drawer',
  imports: [ReactiveFormsModule, MatFormFieldModule, MatInputModule, MatSelectModule, MatCheckboxModule, MatIconModule, MatProgressSpinnerModule, DrawerComponent, InfoBannerComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  encapsulation: ViewEncapsulation.None,
  template: `
    <ce-drawer [(open)]="open" [title]="title()" [subtitle]="subtitle()" [size]="size()" [testId]="'dialog-' + entity()" (closed)="closed.emit()">
      @if (open()) {
        <form [formGroup]="form()" (ngSubmit)="save()" class="ops-form" novalidate [attr.id]="formId()">
          @if (serverError()) {
            <ce-info-banner tone="danger" title="Couldn't save" data-testid="form-error">{{ serverError() }}</ce-info-banner>
          }
          <ng-content select="[formTop]" />
          <div class="ops-form-grid">
            @for (f of visibleFields(); track f.key) {
              @if (f.group) {
                <div class="ops-form-group full">{{ f.group }}</div>
              }
              @switch (f.type) {
                @case ('checkbox') {
                  <div class="full ops-check">
                    <mat-checkbox [formControlName]="f.key" [attr.data-testid]="'input-' + f.key">{{ f.label }}</mat-checkbox>
                    @if (f.helper) {
                      <div class="caption">{{ f.helper }}</div>
                    }
                  </div>
                }
                @default {
                  <div class="ops-field" [class.full]="f.full || f.type === 'textarea'">
                    <label class="ce-field-label" [attr.for]="fid(f)">
                      {{ f.label }}
                      @if (f.required) {
                        <span class="ops-req" aria-hidden="true">*</span>
                      }
                    </label>
                    <mat-form-field appearance="outline" subscriptSizing="dynamic" class="w-100">
                      @switch (f.type) {
                        @case ('select') {
                          <mat-select [id]="fid(f)" [formControlName]="f.key" [attr.data-testid]="'input-' + f.key" [placeholder]="f.placeholder ?? 'Select'">
                            @if (!f.required) {
                              <mat-option [value]="null">{{ f.placeholder ?? 'None' }}</mat-option>
                            }
                            @for (o of options(f); track o.value) {
                              <mat-option [value]="o.value">{{ o.label }}</mat-option>
                            }
                          </mat-select>
                        }
                        @case ('multiselect') {
                          <mat-select [id]="fid(f)" [formControlName]="f.key" multiple [attr.data-testid]="'input-' + f.key" [placeholder]="f.placeholder ?? 'Select'">
                            @for (o of options(f); track o.value) {
                              <mat-option [value]="o.value">{{ o.label }}</mat-option>
                            }
                          </mat-select>
                        }
                        @case ('textarea') {
                          <textarea [id]="fid(f)" matInput rows="3" [formControlName]="f.key" [attr.data-testid]="'input-' + f.key" [placeholder]="f.placeholder ?? ''"></textarea>
                        }
                        @default {
                          <input
                            [id]="fid(f)"
                            matInput
                            [type]="inputType(f)"
                            [formControlName]="f.key"
                            [attr.data-testid]="'input-' + f.key"
                            [attr.min]="f.min ?? null"
                            [attr.max]="f.max ?? null"
                            [placeholder]="f.placeholder ?? ''"
                            [attr.autocomplete]="f.type === 'password' ? 'new-password' : 'off'"
                          />
                        }
                      }
                      @if (f.hint) {
                        <mat-hint>{{ f.hint }}</mat-hint>
                      }
                      <mat-error [attr.data-testid]="'error-' + f.key">{{ errorFor(f) }}</mat-error>
                    </mat-form-field>
                  </div>
                }
              }
            }
          </div>
          <ng-content />
        </form>
      }
      <ng-container drawerFooter>
        <button type="button" class="ce-btn ce-btn-ghost" (click)="cancel()" data-testid="btn-cancel">Cancel</button>
        <button type="submit" class="ce-btn ce-btn-primary" [attr.form]="formId()" [disabled]="saving()" data-testid="btn-save">
          @if (saving()) {
            <mat-spinner diameter="16" />
          }
          {{ submitLabel() }}
        </button>
      </ng-container>
    </ce-drawer>
  `,
})
export class EntityDrawerComponent {
  protected readonly opsCss = useOpsStyles();
  readonly open = model(false);
  readonly title = input('');
  readonly subtitle = input<string | null>(null);
  readonly entity = input.required<string>();
  readonly fields = input.required<AdminField[]>();
  /** Current record (edit) or defaults (create); any object with the field keys. */
  readonly value = input<object | null | undefined>(null);
  readonly submitLabel = input('Save');
  readonly size = input<'md' | 'lg'>('md');
  readonly submit = input.required<(payload: Record<string, unknown>) => Observable<unknown>>();
  readonly mapServerError = input<ServerErrorMapper | null>(null);
  readonly saved = output<unknown>();
  readonly closed = output<void>();

  private static seq = 0;
  protected readonly formId = signal(`ops-form-${++EntityDrawerComponent.seq}`);
  readonly saving = signal(false);
  readonly serverError = signal<string | null>(null);
  readonly form = signal(new FormGroup<Record<string, FormControl<unknown>>>({}));
  private readonly formValue = signal<Record<string, unknown>>({});
  private sub: Subscription | null = null;
  private isEdit = false;

  constructor() {
    // rebuild the form each time the drawer opens
    effect(() => {
      if (!this.open()) return;
      const fields = this.fields();
      const value = this.value();
      untracked(() => this.build(fields, (value ?? null) as Record<string, unknown> | null));
    });
  }

  private build(fields: AdminField[], value: Record<string, unknown> | null): void {
    this.isEdit = !!value && value['id'] !== undefined && value['id'] !== null;
    this.serverError.set(null);
    this.saving.set(false);
    const g = new FormGroup<Record<string, FormControl<unknown>>>(
      Object.fromEntries(
        fields.filter((f) => !(f.createOnly && this.isEdit)).map((f) => [f.key, new FormControl<unknown>(toControlValue(f, value?.[f.key]), validatorsFor(f))]),
      ),
    );
    this.sub?.unsubscribe();
    this.formValue.set(g.getRawValue());
    this.sub = g.valueChanges.subscribe(() => {
      this.formValue.set(g.getRawValue());
      if (this.serverError()) this.serverError.set(null);
    });
    this.form.set(g);
  }

  readonly visibleFields = computed(() => {
    const v = this.formValue();
    return this.fields().filter((f) => !(f.createOnly && this.isEdit) && (!f.visible || f.visible(v)));
  });

  fid(f: AdminField): string {
    return `${this.formId()}-${f.key}`;
  }

  options(f: AdminField) {
    return resolveOptions(f, this.formValue());
  }

  inputType(f: AdminField): string {
    return f.type === 'datetime' ? 'datetime-local' : f.type === 'list' ? 'text' : f.type;
  }

  errorFor(f: AdminField): string {
    const c = this.form().get(f.key);
    const e = c?.errors;
    if (!e) return '';
    if (e['server']) return String(e['server']);
    if (e['custom']) return String(e['custom']);
    if (e['required']) return `${f.label.replace(/\s*\(.*\)$/, '')} is required`;
    if (e['email']) return 'Enter a valid email address';
    if (e['min']) return `Minimum ${f.min}`;
    if (e['max']) return `Maximum ${f.max}`;
    if (e['minlength']) return `At least ${e['minlength'].requiredLength} characters`;
    if (e['pattern']) return f.type === 'time' ? 'Use HH:mm (24-hour)' : f.patternMessage ?? 'Invalid format';
    if (e['maxlength']) return `At most ${e['maxlength'].requiredLength} characters`;
    return 'Invalid value';
  }

  cancel(): void {
    this.open.set(false);
    this.closed.emit();
  }

  save(): void {
    if (this.saving()) return;
    const form = this.form();
    const visible = new Set(this.visibleFields().map((f) => f.key));
    for (const [k, c] of Object.entries(form.controls)) {
      if (visible.has(k)) c.enable({ emitEvent: false });
      else c.disable({ emitEvent: false });
    }
    const raw = form.getRawValue() as Record<string, unknown>;
    for (const f of this.fields()) {
      const c = form.get(f.key);
      if (!c || !visible.has(f.key) || !f.validate) continue;
      const msg = c.errors ? null : f.validate(raw[f.key], raw);
      if (msg) c.setErrors({ ...(c.errors ?? {}), custom: msg });
    }
    if (form.invalid) {
      form.markAllAsTouched();
      return;
    }
    const payload: Record<string, unknown> = {};
    for (const f of this.fields()) {
      if (!visible.has(f.key)) continue;
      const v = fromControlValue(f, raw[f.key]);
      if (f.type === 'password' && !v) continue;
      payload[f.key] = v;
    }
    this.saving.set(true);
    this.serverError.set(null);
    this.submit()(payload).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.open.set(false);
        this.saved.emit(res ?? true);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const status = httpStatus(err);
        const msg = status === 403 ? 'You do not have permission to make this change.' : status === 0 ? 'No connection. Check your network and try again.' : apiErrorText(err, 'The server rejected the change.');
        const mapped = this.mapServerError()?.(status, msg);
        const c = mapped ? form.get(mapped.field) : null;
        if (mapped && c) {
          c.setErrors({ server: mapped.message });
          c.markAsTouched();
        } else this.serverError.set(msg);
      },
    });
  }
}
