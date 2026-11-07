import { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.setup';
import { TestSeed, testSeed } from '../src/seed/test-seed';

export interface Ctx {
  app: NestExpressApplication;
  ds: DataSource;
  seed: TestSeed;
  http: () => ReturnType<typeof request>;
  tokens: Record<string, string>;
}

export const EMAILS = {
  admin: 'admin@congruence.in',
  regional: 'regional@congruence.in',
  manager: 'manager.tnagar@congruence.in',
  auditor: 'auditor@congruence.in',
  staff: 'staff.tnagar@congruence.in',
};

/** Fresh app + in-memory sqlite + light seed + tokens for every seed user. */
export async function createTestApp(): Promise<Ctx> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: ['error'] });
  configureApp(app, { swagger: false });
  await app.init();
  const ds = app.get(DataSource);
  const seed = await testSeed(ds);
  const http = () => request(app.getHttpServer());
  const tokens: Record<string, string> = {};
  for (const [k, email] of Object.entries(EMAILS)) {
    const res = await http().post('/api/auth/login').send({ email, password: 'Password@123' });
    if (res.status !== 200) throw new Error(`login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
    tokens[k] = res.body.accessToken;
  }
  return { app, ds, seed, http, tokens };
}

export const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });

/** ISO timestamp for today (Asia/Kolkata) at HH:mm local. */
export function istToday(hhmm: string, dayOffset = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600_000);
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + dayOffset));
  const [h, m] = hhmm.split(':').map(Number);
  return new Date(d.getTime() + (h * 60 + m) * 60_000 - 5.5 * 3600_000).toISOString();
}
export function istDate(dayOffset = 0): string {
  const now = new Date(Date.now() + 5.5 * 3600_000 + dayOffset * 86400_000);
  return now.toISOString().slice(0, 10);
}
