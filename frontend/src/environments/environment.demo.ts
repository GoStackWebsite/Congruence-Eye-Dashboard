/** Online demo build: no backend — every /api call is served in the browser from captured data. */
export const environment = {
  production: true,
  apiBaseUrl: '/api',
  streamPath: '/stream',
  notificationPollMs: 60_000,
  liveRefreshMs: 15_000,
  demo: true,
};
