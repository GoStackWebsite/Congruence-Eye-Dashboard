/**
 * QA §9 performance bench (docs/qa/EDGE_CASE_PLAN.md). Run against a seeded backend (90 days × 6 stores):
 *
 *   PORT=3400 node dist/main &            # the seeded data/dev.sqlite
 *   npx ts-node scripts/perf-bench.ts      # BASE_URL=http://localhost:3400 RUNS=20
 *
 * Measures p50/p95 of every analytics endpoint over a 90-day, all-stores range (target p95 < 800 ms on
 * SQLite) and of paged lists over the largest tables (target < 500 ms), and exits 1 when a target is missed.
 */
const BASE = process.env.BASE_URL || 'http://localhost:3400';
const RUNS = parseInt(process.env.RUNS || '20', 10);

const dateOf = (offset: number) => new Date(Date.now() + 5.5 * 3600_000 + offset * 86400_000).toISOString().slice(0, 10);

async function main() {
  const login = await fetch(`${BASE}/api/auth/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'admin@congruence.in', password: 'Password@123' }) });
  if (!login.ok) throw new Error(`login failed: ${login.status}`);
  const token = ((await login.json()) as { accessToken: string }).accessToken;
  const range = `from=${dateOf(-89)}&to=${dateOf(0)}`;
  const analytics = ['overview?compare=true&', 'traffic?', 'demographics?', 'zones?', 'conversion?', 'queue?', 'storeops?', 'benchmark?', 'benchmark/groups?groupBy=region&', 'traffic-density?', 'journey?storeIds=1,2,3,4,5,6&', 'heatmap?storeId=1&', 'live?storeId=1&'].map((p) => `/api/analytics/${p}${p === 'live?storeId=1&' ? '' : range}`);
  const lists = [
    '/api/pos/transactions?page=1&pageSize=50', '/api/pos/transactions?page=1000&pageSize=50', `/api/pos/transactions?${range}&page=1&pageSize=500`,
    '/api/ai-manager/detections?page=1&pageSize=48', `/api/ai-manager/summary?${range}`, '/api/image-directory?page=1&pageSize=48', '/api/audit-logs?page=1&pageSize=50', '/api/alerts?page=1&pageSize=50',
    '/api/checklists/dashboard?' + range, '/api/checklists/compliance?' + range, '/api/infra/health',
  ];
  const results: { url: string; p50: number; p95: number; max: number; target: number }[] = [];
  for (const [urls, target] of [[analytics, 800], [lists, 500]] as const) {
    for (const url of urls) {
      const times: number[] = [];
      for (let i = 0; i < RUNS + 2; i++) {
        const t0 = performance.now();
        const r = await fetch(BASE + url, { headers: { Authorization: `Bearer ${token}` } });
        await r.arrayBuffer();
        if (!r.ok) throw new Error(`${url} → ${r.status}`);
        if (i >= 2) times.push(performance.now() - t0); // 2 warm-up calls
      }
      times.sort((a, b) => a - b);
      const q = (p: number) => times[Math.min(times.length - 1, Math.ceil(p * times.length) - 1)];
      results.push({ url, p50: Math.round(q(0.5)), p95: Math.round(q(0.95)), max: Math.round(times[times.length - 1]), target });
    }
  }
  const w = Math.max(...results.map((r) => r.url.length));
  console.log(`${'endpoint'.padEnd(w)}  p50 ms  p95 ms  max ms  target`);
  for (const r of results) console.log(`${r.url.padEnd(w)}  ${String(r.p50).padStart(6)}  ${String(r.p95).padStart(6)}  ${String(r.max).padStart(6)}  ${r.p95 <= r.target ? 'OK' : 'SLOW'} (<${r.target})`);
  const slow = results.filter((r) => r.p95 > r.target);
  if (slow.length) {
    console.error(`${slow.length} endpoint(s) over target`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
