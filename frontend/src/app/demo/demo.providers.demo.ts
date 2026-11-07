import { HashLocationStrategy, LocationStrategy } from '@angular/common';
import { HttpErrorResponse, HttpHeaders, HttpInterceptorFn, HttpResponse } from '@angular/common/http';
import { EnvironmentProviders, Provider, inject, provideAppInitializer } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { catchError, defer, delay, from, map, throwError } from 'rxjs';
import { setDownloadHook } from '../core/services/api.service';
import { DemoBackend, DemoError } from './demo-backend';
import { DemoDb } from './demo-db';
import { DemoFilePreviewDialog } from './demo-file-preview.dialog';

const backend = new DemoBackend(new DemoDb());

/**
 * Serves every /api request in the browser (online demo). It is the last interceptor, so the
 * auth header and the global error handling still apply exactly as with the real backend.
 */
export const demoBackendInterceptor: HttpInterceptorFn = (req, next) => {
  const url = req.url;
  if (!url.startsWith('/api/') && url !== '/api') return next(req);
  const [path, query] = url.slice(4).split('?');
  const params = new URLSearchParams(query ?? '');
  for (const k of req.params.keys()) params.set(k, req.params.getAll(k)!.join(','));
  return defer(() => from(backend.handle({ method: req.method, path: path || '/', params, body: req.body, auth: req.headers.get('Authorization') }))).pipe(
    delay(60),
    map((res) => new HttpResponse({ status: res.status, statusText: 'OK', url, body: res.body, headers: new HttpHeaders(res.headers ?? {}) })),
    catchError((e: unknown) => throwError(() => toHttpError(e, req.method, url))),
  );
};

const STATUS_TEXT: Record<number, string> = { 400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found', 409: 'Conflict', 413: 'Payload Too Large', 422: 'Unprocessable Entity' };

/** Same error body shape as NestJS so the global error interceptor behaves as with the real API. */
export function toHttpError(e: unknown, method: string, url: string): HttpErrorResponse {
  if (e instanceof DemoError) {
    const statusText = STATUS_TEXT[e.status] ?? 'Error';
    return new HttpErrorResponse({ status: e.status, statusText, url, error: { statusCode: e.status, message: e.message, error: statusText, ...(e.extra ?? {}) } });
  }
  console.warn('[demo] request failed', method, url, e);
  return new HttpErrorResponse({ status: 500, statusText: 'Internal Server Error', url, error: { statusCode: 500, message: 'Demo backend error', error: 'Internal Server Error' } });
}

export const DEMO_INTERCEPTORS: HttpInterceptorFn[] = [demoBackendInterceptor];

export const DEMO_PROVIDERS: (Provider | EnvironmentProviders)[] = [
  // the demo is hosted under an unknown sub-path: hash routing needs no <base href> or server rewrites
  { provide: LocationStrategy, useClass: HashLocationStrategy },
  provideAppInitializer(() => {
    const dialog = inject(MatDialog);
    // downloads are inert in the demo host → preview the file in-app instead
    setDownloadHook((blob, filename) => {
      dialog.open(DemoFilePreviewDialog, { data: { blob, filename }, width: '960px', maxWidth: '96vw' });
    });
  }),
];
