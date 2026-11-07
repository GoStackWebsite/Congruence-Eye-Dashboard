import { defineConfig, devices } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { WEB_URL, TZ } from './support/env';

/** Use the bundled browser under PLAYWRIGHT_BROWSERS_PATH; fall back to an explicit binary if revisions differ. */
function chromiumExecutable(): string | undefined {
  if (process.env.E2E_CHROMIUM) return process.env.E2E_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH || '/opt/pw-browsers';
  const browsersJson = path.join(path.dirname(require.resolve('playwright-core/package.json')), 'browsers.json');
  const rev = JSON.parse(fs.readFileSync(browsersJson, 'utf8')).browsers.find((b: { name: string }) => b.name === 'chromium').revision;
  if (fs.existsSync(path.join(root, `chromium-${rev}`))) return undefined; // matching revision: Playwright finds it
  for (const cand of ['chromium/chrome-linux/chrome', ...fs.readdirSync(root).filter((d) => d.startsWith('chromium-')).map((d) => `${d}/chrome-linux/chrome`)]) {
    const p = path.join(root, cand);
    if (fs.existsSync(p)) return p;
  }
  return undefined;
}

export default defineConfig({
  testDir: './tests',
  outputDir: './test-results',
  globalSetup: './global-setup.ts',
  globalTeardown: './global-teardown.ts',
  fullyParallel: false,
  workers: Number(process.env.E2E_WORKERS || 2),
  retries: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [['list'], ['html', { outputFolder: 'playwright-report', open: 'never' }]],
  use: {
    baseURL: WEB_URL,
    timezoneId: TZ,
    locale: 'en-IN',
    viewport: { width: 1440, height: 900 },
    trace: 'retain-on-first-failure', // the trace of the original failure is kept (HTML report links it)
    screenshot: 'only-on-failure',
    video: 'off',
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
    acceptDownloads: true,
    serviceWorkers: 'block', // see support/fixtures.ts; tests/pwa.spec.ts allows it explicitly
    launchOptions: { executablePath: chromiumExecutable() },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1440, height: 900 } } }],
});
