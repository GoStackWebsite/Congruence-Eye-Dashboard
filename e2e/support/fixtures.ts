import { APIRequestContext, APIResponse, Browser, BrowserContext, Page, test as base, expect, request as pwRequest } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { API_URL, AUTH_DIR, PASSWORD, RoleKey, TZ, USERS, WEB_URL, storageStatePath } from './env';

export function tokenFor(role: RoleKey): string {
  return fs.readFileSync(path.join(AUTH_DIR, `${role}.token`), 'utf8').trim();
}

/** Thin typed wrapper around an APIRequestContext bound to one user. */
export class Api {
  constructor(readonly ctx: APIRequestContext, readonly token: string | null) {}

  static async create(token: string | null, extraHeaders: Record<string, string> = {}): Promise<Api> {
    const headers: Record<string, string> = { ...extraHeaders };
    if (token) headers.Authorization = `Bearer ${token}`;
    const ctx = await pwRequest.newContext({ baseURL: API_URL, extraHTTPHeaders: headers });
    return new Api(ctx, token);
  }

  static async login(email: string, password = PASSWORD): Promise<Api> {
    const tmp = await pwRequest.newContext({ baseURL: API_URL });
    const r = await tmp.post('/api/auth/login', { data: { email, password } });
    expect(r.status(), `login ${email}`).toBe(200);
    const { accessToken } = await r.json();
    await tmp.dispose();
    return Api.create(accessToken);
  }

  private async unwrap<T>(r: APIResponse, what: string, expected?: number | number[]): Promise<T> {
    const ok = expected === undefined ? r.ok() : ([] as number[]).concat(expected).includes(r.status());
    if (!ok) throw new Error(`${what} → ${r.status()} ${await r.text()}`);
    const text = await r.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }

  async get<T = any>(url: string, params?: Record<string, string | number | boolean>): Promise<T> {
    // idempotent: retry once when a pooled keep-alive socket was closed by the server at the same moment (ECONNRESET)
    let r: APIResponse;
    try {
      r = await this.ctx.get(url, { params });
    } catch (e) {
      if (!/ECONNRESET|socket hang up/.test(String(e))) throw e;
      r = await this.ctx.get(url, { params });
    }
    return this.unwrap<T>(r, `GET ${url}`);
  }
  async post<T = any>(url: string, data?: unknown): Promise<T> {
    return this.unwrap<T>(await this.ctx.post(url, { data }), `POST ${url}`);
  }
  async patch<T = any>(url: string, data?: unknown): Promise<T> {
    return this.unwrap<T>(await this.ctx.patch(url, { data }), `PATCH ${url}`);
  }
  async put<T = any>(url: string, data?: unknown): Promise<T> {
    return this.unwrap<T>(await this.ctx.put(url, { data }), `PUT ${url}`);
  }
  async delete<T = any>(url: string): Promise<T> {
    return this.unwrap<T>(await this.ctx.delete(url), `DELETE ${url}`);
  }
  dispose() {
    return this.ctx.dispose();
  }
}

type Fixtures = {
  /** API client for a seeded role (token from global setup). */
  api: (role?: RoleKey) => Promise<Api>;
  /** A fresh logged-in page for a role (own browser context). */
  pageAs: (role: RoleKey) => Promise<Page>;
};

export const test = base.extend<Fixtures>({
  api: async ({}, use) => {
    const made: Api[] = [];
    await use(async (role: RoleKey = 'admin') => {
      const a = await Api.create(tokenFor(role));
      made.push(a);
      return a;
    });
    await Promise.all(made.map((a) => a.dispose()));
  },
  pageAs: async ({ browser }, use) => {
    const contexts: BrowserContext[] = [];
    await use(async (role: RoleKey) => {
      const ctx = await newRoleContext(browser, role);
      contexts.push(ctx);
      return ctx.newPage();
    });
    await Promise.all(contexts.map((c) => c.close()));
  },
});

export async function newRoleContext(browser: Browser, role: RoleKey): Promise<BrowserContext> {
  return browser.newContext({
    storageState: storageStatePath(role),
    baseURL: WEB_URL,
    timezoneId: TZ,
    locale: 'en-IN',
    viewport: { width: 1440, height: 900 },
    acceptDownloads: true,
    // the PWA service worker would hide requests from page.route (pwa.spec.ts tests it in its own context)
    serviceWorkers: 'block',
  });
}

export { expect, USERS };
