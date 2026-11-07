import { inject } from '@angular/core';
import { CanDeactivateFn } from '@angular/router';
import { defaultIfEmpty, map } from 'rxjs';
import { AuthService } from '../../core/auth/auth.service';
import { UiService } from '../ui/ui.service';

/** Implemented by editors (template builder, checklist fill) that hold unsaved work. */
export interface HasUnsavedChanges {
  /** True when leaving would lose work. */
  hasUnsavedChanges(): boolean;
}

/** Asks before leaving a page with unsaved changes (route-level). Pair with a `beforeunload` listener for reloads. */
export const unsavedChangesGuard: CanDeactivateFn<HasUnsavedChanges> = (component) => {
  if (!component?.hasUnsavedChanges?.()) return true;
  // the session ended (401 → /login?returnUrl=…): nothing can be saved any more, so don't block the redirect;
  // editors keep a local copy of unsaved work and offer it again after signing in
  if (!inject(AuthService).isLoggedIn()) return true;
  const ui = inject(UiService);
  return ui
    .confirm({
      title: 'Leave without saving?',
      message: 'You have changes that are not saved yet. If you leave now they will be lost.',
      confirmText: 'Leave page',
      danger: true,
    })
    .pipe(
      map(() => true),
      defaultIfEmpty(false),
    );
};
