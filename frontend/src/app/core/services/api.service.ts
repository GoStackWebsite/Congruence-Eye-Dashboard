import { HttpClient, HttpContext, HttpContextToken, HttpResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Observable, map } from 'rxjs';
import { environment } from '../../../environments/environment';
import { QueryObject, buildHttpParams } from '../utils/query-params';

/** Set on a request to suppress the global error snackbar (caller handles the error). */
export const SILENT_ERRORS = new HttpContextToken<boolean>(() => false);

export interface DownloadedFile {
  blob: Blob;
  filename: string;
}

export function silent(): HttpContext {
  return new HttpContext().set(SILENT_ERRORS, true);
}

/** Extracts the filename from a Content-Disposition header (RFC 5987 aware). */
export function filenameFromDisposition(header: string | null, fallback: string): string {
  if (!header) return fallback;
  const star = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(header);
  if (star) {
    try {
      return decodeURIComponent(star[1].trim().replace(/^"|"$/g, ''));
    } catch {
      /* fall through */
    }
  }
  const plain = /filename\s*=\s*("?)([^";]+)\1/i.exec(header);
  return plain ? plain[2].trim() : fallback;
}

type DownloadHook = (blob: Blob, filename: string) => void;
let downloadHook: DownloadHook | null = null;

/** Replaces browser downloads (used by the online demo, where downloads are not possible). */
export function setDownloadHook(hook: DownloadHook | null): void {
  downloadHook = hook;
}

/** Triggers a browser download for a Blob (or the registered download hook). */
export function saveBlob(blob: Blob, filename: string): void {
  if (downloadHook) {
    downloadHook(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly http = inject(HttpClient);
  readonly base = environment.apiBaseUrl;

  url(path: string): string {
    return this.base + (path.startsWith('/') ? path : '/' + path);
  }

  get<T>(path: string, query?: QueryObject | null, context?: HttpContext): Observable<T> {
    return this.http.get<T>(this.url(path), { params: buildHttpParams(query), context });
  }

  post<T>(path: string, body: unknown = {}, query?: QueryObject | null, context?: HttpContext): Observable<T> {
    return this.http.post<T>(this.url(path), body, { params: buildHttpParams(query), context });
  }

  put<T>(path: string, body: unknown, context?: HttpContext): Observable<T> {
    return this.http.put<T>(this.url(path), body, { context });
  }

  patch<T>(path: string, body: unknown = {}, context?: HttpContext): Observable<T> {
    return this.http.patch<T>(this.url(path), body, { context });
  }

  delete<T = unknown>(path: string, context?: HttpContext): Observable<T> {
    return this.http.delete<T>(this.url(path), { context });
  }

  /** multipart/form-data POST (browser sets the boundary). */
  upload<T>(path: string, form: FormData, context?: HttpContext): Observable<T> {
    return this.http.post<T>(this.url(path), form, { context });
  }

  download(path: string, query?: QueryObject | null, fallbackName = 'download'): Observable<DownloadedFile> {
    return this.http
      .get(this.url(path), { params: buildHttpParams(query), observe: 'response', responseType: 'blob' })
      .pipe(
        map((res: HttpResponse<Blob>) => ({
          blob: res.body ?? new Blob(),
          filename: filenameFromDisposition(res.headers.get('Content-Disposition'), fallbackName),
        })),
      );
  }
}
