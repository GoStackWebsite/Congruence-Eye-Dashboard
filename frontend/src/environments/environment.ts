export const environment = {
  production: true,
  apiBaseUrl: '/api',
  /** SSE stream endpoint (relative to apiBaseUrl) */
  streamPath: '/stream',
  notificationPollMs: 60_000,
  liveRefreshMs: 15_000,
  /** true only in the `demo` build (no backend; in-browser demo data). */
  demo: false,
};
