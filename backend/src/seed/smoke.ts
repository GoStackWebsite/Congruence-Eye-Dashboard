/* Full-seed smoke test: seeds a sqlite file, boots the real app and hits every analytics endpoint. */
import * as path from 'path';
process.env.DB_TYPE = 'sqlite';
process.env.DB_PATH = process.env.SMOKE_DB_PATH || path.resolve('data/smoke.sqlite');
process.env.DB_SYNC = 'true';
process.env.DISABLE_CRON = 'true';
process.env.UPLOAD_DIR = process.env.UPLOAD_DIR || path.resolve('data/smoke-uploads');

// eslint-disable-next-line @typescript-eslint/no-require-imports
import fs = require('fs');

async function main() {
  for (const f of [process.env.DB_PATH, `${process.env.DB_PATH}-wal`, `${process.env.DB_PATH}-shm`]) if (fs.existsSync(f)) fs.unlinkSync(f);
  const { NestFactory } = await import('@nestjs/core');
  const { DataSource } = await import('typeorm');
  const { AppModule } = await import('../app.module');
  const { configureApp } = await import('../app.setup');
  const { runSeed } = await import('./seed');
  const { todayLocal, addDays } = await import('../common/time.util');

  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn'] });
  configureApp(app as never, { swagger: true });
  await app.listen(0, '127.0.0.1');
  const ds = app.get(DataSource);
  await runSeed(ds, { reset: true, log: (m) => console.log(`[seed] ${m}`) });
  const url = await app.getUrl();
  const base = url.replace('[::1]', '127.0.0.1');
  let failures = 0;
  const check = (name: string, cond: boolean, detail = '') => {
    console.log(`${cond ? 'OK  ' : 'FAIL'} ${name}${detail ? ' — ' + detail : ''}`);
    if (!cond) failures++;
  };
  const call = async (p: string, token?: string, init: RequestInit = {}) => {
    const r = await fetch(base + p, { ...init, headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init.headers ?? {}) } });
    const ct = r.headers.get('content-type') ?? '';
    const body = ct.includes('json') ? await r.json() : await r.arrayBuffer();
    if (!r.ok) console.log(`  ${p} → ${r.status} ${JSON.stringify(body).slice(0, 300)}`);
    return { status: r.status, body: body as any, ct };
  };

  const health = await call('/api/health');
  check('health', health.status === 200 && health.body.db === 'up');
  const login = await call('/api/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: 'admin@congruence.in', password: 'Password@123' }) });
  check('login admin', login.status === 200);
  const T = login.body.accessToken as string;
  const today = todayLocal();
  const ranges = [`from=${addDays(today, -6)}&to=${today}`, `from=${addDays(today, -89)}&to=${today}`];
  for (const q of ranges) {
    const label = q.includes(addDays(today, -89)) ? '90d' : '7d';
    const ov = await call(`/api/analytics/overview?${q}&compare=true`, T);
    const k = ov.body.kpis;
    check(`overview ${label}`, ov.status === 200 && k.footfall.value > 0 && k.transactions.value > 0 && k.revenue.value > 0 && k.conversionPct.value > 15 && k.conversionPct.value < 40 && k.atv.value > 1000 && k.complianceScore.value > 70 && k.footfall.previous !== undefined,
      `footfall ${k?.footfall.value}, conv ${k?.conversionPct.value}%, ATV ₹${k?.atv.value}, revenue ₹${k?.revenue.value}, compliance ${k?.complianceScore.value}%, openAlerts ${k?.openAlerts.value}, change ${k?.footfall.changePct}%`);
    const tr = await call(`/api/analytics/traffic?${q}`, T);
    check(`traffic ${label}`, tr.status === 200 && tr.body.totals.footfallIn > 0 && tr.body.totals.groups > 0 && tr.body.totals.staffExcluded > 0 && tr.body.totals.avgDwellSec >= 360 && tr.body.totals.avgDwellSec <= 1080, `peakHour ${tr.body.peakHour}, avgDwell ${tr.body.totals.avgDwellSec}s, groups ${tr.body.totals.groups}`);
    const dm = await call(`/api/analytics/demographics?${q}`, T);
    check(`demographics ${label}`, dm.status === 200 && dm.body.gender.male > 0 && dm.body.gender.female > 0 && dm.body.age.some((a: any) => a.count > 0));
    const zn = await call(`/api/analytics/zones?${q}`, T);
    check(`zones ${label}`, zn.status === 200 && zn.body.length === 42 && zn.body.every((z: any) => z.visits > 0) && zn.body.some((z: any) => z.classification === 'HOT') && zn.body.some((z: any) => z.classification === 'DEAD'));
    const cv = await call(`/api/analytics/conversion?${q}`, T);
    check(`conversion ${label}`, cv.status === 200 && cv.body.funnel.transactions > 0 && cv.body.byStore.length === 6 && cv.body.hourly.length > 8 && cv.body.segments.missedOpportunities > 0);
    const qu = await call(`/api/analytics/queue?${q}`, T);
    check(`queue ${label}`, qu.status === 200 && qu.body.totals.avgQueueLength > 0 && qu.body.byCounter.length === 12 && qu.body.live.length === 12 && qu.body.totals.breaches > 0, `avgWait ${qu.body.totals.avgWaitSec}s, breaches ${qu.body.totals.breaches}`);
    const so = await call(`/api/analytics/storeops?${q}`, T);
    check(`storeops ${label}`, so.status === 200 && so.body.openClose.length > 0 && so.body.cameraHealth.length === 30 && so.body.totals.offlineCameras === 1 && so.body.totals.cameraUptimePct > 90 && so.body.totals.cameraUptimePct < 100 && so.body.staffPresence.length > 0,
      `late ${so.body.totals.lateOpenings}, early ${so.body.totals.earlyClosings}, SOP ${so.body.totals.sopBreaches}, uptime ${so.body.totals.cameraUptimePct}%`);
    const bm = await call(`/api/analytics/benchmark?${q}`, T);
    check(`benchmark ${label}`, bm.status === 200 && bm.body.length === 6 && bm.body[0].rank === 1 && bm.body.every((b: any) => b.revenue > 0 && b.complianceScore > 0), bm.body.map((b: any) => `${b.rank}.${b.storeName.replace('Congruence ', '')}`).join(', '));
  }
  for (let s = 1; s <= 6; s++) {
    const hm = await call(`/api/analytics/heatmap?storeId=${s}&from=${addDays(today, -6)}&to=${today}`, T);
    const jr = await call(`/api/analytics/journey?storeId=${s}&from=${addDays(today, -6)}&to=${today}`, T);
    const lv = await call(`/api/analytics/live?storeId=${s}`, T);
    check(`heatmap/journey/live store ${s}`, hm.status === 200 && hm.body.max > 0 && jr.status === 200 && jr.body.links.length > 10 && lv.status === 200 && lv.body.cameras.length === 5,
      `today footfall ${lv.body.todayFootfall}, occupancy ${lv.body.currentOccupancy}, tx ${lv.body.todayTransactions}, conv ${lv.body.todayConversionPct}%`);
  }
  const lists: [string, (b: any) => boolean][] = [
    ['/api/stores', (b) => b.length === 6 && new Set(b.map((s: any) => s.format)).size >= 3], ['/api/cameras', (b) => b.length === 30], ['/api/zones', (b) => b.length === 72 && b.filter((z: any) => z.type === 'SHELF' && z.referenceSnapshotId).length === 6], ['/api/users', (b) => b.length === 11],
    ['/api/staff', (b) => b.length === 48], ['/api/edge-devices', (b) => b.length === 6], ['/api/regions', (b) => b.length === 2], ['/api/settings', (b) => b.currency === 'INR'],
    ['/api/alert-rules', (b) => b.length === 13 && b.some((r: any) => r.autoTicket)], ['/api/alerts?pageSize=10', (b) => b.total >= 40 && b.items.length === 10], ['/api/notifications', (b) => b.length > 0],
    ['/api/checklists/templates', (b) => b.length === 6], ['/api/checklists/assignments?status=OVERDUE', (b) => b.length > 0], ['/api/checklists/submissions', (b) => b.length > 500],
    ['/api/checklists/compliance', (b) => b.length === 6 && b.every((c: any) => c.avgScorePct >= 70)], ['/api/tasks', (b) => b.length >= 30 && b.some((t: any) => t.type === 'ZONE_ALLOCATION')],
    ['/api/tickets', (b) => b.length >= 25 && b.some((t: any) => t.isSlaBreached) && b.some((t: any) => t.category === 'PLANOGRAM')], ['/api/documents', (b) => b.length === 3],
    ['/api/vendors', (b) => b.length === 6], ['/api/vendor-visits', (b) => b.length === 40], ['/api/reports/schedules', (b) => b.length === 2],
    [`/api/pos/transactions?from=${addDays(today, -6)}&to=${today}&pageSize=5`, (b) => b.total > 1000 && b.items.length === 5], ['/api/audit-logs', (b) => b.total >= 1],
  ];
  for (const [p, ok] of lists) {
    const r = await call(p, T);
    check(`GET ${p}`, r.status === 200 && ok(r.body));
  }
  // ---- v2
  const w = `from=${addDays(today, -6)}&to=${today}`;
  const v2: [string, (b: any) => boolean, (b: any) => string][] = [
    [`/api/analytics/traffic-density?${w}`, (b) => b.cells.length === 7 * b.hours.length && b.max > 0, (b) => `max ${b.max}/h, hours ${b.hours[0]}–${b.hours[b.hours.length - 1]}`],
    [`/api/analytics/benchmark/groups?groupBy=format&${w}`, (b) => b.length === 3 && b.every((g: any) => g.footfall > 0 && g.bouncedPct > 0), (b) => b.map((g: any) => `${g.group}:${g.stores}`).join(', ')],
    [`/api/analytics/benchmark/groups?groupBy=region&${w}`, (b) => b.length === 2, () => ''],
    [`/api/analytics/zones?${w}`, (b) => b.every((z: any) => z.bouncedPct > 0 && z.concentrationPct > 0 && z.dominantAgeBand && z.genderSplit.malePct + z.genderSplit.femalePct > 99), () => ''],
    [`/api/analytics/journey?storeIds=1,2,3&${w}`, (b) => b.totalFootfall > 0 && b.highlights.highestFootfall && b.links.length > 10, (b) => JSON.stringify(b.highlights.highestFootfall)],
    [`/api/analytics/traffic?${w}`, (b) => b.hourly.some((h: any) => h.bouncedPct > 0), () => ''],
    [`/api/analytics/conversion?${w}`, (b) => b.hourly.some((h: any) => h.customersPerStaff > 0), () => ''],
    ['/api/infra/health', (b) => b.totals.stores === 6 && b.totals.down >= 1 && b.stores.find((s: any) => s.storeId === 4).edgeStatus === 'OFFLINE', (b) => JSON.stringify(b.totals)],
    [`/api/image-directory?pageSize=5`, (b) => b.total > 500 && b.items[0].url.startsWith('/uploads/snapshots/'), (b) => `${b.total} images`],
    [`/api/recaps?storeIds=1`, (b) => b.some((r: any) => r.status === 'READY' && r.url && r.durationSec > 10 && r.durationSec < 120), (b) => b.map((r: any) => `${r.date}:${r.status}:${r.durationSec}s`).join(', ')],
    ['/api/checklists/schedules', (b) => b.length === 2, () => ''],
    [`/api/checklists/dashboard?from=${addDays(today, -29)}&to=${today}`, (b) => b.checklistInstances > 100 && b.totalFlags > 0 && b.byChecklist.length >= 4 && b.byStore.length === 6, (b) => `instances ${b.checklistInstances}, completion ${b.completionScorePct}%, compliance ${b.complianceScorePct}%, flags ${b.totalFlags}`],
    ['/api/checklists/templates', (b) => b.some((t: any) => t.questions.some((q: any) => q.aiCheck === 'REFERENCE_MATCH' && q.referenceImageUrl)) && b.some((t: any) => t.questions.some((q: any) => q.aiCheck === 'UNIFORM')), () => ''],
    ['/api/tasks', (b) => b.some((t: any) => t.checklistAnswerId), () => ''],
    ['/api/ai-manager/rules', (b) => b.length === 24, () => ''],
    ['/api/ai-manager/detections?status=BREACHED&pageSize=3', (b) => b.total > 100 && b.items.some((d: any) => d.snapshotUrl), (b) => `${b.total} breaches`],
    [`/api/ai-manager/summary?${w}`, (b) => b.byType.length === 8 && b.daily.length === 7, (b) => b.byType.map((t: any) => `${t.type}:${t.compliancePct}%`).join(' ')],
    [`/api/ai-manager/open-close?${w}`, (b) => b.length > 30 && b.some((r: any) => r.openingSnapUrl) && b.some((r: any) => r.openStatus === 'LATE' || r.closeStatus === 'EARLY'), () => ''],
  ];
  for (const [p, ok, info] of v2) {
    const r = await call(p, T);
    check(`GET ${p}`, r.status === 200 && ok(r.body), r.status === 200 ? info(r.body) : String(r.status));
  }
  // ---- v3 recorders
  const recs = await call('/api/recorders', T);
  check('v3 recorders', recs.status === 200 && recs.body.length === 6 && recs.body.every((r: any) => r.camerasLinked === 5 && r.hasPassword && !('password' in r)) &&
    ['ONLINE', 'PARTIAL', 'OFFLINE', 'UNKNOWN'].every((s) => recs.body.some((r: any) => r.status === s)) && recs.body.some((r: any) => r.brand === 'CUSTOM' && r.urlTemplate),
    recs.body.map?.((r: any) => `${r.brand}:${r.status}`).join(', '));
  const brands = await call('/api/recorders/brands', T);
  check('v3 brands', brands.status === 200 && brands.body.length === 9);
  const cams = await call('/api/cameras?storeId=1', T);
  check('v3 cameras masked', cams.body.length === 5 && cams.body.every((c: any) => c.recorderId && c.channel && /^rtsp:\/\/admin:\*\*\*\*@10\.20\.1\.20:554\/Streaming\/Channels\/\d0[12]$/.test(c.rtspUrl)), cams.body[0]?.rtspUrl);
  const edgeCfg = (await call('/api/ingest/config', undefined, { headers: { 'X-Api-Key': 'dev-edge-key-store-1' } })).body;
  check('v3 edge config real url', edgeCfg.cameras.every((c: any) => c.rtspUrl.startsWith('rtsp://admin:Cong%40TNR%232026@10.20.1.20:554/Streaming/Channels/')), edgeCfg.cameras[0]?.rtspUrl.replace(/:[^:@/]+@/, ':…@'));
  const pr = await call('/api/probes?storeId=1', T);
  const withSnap = pr.body.find?.((p: any) => p.status === 'OK' && p.snapshotUrl);
  check('v3 probes', pr.status === 200 && pr.body.length === 6 && !!withSnap && pr.body.some((p: any) => p.errorCode === 'NOT_FOUND') &&
    (await call('/api/probes?storeId=2', T)).body.some((p: any) => p.errorCode === 'AUTH'));
  check('v3 probe snapshot', !!withSnap && (await fetch(base + withSnap.snapshotUrl)).status === 200);
  const disc = await call('/api/recorders/discovered?storeId=1', T);
  check('v3 discovered', disc.status === 200 && disc.body.length === 3 && disc.body.some((d: any) => d.onvif && d.brandGuess === 'HIKVISION'));
  const leak = JSON.stringify([recs.body, cams.body, pr.body, (await call('/api/stores/1', T)).body]);
  check('v3 no password in browser responses', !/Cong@|Cong%40|passwordEnc/.test(leak));

  const recap = (await call('/api/recaps?storeIds=1', T)).body.find((r: any) => r.status === 'READY');
  const mp4 = await fetch(base + recap.url);
  const head = Buffer.from(await mp4.arrayBuffer());
  check('recap mp4 playable header', mp4.status === 200 && head.subarray(4, 8).toString() === 'ftyp', `${head.length} bytes`);
  const ticket = (await call('/api/tickets', T)).body[0];
  check('ticket detail with comments', (await call(`/api/tickets/${ticket.id}`, T)).body.comments !== undefined);
  const dl = await call('/api/documents/2/download', T);
  check('document download (pdf)', dl.status === 200 && Buffer.from(dl.body).subarray(0, 5).toString() === '%PDF-');
  for (const type of ['traffic', 'zones', 'conversion', 'queue', 'storeops', 'benchmark', 'checklists', 'alerts', 'tasks', 'tickets']) {
    const r = await call(`/api/reports/export?type=${type}&format=xlsx&from=${addDays(today, -29)}&to=${today}`, T);
    const c = await call(`/api/reports/export?type=${type}&format=csv&from=${addDays(today, -29)}&to=${today}`, T);
    check(`export ${type}`, r.status === 200 && r.body.byteLength > 2000 && c.status === 200 && Buffer.from(c.body).toString().split('\n').length > 2);
  }
  // QA findings (docs/qa/FINDINGS.md): seed quality
  const dets = await call(`/api/ai-manager/detections?from=${addDays(today, -29)}&to=${today}&pageSize=500`, T);
  const sum = await call(`/api/ai-manager/summary?from=${addDays(today, -29)}&to=${today}`, T);
  check('every seeded detection has an evidence snapshot (BREACHED and COMPLIED)', dets.status === 200 && dets.body.items.length > 0 && dets.body.items.every((d: any) => !!d.snapshotUrl) && dets.body.items.some((d: any) => d.status === 'COMPLIED'));
  const { AiDetection } = await import('../modules/ai-manager/entities/ai-detection.entity');
  const { IsNull } = await import('typeorm');
  const noSnap = await ds.getRepository(AiDetection).count({ where: { snapshotId: IsNull() } });
  check('no detection without a snapshot in the whole seed', noSnap === 0, `${noSnap} without`);
  check('detections summary total = list total', sum.status === 200 && sum.body.totals.detections === dets.body.total, `${sum.body.totals?.detections} vs ${dets.body.total} (false positives ${sum.body.totals?.falsePositives})`);
  const sch = await call('/api/checklists/schedules', T);
  check('every seeded checklist schedule targets stores', sch.status === 200 && sch.body.length > 0 && sch.body.every((s: any) => s.storeIds.length > 0));
  const td = await call(`/api/analytics/traffic?from=${today}&to=${today}`, T);
  const tdPoint = td.body.daily?.[0];
  check("today's traffic point is partial and consistent", td.status === 200 && tdPoint.isPartial === true && (tdPoint.footfallIn === 0 || tdPoint.uniqueVisitors > 0), JSON.stringify(tdPoint));
  const ev = await call('/api/alerts/evaluate', T, { method: 'POST' });
  check('alerts evaluate', ev.status === 200 && typeof ev.body.created === 'number', `created ${ev.body.created}`);
  const cfg = await call('/api/ingest/config', undefined, { headers: { 'X-Api-Key': 'dev-edge-key-store-1' } });
  check('ingest config with dev key', cfg.status === 200 && cfg.body.zones.length === 12 && cfg.body.aiManagerRules.length === 8);
  const docs = await call('/api/docs-json');
  check('swagger json', docs.status === 200 && Object.keys(docs.body.paths).length > 60, `${Object.keys(docs.body.paths ?? {}).length} paths`);
  const mgr = await call('/api/auth/login', undefined, { method: 'POST', body: JSON.stringify({ email: 'manager.tnagar@congruence.in', password: 'Password@123' }) });
  const mb = await call('/api/analytics/benchmark', mgr.body.accessToken);
  check('store manager scoped benchmark', mb.body.length === 1 && mb.body[0].storeId === 1);

  await app.close();
  console.log(failures ? `\nSMOKE FAILED (${failures})` : '\nSMOKE PASSED');
  process.exit(failures ? 1 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
