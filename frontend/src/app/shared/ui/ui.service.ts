import { Injectable, inject } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { Observable, filter, map } from 'rxjs';
import { EntityFormData, EntityFormDialogComponent } from '../crud/entity-form-dialog.component';
import { ConfirmData, ConfirmDialogComponent } from './ui.components';

@Injectable({ providedIn: 'root' })
export class UiService {
  private readonly dialog = inject(MatDialog);
  private readonly snack = inject(MatSnackBar);

  toast(message: string, action = 'OK'): void {
    this.snack.open(message, action, { duration: 3500, panelClass: 'snack-ok' });
  }

  /**
   * Emits only when confirmed. The backdrop ignores clicks during the first 500 ms: the second tap of a double tap on
   * the button that opened the dialog must not dismiss it straight away (Escape and Cancel always work).
   */
  confirm(data: ConfirmData): Observable<true> {
    const ref = this.dialog.open(ConfirmDialogComponent, { data, width: '420px', maxWidth: '96vw', autoFocus: 'dialog', disableClose: true });
    const opened = Date.now();
    ref.backdropClick().subscribe(() => {
      if (Date.now() - opened > 500) ref.close(false);
    });
    ref.keydownEvents().subscribe((e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        ref.close(false);
      }
    });
    return ref
      .afterClosed()
      .pipe(
        filter((ok) => ok === true),
        map(() => true as const),
      );
  }

  /**
   * Opens the generic entity form as a DS side panel (right sheet, like ce-drawer; full screen on phones); emits the
   * submit result when saved.
   */
  form<T = unknown>(data: EntityFormData, width = '480px'): Observable<T> {
    return this.dialog
      .open(EntityFormDialogComponent, {
        data,
        width,
        maxWidth: '100vw',
        height: '100%',
        maxHeight: '100vh',
        position: { top: '0', right: '0' },
        panelClass: 'ce-side-sheet',
        autoFocus: 'first-tabbable',
      })
      .afterClosed()
      .pipe(filter((r) => r !== undefined && r !== false && r !== '')) as Observable<T>;
  }
}
