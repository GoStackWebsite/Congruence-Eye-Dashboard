import { HttpErrorResponse, HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';
import { catchError, throwError } from 'rxjs';
import { environment } from '../../../environments/environment';
import { SILENT_ERRORS } from '../services/api.service';
import { errorMessage } from '../utils/format';
import { AuthService } from './auth.service';

function isApi(url: string): boolean {
  return url.startsWith(environment.apiBaseUrl) || url.startsWith('/uploads');
}

/** Adds `Authorization: Bearer <jwt>` to API requests. */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(AuthService).token();
  if (token && isApi(req.url) && !req.headers.has('Authorization')) {
    req = req.clone({ setHeaders: { Authorization: `Bearer ${token}` } });
  }
  return next(req);
};

/** Global error handling: 401 → logout to /login; other errors → snackbar (unless SILENT_ERRORS). */
export const errorInterceptor: HttpInterceptorFn = (req, next) => {
  const auth = inject(AuthService);
  const snack = inject(MatSnackBar);
  return next(req).pipe(
    catchError((err: unknown) => {
      if (err instanceof HttpErrorResponse) {
        const isLogin = req.url.endsWith('/auth/login');
        if (err.status === 401 && !isLogin) {
          // several requests may fail together: only the first one ends the session
          if (auth.isLoggedIn()) {
            snack.open('Your session has expired. Please sign in again.', 'Dismiss', { duration: 5000, panelClass: 'snack-error' });
            auth.expire();
          }
        } else if (!req.context.get(SILENT_ERRORS)) {
          const msg = err.status === 403 ? 'You do not have permission for this action.' : errorMessage(err);
          snack.open(msg, 'Dismiss', { duration: 6000, panelClass: 'snack-error' });
        }
      }
      return throwError(() => err);
    }),
  );
};
