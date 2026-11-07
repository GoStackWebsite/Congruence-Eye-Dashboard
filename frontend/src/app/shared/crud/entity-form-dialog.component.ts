import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormControl, FormGroup, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressSpinnerModule } from '@angular/material/progress-spinner';
import { MatSelectModule } from '@angular/material/select';
import { Observable } from 'rxjs';
import { apiErrorText, httpStatus } from '../../core/utils/http-errors';
import { InfoBannerComponent } from '../ds/layout.components';
import { FieldDef, fromControlValue, resolveOptions, toControlValue, validatorsFor } from './field';

export interface EntityFormData {
  title: string;
  /** testid base, e.g. "store" → dialog-store */
  entity: string;
  fields: FieldDef[];
  value?: Record<string, unknown> | null;
  submitLabel?: string;
  submit: (payload: Record<string, unknown>) => Observable<unknown>;
}

@Component({
  selector: 'ce-entity-form-dialog',
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatCheckboxModule,
    MatButtonModule,
    MatProgressSpinnerModule,
    InfoBannerComponent,
  ],
  template: `
    <h2 mat-dialog-title>{{ data.title }}</h2>
    <form [formGroup]="form" (ngSubmit)="save()" [attr.data-testid]="'dialog-' + data.entity" novalidate>
      <mat-dialog-content class="form-grid">
        @if (serverError()) {
          <ce-info-banner class="full" tone="danger" title="Couldn't save" data-testid="form-error">{{ serverError() }}</ce-info-banner>
        }
        @for (f of visibleFields(); track f.key) {
          @switch (f.type) {
            @case ('checkbox') {
              <mat-checkbox [formControlName]="f.key" [attr.data-testid]="'input-' + f.key" class="full">{{ f.label }}</mat-checkbox>
            }
            @case ('select') {
              <mat-form-field [class.full]="f.full">
                <mat-label>{{ f.label }}</mat-label>
                <mat-select [formControlName]="f.key" [attr.data-testid]="'input-' + f.key">
                  @if (!f.required) {
                    <mat-option [value]="null">—</mat-option>
                  }
                  @for (o of options(f); track o.value) {
                    <mat-option [value]="o.value">{{ o.label }}</mat-option>
                  }
                </mat-select>
                @if (f.hint) {
                  <mat-hint>{{ f.hint }}</mat-hint>
                }
                <mat-error>{{ f.label }} is required</mat-error>
              </mat-form-field>
            }
            @case ('multiselect') {
              <mat-form-field [class.full]="f.full">
                <mat-label>{{ f.label }}</mat-label>
                <mat-select [formControlName]="f.key" multiple [attr.data-testid]="'input-' + f.key">
                  @for (o of options(f); track o.value) {
                    <mat-option [value]="o.value">{{ o.label }}</mat-option>
                  }
                </mat-select>
                @if (f.hint) {
                  <mat-hint>{{ f.hint }}</mat-hint>
                }
              </mat-form-field>
            }
            @case ('textarea') {
              <mat-form-field class="full">
                <mat-label>{{ f.label }}</mat-label>
                <textarea matInput rows="3" [formControlName]="f.key" [attr.data-testid]="'input-' + f.key" [placeholder]="f.placeholder ?? ''"></textarea>
                @if (f.hint) {
                  <mat-hint>{{ f.hint }}</mat-hint>
                }
              </mat-form-field>
            }
            @default {
              <mat-form-field [class.full]="f.full">
                <mat-label>{{ f.label }}</mat-label>
                <input
                  matInput
                  [type]="inputType(f)"
                  [formControlName]="f.key"
                  [attr.data-testid]="'input-' + f.key"
                  [attr.min]="f.min ?? null"
                  [attr.max]="f.max ?? null"
                  [placeholder]="f.placeholder ?? ''"
                  [attr.autocomplete]="f.type === 'password' ? 'new-password' : null"
                />
                @if (f.hint) {
                  <mat-hint>{{ f.hint }}</mat-hint>
                }
                <mat-error>{{ errorFor(f) }}</mat-error>
              </mat-form-field>
            }
          }
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close data-testid="btn-cancel">Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()" data-testid="btn-save">
          @if (saving()) {
            <mat-spinner diameter="18" />
          }
          {{ data.submitLabel ?? 'Save' }}
        </button>
      </mat-dialog-actions>
    </form>
  `,
})
export class EntityFormDialogComponent {
  readonly data = inject<EntityFormData>(MAT_DIALOG_DATA);
  private readonly ref = inject(MatDialogRef<EntityFormDialogComponent>);
  readonly saving = signal(false);
  /** The server's validation message (e.g. "assignee does not work at this store"), shown in the form. */
  readonly serverError = signal<string | null>(null);
  private readonly isEdit = !!this.data.value;

  readonly form = new FormGroup(
    Object.fromEntries(
      this.data.fields
        .filter((f) => !(f.createOnly && this.isEdit))
        .map((f) => [f.key, new FormControl<unknown>(toControlValue(f, this.data.value?.[f.key]), validatorsFor(f))]),
    ),
  );
  private readonly value = toSignal(this.form.valueChanges, { initialValue: this.form.getRawValue() });
  readonly visibleFields = computed(() => {
    const v = this.value() as Record<string, unknown>;
    return this.data.fields.filter((f) => !(f.createOnly && this.isEdit) && (!f.visible || f.visible(v)));
  });

  options(f: FieldDef) {
    return resolveOptions(f, this.value() as Record<string, unknown>);
  }

  inputType(f: FieldDef): string {
    switch (f.type) {
      case 'datetime':
        return 'datetime-local';
      case 'list':
        return 'text';
      default:
        return f.type;
    }
  }

  errorFor(f: FieldDef): string {
    const c = this.form.get(f.key);
    if (!c?.errors) return '';
    if (c.errors['required']) return `${f.label} is required`;
    if (c.errors['email']) return 'Enter a valid email';
    if (c.errors['min']) return `Minimum ${f.min}`;
    if (c.errors['max']) return `Maximum ${f.max}`;
    if (c.errors['minlength']) return `At least ${c.errors['minlength'].requiredLength} characters`;
    if (c.errors['pattern']) return f.type === 'time' ? 'Use HH:mm' : f.patternMessage ?? 'Invalid format';
    if (c.errors['maxlength']) return `At most ${c.errors['maxlength'].requiredLength} characters`;
    return 'Invalid value';
  }

  save(): void {
    const visible = new Set(this.visibleFields().map((f) => f.key));
    // ignore validation on hidden fields
    for (const [k, c] of Object.entries(this.form.controls)) {
      if (visible.has(k)) c.enable({ emitEvent: false });
      else c.disable({ emitEvent: false });
    }
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const raw = this.form.getRawValue() as Record<string, unknown>;
    const payload: Record<string, unknown> = {};
    for (const f of this.data.fields) {
      if (!visible.has(f.key)) continue;
      const v = fromControlValue(f, raw[f.key]);
      if (f.type === 'password' && !v) continue;
      payload[f.key] = v;
    }
    this.saving.set(true);
    this.serverError.set(null);
    this.data.submit(payload).subscribe({
      next: (res) => {
        this.saving.set(false);
        this.ref.close(res ?? true);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        const status = httpStatus(err);
        this.serverError.set(status === 403 ? 'You do not have permission to make this change.' : status === 0 ? 'No connection. Check your network and try again.' : apiErrorText(err, 'The server rejected the change.'));
      },
    });
  }
}
