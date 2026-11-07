import { ChildProcess, execFileSync, execSync, spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import {
  AI_DIR, AI_PORT, AI_PYTHON, AI_URL, API_URL, AUTH_DIR, BACKEND_DIR, BACKEND_PORT, DB_PATH, E2E_DIR, EDGE_KEY_STORE_1,
  FFMPEG, FRONTEND_DIR, MEDIA_DIR, PASSWORD, SETUP_STATE, TMP, UPLOAD_DIR, USERS, WEB_PORT, WEB_URL, RoleKey, addDays, storageStatePath, todayLocal,
} from './support/env';

const PID_FILE = path.join(TMP, 'pids.json');

function newestMtime(dir: string): number {
  let newest = 0;
  const walk = (d: string) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else newest = Math.max(newest, fs.statSync(p).mtimeMs);
    }
  };
  walk(dir);
  return newest;
}

function buildIfNeeded(name: string, cwd: string, srcDir: string, output: string) {
  const outMtime = fs.existsSync(output) ? fs.statSync(output).mtimeMs : 0;
  if (!outMtime || newestMtime(srcDir) > outMtime || process.env.E2E_FORCE_BUILD === 'true') {
    console.log(`[setup] building ${name}…`);
    execSync('npm run build', { cwd, stdio: 'inherit', env: { ...process.env, NG_CLI_ANALYTICS: 'false' } });
  } else {
    console.log(`[setup] ${name} build is up to date`);
  }
}

export function killRecorded() {
  if (!fs.existsSync(PID_FILE)) return;
  try {
    const pids: number[] = JSON.parse(fs.readFileSync(PID_FILE, 'utf8'));
    for (const pid of pids) {
      try {
        process.kill(-pid, 'SIGTERM'); // whole process group
      } catch {
        try { process.kill(pid, 'SIGTERM'); } catch { /* gone */ }
      }
    }
  } catch { /* ignore */ }
  fs.rmSync(PID_FILE, { force: true });
}

async function waitFor(url: string, timeoutMs: number, proc: ChildProcess, name: string) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (proc.exitCode !== null) throw new Error(`${name} exited with code ${proc.exitCode} (see .tmp/${name}.log)`);
    try {
      const r = await fetch(url);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`${name} did not become ready at ${url}`);
}

/** fetch with a fresh connection and a couple of retries (a pooled keep-alive socket may have been closed by the server). */
async function fetchRetry(url: string, init: RequestInit = {}, attempts = 3): Promise<Response> {
  let last: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fetch(url, { ...init, headers: { ...(init.headers as Record<string, string>), connection: 'close' } });
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 500));
    }
  }
  throw last;
}

async function portFree(port: number): Promise<boolean> {
  try {
    await fetch(`http://127.0.0.1:${port}/`, { signal: AbortSignal.timeout(1000) });
    return false;
  } catch {
    return true;
  }
}

function start(name: string, cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): ChildProcess {
  const log = fs.openSync(path.join(TMP, `${name}.log`), 'w');
  const p = spawn(cmd, args, { cwd, env, detached: true, stdio: ['ignore', log, log] });
  p.unref();
  return p;
}

export default async function globalSetup() {
  try {
    return await setup();
  } catch (e) {
    killRecorded(); // never leave servers behind when setup fails
    throw e;
  }
}

async function setup() {
  // developer loop: E2E_REUSE=true reuses servers left running by a previous E2E_KEEP=true run
  if (process.env.E2E_REUSE === 'true' && fs.existsSync(PID_FILE) && fs.existsSync(SETUP_STATE)) {
    try {
      if ((await fetch(`${API_URL}/api/health`)).ok && (await fetch(`${AI_URL}/health`)).ok) {
        console.log('[setup] reusing running servers (E2E_REUSE=true)');
        return;
      }
    } catch { /* fall through to a fresh setup */ }
  }
  killRecorded();
  for (const port of [BACKEND_PORT, WEB_PORT, AI_PORT]) {
    if (!(await portFree(port))) throw new Error(`port ${port} is already in use; stop the process using it first`);
  }

  // fresh state
  fs.rmSync(TMP, { recursive: true, force: true });
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });

  console.log('[setup] generating media fixtures…');
  execFileSync(AI_PYTHON, [path.join(E2E_DIR, 'fixtures', 'make_media.py'), MEDIA_DIR, FFMPEG], { stdio: 'inherit' });

  buildIfNeeded('backend', BACKEND_DIR, path.join(BACKEND_DIR, 'src'), path.join(BACKEND_DIR, 'dist', 'main.js'));
  buildIfNeeded('frontend', FRONTEND_DIR, path.join(FRONTEND_DIR, 'src'), path.join(FRONTEND_DIR, 'dist', 'frontend', 'browser', 'index.html'));

  const backendEnv: NodeJS.ProcessEnv = {
    ...process.env,
    DB_TYPE: 'sqlite',
    DB_PATH,
    UPLOAD_DIR,
    PORT: String(BACKEND_PORT),
    HOST: '127.0.0.1',
    JWT_SECRET: 'e2e-secret',
    // background jobs (minute alert evaluation, camera staleness, scheduled reports) are disabled so the suite
    // is deterministic; tests trigger evaluation explicitly via POST /api/alerts/evaluate
    DISABLE_CRON: 'true',
    SMTP_HOST: '',
    AI_SERVICE_URL: AI_URL,
  };

  console.log('[setup] seeding a fresh sqlite database…');
  execSync('node dist/seed/seed.js', {
    cwd: BACKEND_DIR,
    stdio: 'inherit',
    env: { ...backendEnv, SEED_RESET: 'true', SEED_DAYS: process.env.E2E_SEED_DAYS || '30' },
  });

  const backend = start('backend', process.execPath, ['dist/main.js'], BACKEND_DIR, backendEnv);
  const web = start(
    'web',
    process.execPath,
    [path.join(E2E_DIR, 'support', 'static-server.mjs'), String(WEB_PORT), API_URL, path.join(FRONTEND_DIR, 'dist', 'frontend', 'browser')],
    E2E_DIR,
    process.env,
  );
  const ai = start('ai', AI_PYTHON, ['-m', 'congruence_eye_ai', 'api'], AI_DIR, {
    ...process.env,
    API_HOST: '127.0.0.1',
    API_PORT: String(AI_PORT),
    BACKEND_URL: API_URL,
    SPOOL_DIR: path.join(TMP, 'ai-spool'),
    LOG_LEVEL: 'INFO',
  });
  fs.writeFileSync(PID_FILE, JSON.stringify([backend.pid, web.pid, ai.pid]));

  await waitFor(`${API_URL}/api/health`, 60_000, backend, 'backend');
  await waitFor(`${WEB_URL}/login`, 20_000, web, 'web');
  await waitFor(`${WEB_URL}/api/health`, 20_000, web, 'web');
  await waitFor(`${AI_URL}/health`, 90_000, ai, 'ai');
  console.log('[setup] backend, web server and ai-service are up');

  // ---- edge data from the real simulator: today's scenario (ends now) and a full store day for yesterday
  const today = todayLocal();
  const yesterday = addDays(today, -1);
  const simulate = (extra: string[], label: string) => {
    const out = execFileSync(
      AI_PYTHON,
      ['-m', 'congruence_eye_ai.simulate', '--backend', API_URL, '--key', EDGE_KEY_STORE_1, '--once',
        '--spool-dir', path.join(TMP, `spool-setup-${label}`), ...extra],
      { cwd: AI_DIR, timeout: 240_000, maxBuffer: 20 * 1024 * 1024, env: { ...process.env, LOG_LEVEL: 'WARNING' } },
    ).toString();
    const summary = JSON.parse(out.slice(out.indexOf('{')));
    if (summary.spoolPendingItems) throw new Error(`simulator (${label}) left ${summary.spoolPendingItems} undelivered items`);
    return summary;
  };
  console.log('[setup] simulator: store 1, today…');
  const simToday = simulate([], 'today');
  console.log(`[setup] simulator: store 1, ${yesterday}…`);
  const simYesterday = simulate(['--date', yesterday], 'yesterday');

  // ---- recap video for yesterday (built from the seed's and the simulator's snapshots)
  const adminLogin = await (await fetchRetry(`${API_URL}/api/auth/login`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: USERS.admin, password: PASSWORD }),
  })).json() as { accessToken: string };
  const rr = await fetchRetry(`${API_URL}/api/recaps/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${adminLogin.accessToken}` },
    body: JSON.stringify({ storeId: 1, date: yesterday }),
  });
  if (!rr.ok) throw new Error(`recap generation failed: ${rr.status} ${await rr.text()}`);
  const recap = (await rr.json()) as { id: number; status: string; durationSec: number };
  if (recap.status !== 'READY') throw new Error(`recap not READY: ${JSON.stringify(recap)}`);
  console.log(`[setup] recap ${recap.id} READY (${recap.durationSec}s)`);
  fs.writeFileSync(SETUP_STATE, JSON.stringify({ today, yesterday, simToday, simYesterday, recap }, null, 2));

  // one storageState per role (JWT + user in localStorage, exactly what the SPA stores after login)
  for (const role of Object.keys(USERS) as RoleKey[]) {
    const r = await fetchRetry(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: USERS[role], password: PASSWORD }),
    });
    if (!r.ok) throw new Error(`login failed for ${role}: ${r.status}`);
    const { accessToken, user } = (await r.json()) as { accessToken: string; user: unknown };
    fs.writeFileSync(
      storageStatePath(role),
      JSON.stringify({
        cookies: [],
        origins: [
          {
            origin: WEB_URL,
            localStorage: [
              { name: 'ce.token', value: accessToken },
              { name: 'ce.user', value: JSON.stringify(user) },
            ],
          },
        ],
      }),
    );
    fs.writeFileSync(path.join(AUTH_DIR, `${role}.token`), accessToken);
  }

}
