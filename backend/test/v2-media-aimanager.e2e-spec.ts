import { spawnSync } from 'child_process';
import { ffmpegPath } from '../src/modules/media/recaps.service';
import { AiManagerService } from '../src/modules/ai-manager/ai-manager.service';
import { Role } from '../src/common/roles';
import { renderScene } from '../src/seed/scene';
import { bearer, createTestApp, Ctx, istDate, istToday } from './helpers';

const binary = (res: NodeJS.ReadableStream, cb: (err: Error | null, body: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (d: Buffer) => chunks.push(Buffer.from(d)));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

describe('v2 media (snapshots, image directory, recaps) and AI Manager', () => {
  let c: Ctx;
  const D = istDate(-1);
  const adm = () => bearer(c.tokens.admin);
  const snap = async (cameraId: number, ts: string, kind?: string, key = c.seed.keys.tnagar, status = 200) => {
    const img = await renderScene({ title: `cam ${cameraId}`, ts, view: 'ZONE', people: 3, seed: Date.parse(ts) % 1000, width: 320, height: 180 });
    const req = c.http().post('/api/ingest/snapshot').set('X-Api-Key', key).field('cameraId', String(cameraId)).field('ts', ts);
    if (kind) req.field('kind', kind);
    return req.attach('file', img, { filename: 's.jpg', contentType: 'image/jpeg' }).expect(status);
  };
  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());

  describe('snapshots, image directory, recap', () => {
    const ids: number[] = [];
    it('ingest/snapshot keeps every snapshot and returns { ok, snapshotId, url }', async () => {
      const { entrance, floor } = c.seed.cameras;
      for (const [cam, hhmm] of [[entrance, '10:00'], [floor, '10:05'], [entrance, '13:00'], [floor, '13:30'], [entrance, '18:00'], [floor, '20:45']] as [number, string][]) {
        const r = await snap(cam, istToday(hhmm, -1));
        expect(r.body).toEqual({ ok: true, snapshotId: expect.any(Number), url: expect.stringMatching(/^\/uploads\/snapshots\/\d+\/\d{4}-\d{2}-\d{2}\/cam\d+-.+\.jpg$/) });
        ids.push(r.body.snapshotId);
        await c.http().get(r.body.url).expect(200);
      }
      const ref = await snap(c.seed.cameras.floor, istToday('09:00', -1), 'REFERENCE');
      ids.push(ref.body.snapshotId);
      await snap(c.seed.cameras.floor, istToday('09:00', -1), 'SELFIE', c.seed.keys.tnagar, 400);
      await snap(c.seed.cameras.entrance2, istToday('09:00', -1), undefined, c.seed.keys.tnagar, 403); // another store's camera
      // latest snapshot of a camera = the newest by ts
      const latest = await c.http().get(`/api/cameras/${c.seed.cameras.floor}/snapshot`).set(adm()).buffer(true).parse(binary as never).expect(200);
      expect(latest.headers['content-type']).toContain('image/jpeg');
    });

    it('image directory (paged, newest first, filters)', async () => {
      const r = await c.http().get(`/api/image-directory?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}&pageSize=4`).set(adm()).expect(200);
      expect(r.body).toMatchObject({ total: 7, page: 1, pageSize: 4 });
      expect(r.body.items[0]).toEqual({ id: ids[5], storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', cameraId: c.seed.cameras.floor, cameraName: 'Floor 1', ts: istToday('20:45', -1), kind: 'PERIODIC', url: expect.any(String) });
      const ts = r.body.items.map((i: { ts: string }) => i.ts);
      expect([...ts].sort().reverse()).toEqual(ts);
      expect((await c.http().get(`/api/image-directory?cameraId=${c.seed.cameras.entrance}`).set(adm()).expect(200)).body.total).toBe(3);
      expect((await c.http().get('/api/image-directory?kind=REFERENCE').set(adm()).expect(200)).body.total).toBe(1);
      expect((await c.http().get(`/api/image-directory?storeIds=${c.seed.stores.annanagar}`).set(bearer(c.tokens.manager)).expect(200)).body.total).toBe(0);
    });

    it('recap: 422 without snapshots, READY H.264 mp4 otherwise', async () => {
      await c.http().post('/api/recaps/generate').set(adm()).send({ storeId: c.seed.stores.tnagar, date: istDate(-5) }).expect(422);
      await c.http().post('/api/recaps/generate').set(bearer(c.tokens.manager)).send({ storeId: c.seed.stores.annanagar, date: D }).expect(403);
      // generating is a store-manager+ action (auditors and staff only view recaps)
      await c.http().post('/api/recaps/generate').set(bearer(c.tokens.staff)).send({ storeId: c.seed.stores.tnagar, date: D }).expect(403);
      const r = await c.http().post('/api/recaps/generate').set(bearer(c.tokens.manager)).send({ storeId: c.seed.stores.tnagar, date: D }).expect(201);
      expect(r.body).toEqual({ id: expect.any(Number), storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', date: D, status: 'READY', url: `/uploads/recaps/store-${c.seed.stores.tnagar}-${D}.mp4`, durationSec: 1.5, frameCount: 6, error: null, createdAt: expect.any(String) });
      const file = await c.http().get(r.body.url).buffer(true).parse(binary as never).expect(200);
      const mp4 = file.body as Buffer;
      expect(mp4.subarray(4, 8).toString()).toBe('ftyp');
      const fs = await import('fs');
      const os = await import('os');
      const p = `${os.tmpdir()}/recap-test-${process.pid}.mp4`;
      fs.writeFileSync(p, mp4);
      const probe = spawnSync(ffmpegPath(), ['-hide_banner', '-i', p], { encoding: 'utf8' }).stderr;
      fs.unlinkSync(p);
      expect(probe).toMatch(/Video: h264/);
      expect(probe).toMatch(/yuv420p/);
      expect(probe).toMatch(/1280x720/);
      const dur = /Duration: (\d+):(\d+):([\d.]+)/.exec(probe);
      const seconds = Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]);
      expect(seconds).toBeGreaterThan(1.2);
      expect(seconds).toBeLessThan(1.8);
      // regenerate is idempotent per store-day
      const again = await c.http().post('/api/recaps/generate').set(adm()).send({ storeId: c.seed.stores.tnagar, date: D }).expect(201);
      expect(again.body.id).toBe(r.body.id);
      const list = await c.http().get(`/api/recaps?storeIds=${c.seed.stores.tnagar}&from=${istDate(-7)}&to=${istDate(0)}`).set(adm()).expect(200);
      expect(list.body).toHaveLength(1);
      expect((await c.http().get(`/api/recaps/${r.body.id}`).set(adm()).expect(200)).body.status).toBe('READY');
      await c.http().get('/api/recaps/9999').set(adm()).expect(404);
    });

    it('SHELF zone with referenceSnapshotId', async () => {
      const ok = await c.http().post('/api/zones').set(adm()).send({ storeId: c.seed.stores.tnagar, cameraId: c.seed.cameras.floor, name: 'Shelf A', type: 'SHELF', polygon: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.4]], referenceSnapshotId: ids[6] }).expect(201);
      expect(ok.body).toMatchObject({ type: 'SHELF', referenceSnapshotId: ids[6] });
      const other = await snap(c.seed.cameras.entrance2, istToday('09:00', -1), 'REFERENCE', c.seed.keys.annanagar);
      await c.http().post('/api/zones').set(adm()).send({ storeId: c.seed.stores.tnagar, cameraId: c.seed.cameras.floor, name: 'Shelf B', type: 'SHELF', polygon: [[0.1, 0.1], [0.9, 0.1], [0.9, 0.4]], referenceSnapshotId: other.body.snapshotId }).expect(400);
    });
  });

  describe('AI Manager', () => {
    let mobile: { id: number; name: string };
    let huddle: { id: number };
    it('rules CRUD with default params (ADMIN / REGIONAL_MANAGER write)', async () => {
      await c.http().post('/api/ai-manager/rules').set(bearer(c.tokens.manager)).send({ name: 'x', type: 'MOBILE_USAGE' }).expect(403);
      await c.http().post('/api/ai-manager/rules').set(adm()).send({ name: 'x', type: 'TELEPORT' }).expect(400);
      const r = await c.http().post('/api/ai-manager/rules').set(bearer(c.tokens.regional)).send({ name: 'Mobile phone usage', type: 'MOBILE_USAGE', storeIds: [c.seed.stores.tnagar], zoneIds: [c.seed.zones.mens], windowStart: '10:00', windowEnd: '21:30', severity: 'HIGH', params: { minDurationSec: 30 } }).expect(201);
      mobile = r.body;
      expect(r.body).toEqual({
        id: expect.any(Number), name: 'Mobile phone usage', type: 'MOBILE_USAGE', storeIds: [c.seed.stores.tnagar], zoneIds: [c.seed.zones.mens], windowStart: '10:00', windowEnd: '21:30',
        daysOfWeek: [0, 1, 2, 3, 4, 5, 6], params: { minDurationSec: 30, staffOnly: true }, severity: 'HIGH', notifyChannels: ['IN_APP'], notifyEmails: null, isActive: true,
      });
      huddle = (await c.http().post('/api/ai-manager/rules').set(adm()).send({ name: 'Morning huddle', type: 'HUDDLE_MEETING', windowStart: '09:30', windowEnd: '10:15' }).expect(201)).body;
      expect((huddle as unknown as { params: object }).params).toEqual({ minPeople: 3, minDurationMin: 5, radius: 0.2 });
      const oc = await c.http().post('/api/ai-manager/rules').set(adm()).send({ name: 'Open / close on time', type: 'STORE_OPEN_CLOSE', storeIds: [c.seed.stores.tnagar] }).expect(201);
      expect(oc.body.params).toEqual({ toleranceMin: 10 });
      const p = await c.http().patch(`/api/ai-manager/rules/${oc.body.id}`).set(adm()).send({ params: { toleranceMin: 15 } }).expect(200);
      expect(p.body.params).toEqual({ toleranceMin: 15 });
      await c.http().patch(`/api/ai-manager/rules/${oc.body.id}`).set(adm()).send({ params: { toleranceMin: 10 } }).expect(200);
      const tmp = await c.http().post('/api/ai-manager/rules').set(adm()).send({ name: 'tmp', type: 'STOCK_OUT' }).expect(201);
      expect(tmp.body.params).toEqual({ emptyPct: 70 });
      await c.http().delete(`/api/ai-manager/rules/${tmp.body.id}`).set(adm()).expect(200);
      expect((await c.http().get('/api/ai-manager/rules').set(bearer(c.tokens.manager)).expect(200)).body).toHaveLength(3);
      const cfg = await c.http().get('/api/ingest/config').set('X-Api-Key', c.seed.keys.annanagar).expect(200);
      expect(cfg.body.aiManagerRules.map((x: { name: string }) => x.name)).toEqual(['Morning huddle']);
      const cfg1 = await c.http().get('/api/ingest/config').set('X-Api-Key', c.seed.keys.tnagar).expect(200);
      expect(cfg1.body.aiManagerRules).toHaveLength(3);
    });

    it('BREACHED detection → AI_MANAGER_BREACH alert + "breach detected" notification; COMPLIED → none', async () => {
      const shot = await snap(c.seed.cameras.floor, new Date(Date.now() - 60000).toISOString(), 'AI_MANAGER');
      const r = await c.http().post('/api/ingest/detections').set('X-Api-Key', c.seed.keys.tnagar).send({
        detections: [
          { ruleId: mobile.id, type: 'MOBILE_USAGE', cameraId: c.seed.cameras.floor, zoneId: c.seed.zones.mens, ts: new Date(Date.now() - 60000).toISOString(), status: 'BREACHED', details: 'Staff on phone for 45 s', confidence: 0.87, snapshotId: shot.body.snapshotId },
          { ruleId: mobile.id, type: 'MOBILE_USAGE', cameraId: c.seed.cameras.floor, ts: new Date(Date.now() - 30000).toISOString(), status: 'COMPLIED' },
          { type: 'STOCK_OUT', cameraId: c.seed.cameras.floor, ts: istToday('15:00', -1), status: 'COMPLIED', details: 'Shelf 30% empty' },
          { ruleId: mobile.id, type: 'MOBILE_USAGE', cameraId: c.seed.cameras.entrance2, ts: new Date().toISOString(), status: 'BREACHED' },
        ],
      }).expect(200);
      expect(r.body).toMatchObject({ accepted: 3, rejected: 1, errors: [{ index: 3, reason: 'FOREIGN_CAMERA' }] });
      const alerts = (await c.http().get('/api/alerts?metric=AI_MANAGER_BREACH').set(adm()).expect(200)).body;
      expect(alerts.total).toBe(1);
      expect(alerts.items[0]).toMatchObject({ ruleId: null, ruleName: 'Mobile phone usage', metric: 'AI_MANAGER_BREACH', severity: 'HIGH', storeId: c.seed.stores.tnagar, status: 'OPEN' });
      const notes = (await c.http().get('/api/notifications').set(bearer(c.tokens.manager)).expect(200)).body;
      expect(notes[0]).toMatchObject({ title: 'Mobile phone usage breach detected for store CNG-TNR' });
      expect((await c.http().get('/api/notifications').set(bearer(c.tokens.staff)).expect(200)).body).toHaveLength(0);
    });

    it('window rules report once per store per window', async () => {
      const det = (status: string) => ({ ruleId: huddle.id, type: 'HUDDLE_MEETING', cameraId: c.seed.cameras.floor, ts: istToday('09:40', -1), status, details: '4 staff, 7 min' });
      expect((await c.http().post('/api/ingest/detections').set('X-Api-Key', c.seed.keys.tnagar).send({ detections: [det('COMPLIED')] }).expect(200)).body).toMatchObject({ accepted: 1, rejected: 0 });
      expect((await c.http().post('/api/ingest/detections').set('X-Api-Key', c.seed.keys.tnagar).send({ detections: [det('BREACHED')] }).expect(200)).body).toMatchObject({ accepted: 0, rejected: 0 });
    });

    it('detections list, review, summary', async () => {
      const r = await c.http().get(`/api/ai-manager/detections?storeIds=${c.seed.stores.tnagar}&pageSize=10`).set(adm()).expect(200);
      expect(r.body.total).toBe(4);
      const breach = r.body.items.find((d: { status: string }) => d.status === 'BREACHED');
      expect(breach).toMatchObject({ ruleId: mobile.id, ruleName: 'Mobile phone usage', type: 'MOBILE_USAGE', storeName: 'Congruence T Nagar', cameraName: 'Floor 1', zoneId: c.seed.zones.mens, zoneName: "Men's Wear", details: 'Staff on phone for 45 s', confidence: 0.87, snapshotUrl: expect.stringMatching(/^\/uploads\/snapshots\//), reviewStatus: null });
      const stock = r.body.items.find((d: { type: string }) => d.type === 'STOCK_OUT');
      expect(stock).toMatchObject({ ruleId: null, ruleName: 'Stock Out', snapshotUrl: null });
      expect((await c.http().get('/api/ai-manager/detections?type=MOBILE_USAGE&status=BREACHED').set(adm()).expect(200)).body.total).toBe(1);
      let s = await c.http().get(`/api/ai-manager/summary?from=${D}&to=${istDate(0)}`).set(adm()).expect(200);
      expect(s.body.byType).toEqual([
        { type: 'MOBILE_USAGE', breached: 1, complied: 1, compliancePct: 50 },
        { type: 'HUDDLE_MEETING', breached: 0, complied: 1, compliancePct: 100 },
        { type: 'STOCK_OUT', breached: 0, complied: 1, compliancePct: 100 },
      ]);
      expect(s.body.byStore).toEqual([{ storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', breached: 1, complied: 3, compliancePct: 75 }]);
      expect(s.body.daily).toEqual([{ date: D, breached: 0, complied: 2 }, { date: istDate(0), breached: 1, complied: 1 }]);
      // reviewing is a store-manager+ action: staff cannot mark detections
      await c.http().patch(`/api/ai-manager/detections/${breach.id}/review`).set(bearer(c.tokens.staff)).send({ reviewStatus: 'FALSE_POSITIVE' }).expect(403);
      const rev = await c.http().patch(`/api/ai-manager/detections/${breach.id}/review`).set(bearer(c.tokens.manager)).send({ reviewStatus: 'FALSE_POSITIVE' }).expect(200);
      expect(rev.body.reviewStatus).toBe('FALSE_POSITIVE');
      s = await c.http().get(`/api/ai-manager/summary?from=${D}&to=${istDate(0)}`).set(adm()).expect(200);
      expect(s.body.byType[0]).toEqual({ type: 'MOBILE_USAGE', breached: 0, complied: 1, compliancePct: 100 });
      await c.http().patch(`/api/ai-manager/detections/${breach.id}/review`).set(adm()).send({ reviewStatus: 'MAYBE' }).expect(400);
    });

    it('open-close statuses with snaps (tolerance 10 min)', async () => {
      const k = c.seed.keys.tnagar;
      const opening = await snap(c.seed.cameras.entrance, istToday('10:05', -1), 'OPENING');
      await c.http().post('/api/ingest/storeops').set('X-Api-Key', k).send({ events: [
        { type: 'STORE_OPENED', ts: istToday('10:05', -1), snapshotId: opening.body.snapshotId },
        { type: 'STORE_CLOSED', ts: istToday('21:00', -1) },
        { type: 'STORE_OPENED', ts: istToday('10:25', -2) },
        { type: 'STORE_CLOSED', ts: istToday('21:35', -2) },
        { type: 'STORE_OPENED', ts: istToday('09:52', -4) },
        { type: 'STORE_CLOSED', ts: istToday('21:38', -4) },
      ] }).expect(200);
      await snap(c.seed.cameras.entrance, istToday('21:38', -4), 'CLOSING');
      const r = await c.http().get(`/api/ai-manager/open-close?storeIds=${c.seed.stores.tnagar}&from=${istDate(-4)}&to=${D}`).set(adm()).expect(200);
      const by = Object.fromEntries(r.body.map((x: { date: string }) => [x.date, x]));
      expect(r.body.map((x: { date: string }) => x.date)).toEqual([D, istDate(-2), istDate(-3), istDate(-4)]);
      expect(by[D]).toEqual({ storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', date: D, scheduledOpen: '10:00', scheduledClose: '21:30', actualOpen: '10:05', actualClose: '21:00', openStatus: 'ON_TIME', closeStatus: 'EARLY', openingSnapUrl: opening.body.url, closingSnapUrl: null, detectionStatus: 'BREACHED' });
      expect(by[istDate(-2)]).toMatchObject({ actualOpen: '10:25', openStatus: 'LATE', closeStatus: 'ON_TIME', detectionStatus: 'BREACHED' });
      expect(by[istDate(-3)]).toMatchObject({ actualOpen: null, actualClose: null, openStatus: 'MISSING', closeStatus: 'MISSING', detectionStatus: 'BREACHED' });
      expect(by[istDate(-4)]).toMatchObject({ openStatus: 'ON_TIME', closeStatus: 'ON_TIME', detectionStatus: 'COMPLIED', closingSnapUrl: expect.stringMatching(/^\/uploads\/snapshots\//) });
      // today: before scheduled open/close (+ tolerance) → PENDING, not a breach (service called with a controlled clock)
      const svc = c.app.get(AiManagerService);
      const admin = { id: 1, email: 'admin@congruence.in', name: 'Admin', role: Role.SUPER_ADMIN, storeIds: [] as number[] };
      const today = istDate(0);
      const at = (hhmm: string) => new Date(istToday(hhmm, 0));
      const row = async (hhmm: string) => ((await svc.openClose(admin, { storeIds: String(c.seed.stores.tnagar), from: today, to: today }, at(hhmm))) as Record<string, unknown>[])[0];
      expect(await row('09:00')).toMatchObject({ date: today, actualOpen: null, openStatus: 'PENDING', closeStatus: 'PENDING', detectionStatus: 'PENDING' });
      expect(await row('10:09')).toMatchObject({ openStatus: 'PENDING', closeStatus: 'PENDING', detectionStatus: 'PENDING' });
      expect(await row('10:11')).toMatchObject({ openStatus: 'MISSING', closeStatus: 'PENDING', detectionStatus: 'BREACHED' }); // QA: past open time + tolerance with no event is a breach, not COMPLIED
      await c.http().post('/api/ingest/storeops').set('X-Api-Key', k).send({ events: [{ type: 'STORE_OPENED', ts: istToday('10:30', 0) }] }).expect(200);
      expect(await row('12:00')).toMatchObject({ actualOpen: '10:30', openStatus: 'LATE', closeStatus: 'PENDING', detectionStatus: 'BREACHED' });
      expect(await row('21:39')).toMatchObject({ closeStatus: 'PENDING' });
      expect(await row('21:41')).toMatchObject({ closeStatus: 'MISSING' });
      const so = await c.http().get(`/api/analytics/storeops?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).set(adm()).expect(200);
      expect(so.body.events.find((e: { type: string }) => e.type === 'STORE_OPENED').snapshotId).toBe(opening.body.snapshotId);
    });
  });
});
