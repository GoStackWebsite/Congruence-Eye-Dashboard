import { Component, inject, signal } from '@angular/core';
import { AbstractControl, FormBuilder, ReactiveFormsModule, ValidationErrors, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { AuthService } from '../core/auth/auth.service';
import { UiService } from '../shared/ui/ui.service';

export function passwordsMatch(group: AbstractControl): ValidationErrors | null {
  const a = group.get('newPassword')?.value;
  const b = group.get('confirm')?.value;
  return a && b && a !== b ? { mismatch: true } : null;
}

@Component({
  selector: 'ce-change-password-dialog',
  imports: [ReactiveFormsModule, MatDialogModule, MatFormFieldModule, MatInputModule, MatButtonModule],
  template: `
    <h2 mat-dialog-title>Change password</h2>
    <form [formGroup]="form" (ngSubmit)="save()" data-testid="dialog-change-password">
      <mat-dialog-content class="form-grid single">
        <mat-form-field>
          <mat-label>Current password</mat-label>
          <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" data-testid="input-current-password" />
        </mat-form-field>
        <mat-form-field>
          <mat-label>New password</mat-label>
          <input matInput type="password" formControlName="newPassword" autocomplete="new-password" data-testid="input-new-password" />
          <mat-hint>At least 8 characters</mat-hint>
          <mat-error>At least 8 characters</mat-error>
        </mat-form-field>
        <mat-form-field>
          <mat-label>Confirm new password</mat-label>
          <input matInput type="password" formControlName="confirm" autocomplete="new-password" data-testid="input-confirm-password" />
        </mat-form-field>
        @if (form.hasError('mismatch') && form.get('confirm')?.touched) {
          <div class="form-error" data-testid="error-mismatch">Passwords do not match</div>
        }
      </mat-dialog-content>
      <mat-dialog-actions align="end">
        <button mat-button type="button" mat-dialog-close data-testid="btn-cancel">Cancel</button>
        <button mat-flat-button type="submit" [disabled]="saving()" data-testid="btn-save">Update password</button>
      </mat-dialog-actions>
    </form>
  `,
})
export class ChangePasswordDialogComponent {
  private readonly auth = inject(AuthService);
  private readonly ui = inject(UiService);
  private readonly ref = inject(MatDialogRef<ChangePasswordDialogComponent>);
  readonly saving = signal(false);
  readonly form = inject(FormBuilder).nonNullable.group(
    {
      currentPassword: ['', Validators.required],
      newPassword: ['', [Validators.required, Validators.minLength(8)]],
      confirm: ['', Validators.required],
    },
    { validators: passwordsMatch },
  );

  save(): void {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    const { currentPassword, newPassword } = this.form.getRawValue();
    this.saving.set(true);
    this.auth.changePassword({ currentPassword, newPassword }).subscribe({
      next: () => {
        this.ui.toast('Password updated');
        this.ref.close(true);
      },
      error: () => this.saving.set(false),
    });
  }
}
