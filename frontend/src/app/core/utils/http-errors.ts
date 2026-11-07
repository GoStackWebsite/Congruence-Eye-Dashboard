/** HTTP status of an HttpErrorResponse-like error (0 = no connection / unknown). */
export function httpStatus(err: unknown): number {
  return typeof err === 'object' && err && 'status' in err ? Number((err as { status: unknown }).status) || 0 : 0;
}

/** Message from an API error body (`message` may be a string or a list). */
export function apiErrorText(err: unknown, fallback = 'Something went wrong'): string {
  const body = typeof err === 'object' && err && 'error' in err ? (err as { error: unknown }).error : null;
  const m = body && typeof body === 'object' && 'message' in body ? (body as { message: unknown }).message : null;
  if (Array.isArray(m)) return m.join('. ');
  if (typeof m === 'string' && m) return m;
  return fallback;
}
