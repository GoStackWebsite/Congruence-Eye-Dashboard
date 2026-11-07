import { DataSource } from 'typeorm';
import { addDays, localParts, zonedToUtc } from '../src/common/time.util';
import { Visit } from '../src/modules/analytics/entities/visit.entity';
import { CameraStatusService } from '../src/modules/cameras/camera-status.service';
import { Camera } from '../src/modules/cameras/entities/camera.entity';
import { CameraStatusLog } from '../src/modules/cameras/entities/camera-status-log.entity';
import { IngestBatch } from '../src/modules/ingest/entities/ingest-batch.entity';
import { AnalyticsService } from '../src/modules/analytics/analytics.service';
import { AggregationService } from '../src/modules/pipeline/aggregation.service';
import { VisitBuilderService } from '../src/modules/pipeline/visit-builder.service';
import { SettingsService } from '../src/modules/settings/settings.service';
import { bearer, createTestApp, Ctx, istDate, istToday } from './helpers';

/**
 * QA edge-case plan §1 (time), §2 (ingest robustness) and §3 (analytics math). IDs refer to docs/qa/EDGE_CASE_PLAN.md.
 */
describe('QA §1-3: time bucketing, ingest robustness, analytics math', () => {
  let c: Ctx;
  let seq = 0;
  const admin = () => bearer(c.tokens.admin);
  const get = (p: string) => c.http().get(p).set(admin());
  const ingest = (path: string, body: object, key = c.seed.keys.tnagar, batchId?: string) => {
    const r = c.http().post(`/api/ingest/${path}`).set('X-Api-Key', key);
    if (batchId) r.set('X-Batch-Id', batchId);
    return r.send(body);
  };
  const entry = (cameraId: number, ts: string, extra: object = {}) => ({ cameraId, type: 'ENTRY', ts, trackId: `tr-${++seq}`, visitorId: `vis-${seq}`, ...extra });
  /** Deep scan: no NaN / Infinity anywhere in a response object. */
  const nonFinite = (o: unknown, path = '$'): string[] => {
    if (typeof o === 'number') return Number.isFinite(o) ? [] : [path];
    if (Array.isArray(o)) return o.flatMap((v, i) => nonFinite(v, `${path}[${i}]`));
    if (o && typeof o === 'object') return Object.entries(o).flatMap(([k, v]) => nonFinite(v, `${path}.${k}`));
    return [];
  };
  const withEnv = async (vars: Record<string, string>, fn: () => Promise<void>) => {
    const old: Record<string, string | undefined> = {};
    for (const [k, v] of Object.entries(vars)) {
      old[k] = process.env[k];
      process.env[k] = v;
    }
    try {
      await fn();
    } finally {
      for (const [k, v] of Object.entries(old)) if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  };

  /** A brand-new store with an entrance camera, a section zone and its own edge key. */
  async function newStore(code: string, timezone = 'Asia/Kolkata', withCamera = true) {
    const store = (await c.http().post('/api/stores').set(admin()).send({ code, name: `QA ${code}`, regionId: c.seed.regions.chennai, timezone, openTime: '10:00', closeTime: '22:00' }).expect(201)).body;
    if (!withCamera) return { store, key: '', cam: 0, zone: 0 };
    const cam = (await c.http().post('/api/cameras').set(admin()).send({ storeId: store.id, name: 'Entrance', type: 'ENTRANCE', rtspUrl: 'rtsp://10.1.1.1/e' }).expect(201)).body;
    const zone = (await c.http().post('/api/zones').set(admin()).send({ storeId: store.id, cameraId: cam.id, name: 'Section A', type: 'SECTION', polygon: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] }).expect(201)).body;
    const dev = (await c.http().post('/api/edge-devices').set(admin()).send({ storeId: store.id, name: `Edge ${code}` }).expect(201)).body;
    return { store, key: dev.apiKey as string, cam: cam.id as number, zone: zone.id as number };
  }

  beforeAll(async () => (c = await createTestApp()));
  afterAll(async () => c.app.close());

  // ------------------------------------------------------------------ §1 time
  describe('§1 time', () => {
    it('T1 23:59:59.999 and 00:00:00.000 IST land on their own store-local date and hour', async () => {
      const s = await newStore('QA-T1');
      const D = istDate(-3);
      const last = new Date(zonedToUtc(D, '23:59:59', 'Asia/Kolkata').getTime() + 999).toISOString();
      const first = zonedToUtc(addDays(D, 1), '00:00:00', 'Asia/Kolkata').toISOString();
      expect((await ingest('events', { events: [entry(s.cam, last), entry(s.cam, first)] }, s.key).expect(200)).body).toMatchObject({ accepted: 2, rejected: 0 });
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${addDays(D, 1)}`).expect(200)).body;
      expect(t.daily.map((d: { date: string; footfallIn: number }) => [d.date, d.footfallIn])).toEqual([[D, 1], [addDays(D, 1), 1]]);
      expect(t.hourly[23].footfall).toBe(1);
      expect(t.hourly[0].footfall).toBe(1);
    });

    it('T2 a store in Asia/Dubai buckets by Dubai time (not IST / UTC)', async () => {
      const s = await newStore('QA-DXB', 'Asia/Dubai');
      const D = istDate(-2);
      // 23:30 Dubai = 01:00 IST next day = 19:30 UTC
      const ts = zonedToUtc(D, '23:30', 'Asia/Dubai');
      expect(localParts(ts, 'Asia/Kolkata').date).toBe(addDays(D, 1));
      await ingest('events', { events: [entry(s.cam, ts.toISOString())] }, s.key).expect(200);
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${addDays(D, 1)}`).expect(200)).body;
      expect(t.daily.find((d: { date: string }) => d.date === D).footfallIn).toBe(1);
      expect(t.hourly[23].footfall).toBe(1);
      const cfg = (await c.http().get('/api/ingest/config').set('X-Api-Key', s.key).expect(200)).body;
      expect(cfg.store.timezone).toBe('Asia/Dubai');
      // invalid IANA zone is refused at the API (it would 500 every ingest otherwise)
      await c.http().patch(`/api/stores/${s.store.id}`).set(admin()).send({ timezone: 'Mars/Olympus' }).expect(400);
    });

    it('T3 from > to → 400 everywhere; bad dates → 400; > 800 days → 400', async () => {
      const bad = `from=${istDate(0)}&to=${istDate(-1)}`;
      for (const p of ['overview', 'traffic', 'demographics', 'zones', 'conversion', 'queue', 'storeops', 'benchmark', 'benchmark/groups', 'traffic-density', 'journey', 'heatmap']) {
        const r = await get(`/api/analytics/${p}?${bad}`);
        expect([p, r.status, r.body.message]).toEqual([p, 400, 'from must be <= to']);
      }
      await get(`/api/ai-manager/summary?${bad}`).expect(400);
      await get('/api/analytics/overview?from=2026-02-30&to=2026-03-01').expect(400);
      await get('/api/analytics/overview?from=yesterday').expect(400);
      await get('/api/analytics/overview?from=2020-01-01&to=2026-01-01').expect(400);
    });

    it('T4 single-day range returns exactly one daily point; T5 month boundary keeps every date', async () => {
      const one = (await get(`/api/analytics/traffic?from=${istDate(-1)}&to=${istDate(-1)}`).expect(200)).body;
      expect(one.daily).toHaveLength(1);
      expect(one.dayOfWeek.reduce((a: number, d: { avgPerDay: number }) => a + (isFinite(d.avgPerDay) ? 0 : 1), 0)).toBe(0);
      const today = istDate(0);
      const monthStart = `${today.slice(0, 7)}-01`;
      const from = addDays(monthStart, -2);
      const to = addDays(monthStart, 1);
      const s = await newStore('QA-MON');
      await withEnv({ INGEST_MAX_AGE_DAYS: '40' }, async () => {
        const lastOfMonth = zonedToUtc(addDays(monthStart, -1), '23:30', 'Asia/Kolkata').toISOString();
        if (new Date(lastOfMonth).getTime() < Date.now()) await ingest('events', { events: [entry(s.cam, lastOfMonth)] }, s.key).expect(200);
      });
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${from}&to=${to}&compare=true`).expect(200)).body;
      expect(t.daily.map((d: { date: string }) => d.date)).toEqual([from, addDays(from, 1), addDays(from, 2), addDays(from, 3)]);
      const o = (await get(`/api/analytics/overview?storeIds=${s.store.id}&from=${from}&to=${to}&compare=true`).expect(200)).body;
      expect(o.daily).toHaveLength(4);
      expect(nonFinite(o)).toEqual([]);
    });

    it('T6 future-dated events beyond +10 min are REJECTED (FUTURE_TS); within skew accepted', async () => {
      await withEnv({ INGEST_MAX_FUTURE_SEC: '600' }, async () => {
        const now = Date.now();
        const r = await ingest('events', {
          events: [entry(c.seed.cameras.entrance, new Date(now + 5 * 60_000).toISOString()), entry(c.seed.cameras.entrance, new Date(now + 11 * 60_000).toISOString()), entry(c.seed.cameras.entrance, new Date(now + 86400_000).toISOString())],
        }).expect(200);
        expect(r.body).toMatchObject({ accepted: 1, rejected: 2, errors: [{ index: 1, reason: 'FUTURE_TS' }, { index: 2, reason: 'FUTURE_TS' }] });
        const q = await ingest('queue', { snapshots: [{ zoneId: c.seed.zones.queue1, ts: new Date(now + 3600_000).toISOString(), queueLength: 1, avgWaitSec: 1, counterStaffed: true }] }).expect(200);
        expect(q.body).toMatchObject({ accepted: 0, rejected: 1, errors: [{ index: 0, reason: 'FUTURE_TS' }] });
        const h = await ingest('heatmap', { cameraId: c.seed.cameras.floor, ts: new Date(now + 3600_000).toISOString(), width: 2, height: 1, grid: [1, 1] }).expect(400);
        expect(h.body.message).toMatch(/future/);
      });
    });

    it('T7 events older than 30 days are REJECTED (STALE_TS); 29 days accepted', async () => {
      const r = await ingest('events', {
        events: [entry(c.seed.cameras.entrance, new Date(Date.now() - 29 * 86400_000).toISOString()), entry(c.seed.cameras.entrance, new Date(Date.now() - 31 * 86400_000).toISOString())],
      }).expect(200);
      expect(r.body).toMatchObject({ accepted: 1, rejected: 1, errors: [{ index: 1, reason: 'STALE_TS' }] });
      const so = await ingest('storeops', { events: [{ type: 'SOP_BREACH', ts: new Date(Date.now() - 40 * 86400_000).toISOString() }] }).expect(200);
      expect(so.body).toMatchObject({ accepted: 0, rejected: 1 });
    });

    it('T8 "today" is consistent across overview, traffic (partial point) and live', async () => {
      const s = await newStore('QA-TODAY');
      const ts = (m: number) => new Date(Date.now() - m * 60_000).toISOString();
      // 3 entries today (one staff), 1 exit
      await ingest('events', {
        events: [entry(s.cam, ts(30), { visitorId: 'today-a' }), entry(s.cam, ts(20), { visitorId: 'today-b' }), entry(s.cam, ts(10), { visitorId: 'staff-x', isStaff: true }), { cameraId: s.cam, type: 'EXIT', ts: ts(5), trackId: 'x1', visitorId: 'today-a', dwellSec: 1500 }],
      }, s.key).expect(200);
      const today = localParts(new Date(), 'Asia/Kolkata').date;
      const o = (await get(`/api/analytics/overview?storeIds=${s.store.id}&from=${today}&to=${today}`).expect(200)).body;
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${today}&to=${today}`).expect(200)).body;
      const live = (await get(`/api/analytics/live?storeId=${s.store.id}`).expect(200)).body;
      expect(o.kpis.footfall.value).toBe(2);
      expect(t.daily[0]).toMatchObject({ date: today, footfallIn: 2, footfallOut: 1, uniqueVisitors: 2, isPartial: true, hasData: true });
      expect(live).toMatchObject({ todayFootfall: 2, currentOccupancy: 1 });
      expect(o.daily[0]).toMatchObject({ footfall: 2, isPartial: true });
      // yesterday has no data at all → hasData false (a chart shows a gap, never a false 0 point)
      const y = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${addDays(today, -1)}&to=${today}`).expect(200)).body;
      expect(y.daily[0]).toMatchObject({ hasData: false, isPartial: false });
    });
  });

  // ------------------------------------------------------------------ §2 ingest
  describe('§2 ingest robustness', () => {
    it('I1 replaying a batch with the same X-Batch-Id is not double counted (stored response + duplicate:true)', async () => {
      const s = await newStore('QA-I1');
      const D = istDate(-1);
      const body = { events: [entry(s.cam, istToday('12:00', -1)), entry(s.cam, istToday('12:05', -1))] };
      const first = await ingest('events', body, s.key, 'spool-000001').expect(200);
      expect(first.body).toMatchObject({ accepted: 2 });
      const again = await ingest('events', body, s.key, 'spool-000001').expect(200);
      expect(again.body).toMatchObject({ accepted: 2, duplicate: true });
      // body field works too, and a different batch id with the same events is caught by the natural key
      const natural = await ingest('events', { ...body, batchId: 'spool-000002' }, s.key).expect(200);
      expect(natural.body).toMatchObject({ accepted: 0, duplicates: 2 });
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(t.totals.footfallIn).toBe(2);
      expect(await c.app.get(DataSource).getRepository(IngestBatch).count({ where: { storeId: s.store.id } })).toBe(2);
      await ingest('events', body, s.key, 'bad id with spaces').expect(400);
      await ingest('events', body, s.key, 'x'.repeat(65)).expect(400);
    });

    it('I2 heatmap and queue replays do not double the grid / samples', async () => {
      const s = await newStore('QA-I2');
      const ts = istToday('13:00', -1);
      const hm = { cameraId: s.cam, ts, width: 2, height: 2, grid: [1, 2, 3, 4] };
      await ingest('heatmap', hm, s.key, 'hm-1').expect(200);
      expect((await ingest('heatmap', hm, s.key, 'hm-1').expect(200)).body).toMatchObject({ ok: true, duplicate: true });
      const h = (await get(`/api/analytics/heatmap?cameraId=${s.cam}&from=${istDate(-1)}&to=${istDate(-1)}`).expect(200)).body;
      expect(h.grid).toEqual([1, 2, 3, 4]);
      const qz = (await c.http().post('/api/zones').set(admin()).send({ storeId: s.store.id, cameraId: s.cam, name: 'Till', type: 'QUEUE', polygon: [[0, 0], [1, 0], [1, 1]] }).expect(201)).body;
      const snap = { zoneId: qz.id, ts, queueLength: 4, avgWaitSec: 120, counterStaffed: true };
      await ingest('queue', { snapshots: [snap] }, s.key).expect(200);
      expect((await ingest('queue', { snapshots: [snap, snap] }, s.key).expect(200)).body).toMatchObject({ accepted: 0, duplicates: 2 });
      const q = (await get(`/api/analytics/queue?storeIds=${s.store.id}&from=${istDate(-1)}&to=${istDate(-1)}`).expect(200)).body;
      expect(q.byCounter[0]).toMatchObject({ avgQueueLength: 4, maxQueueLength: 4 });
    });

    it('I3 EXIT without ENTRY is stored but creates no visit; occupancy never negative', async () => {
      const s = await newStore('QA-I3');
      const r = await ingest('events', { events: [{ cameraId: s.cam, type: 'EXIT', ts: new Date(Date.now() - 60_000).toISOString(), trackId: 'ghost', visitorId: 'ghost', dwellSec: 30 }] }, s.key).expect(200);
      expect(r.body.accepted).toBe(1);
      expect(await c.app.get(DataSource).getRepository(Visit).count({ where: { storeId: s.store.id } })).toBe(0);
      const live = (await get(`/api/analytics/live?storeId=${s.store.id}`).expect(200)).body;
      expect(live).toMatchObject({ todayFootfall: 0, currentOccupancy: 0 });
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}`).expect(200)).body;
      expect(t.totals).toMatchObject({ footfallIn: 0, footfallOut: 1, bounced: 0, engaged: 0 });
    });

    it('I4 ENTRY without EXIT: the stale-visit job closes it after 3 h from the last event and rollups follow', async () => {
      const s = await newStore('QA-I4');
      const D = istDate(-1);
      await ingest('events', {
        events: [
          entry(s.cam, istToday('11:00', -1), { visitorId: 'stay', trackId: 'stay-1' }),
          { cameraId: s.cam, zoneId: s.zone, type: 'ZONE_ENTER', ts: istToday('11:05', -1), trackId: 'stay-z', visitorId: 'stay' },
          { cameraId: s.cam, zoneId: s.zone, type: 'ZONE_EXIT', ts: istToday('11:12', -1), trackId: 'stay-z', visitorId: 'stay', dwellSec: 420 },
        ],
      }, s.key).expect(200);
      const builder = c.app.get(VisitBuilderService);
      const settings = await c.app.get(SettingsService).get();
      const affected = await builder.closeStale(new Date(), settings);
      for (const [storeId, hours] of affected) await c.app.get(AggregationService).recomputeAffected(storeId, hours);
      const v = await c.app.get(DataSource).getRepository(Visit).findOneByOrFail({ storeId: s.store.id, visitorId: 'stay' });
      expect(v.autoClosed).toBe(true);
      expect(v.dwellSec).toBe(12 * 60);
      expect(v.engaged).toBe(true); // zone dwell 420 s ≥ 30 s
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(t.totals).toMatchObject({ footfallIn: 1, engaged: 1, avgDwellSec: 720 });
    });

    it('I5 zone events: unknown / other-store zone rejected, missing zoneId rejected, inactive zone accepted (late spool data)', async () => {
      const s = await newStore('QA-I5');
      const other = c.seed.zones.mens; // T Nagar zone
      await c.http().patch(`/api/zones/${s.zone}`).set(admin()).send({ isActive: false }).expect(200);
      const ts = istToday('12:00', -1);
      const r = await ingest('events', {
        events: [
          { cameraId: s.cam, zoneId: 987654, type: 'ZONE_ENTER', ts, trackId: 'z1', visitorId: 'z1' },
          { cameraId: s.cam, zoneId: other, type: 'ZONE_ENTER', ts, trackId: 'z2', visitorId: 'z2' },
          { cameraId: s.cam, type: 'ZONE_EXIT', ts, trackId: 'z3', visitorId: 'z3', dwellSec: 5 },
          { cameraId: s.cam, zoneId: s.zone, type: 'ZONE_ENTER', ts, trackId: 'z4', visitorId: 'z4' },
        ],
      }, s.key).expect(200);
      expect(r.body).toMatchObject({ accepted: 1, rejected: 3, errors: [{ index: 0, reason: 'UNKNOWN_ZONE' }, { index: 1, reason: 'UNKNOWN_ZONE' }, { index: 2, reason: 'ZONE_REQUIRED' }] });
    });

    it('I6 cameras of another store: whole batch → 403, mixed batch → per-event FOREIGN_CAMERA', async () => {
      const s = await newStore('QA-I6');
      const ts = new Date(Date.now() - 60_000).toISOString();
      const f = await ingest('events', { events: [entry(c.seed.cameras.entrance, ts)] }, s.key).expect(403);
      expect(f.body.message).toMatch(/belongs to another store/);
      const m = await ingest('events', { events: [entry(s.cam, ts), entry(c.seed.cameras.entrance, ts), entry(424242, ts)] }, s.key).expect(200);
      expect(m.body).toMatchObject({ accepted: 1, rejected: 2, errors: [{ index: 1, reason: 'FOREIGN_CAMERA' }, { index: 2, reason: 'UNKNOWN_CAMERA' }] });
      await ingest('heatmap', { cameraId: c.seed.cameras.floor, ts, width: 1, height: 1, grid: [1] }, s.key).expect(403);
      await ingest('detections', { detections: [{ type: 'MOBILE_USAGE', cameraId: c.seed.cameras.floor, ts, status: 'BREACHED' }] }, s.key).expect(403);
      // empty batches are fine
      expect((await ingest('events', { events: [] }, s.key).expect(200)).body).toMatchObject({ accepted: 0, rejected: 0 });
    });

    it('I7 oversized batch: 5001 events → 400 with the limit in the message; > 20 MB body → 413', async () => {
      const ts = istToday('10:00', -1);
      const big = Array.from({ length: 5001 }, (_, i) => ({ cameraId: c.seed.cameras.entrance, type: 'ENTRY', ts, trackId: `big-${i}`, visitorId: `big-${i}` }));
      const r = await ingest('events', { events: big }).expect(400);
      expect(JSON.stringify(r.body.message)).toMatch(/5000/);
      const huge = '{"events":[' + Array.from({ length: 130000 }, (_, i) => JSON.stringify({ cameraId: 1, type: 'ENTRY', ts, trackId: `h${i}`, visitorId: 'x'.repeat(120) })).join(',') + ']}';
      expect(huge.length).toBeGreaterThan(20 * 1024 * 1024);
      await c.http().post('/api/ingest/events').set('X-Api-Key', c.seed.keys.tnagar).set('Content-Type', 'application/json').send(huge).expect(413);
    });

    it('I8 malformed payloads → 400 with a useful message (never 500)', async () => {
      const ts = istToday('10:00', -1);
      const cases: [unknown, RegExp][] = [
        [{}, /events must be an array/],
        [{ events: 'nope' }, /events must be an array/],
        [{ events: [{ cameraId: 'one', type: 'ENTRY', ts, trackId: 't', visitorId: 'v' }] }, /cameraId must be an integer/],
        [{ events: [{ cameraId: 1, type: 'ENTER', ts, trackId: 't', visitorId: 'v' }] }, /type must be one of/],
        [{ events: [{ cameraId: 1, type: 'ENTRY', ts: '2026-10-05 10:00', trackId: 't', visitorId: 'v' }] }, /ts must be/],
        [{ events: [{ cameraId: 1, type: 'ENTRY', ts: '2026-10-05T10:00:00', trackId: 't', visitorId: 'v' }] }, /UTC offset/],
        [{ events: [{ cameraId: 1, type: 'ENTRY', ts, trackId: '', visitorId: 'v' }] }, /trackId/],
        [{ events: [{ cameraId: 1, type: 'EXIT', ts, trackId: 't', visitorId: 'v', dwellSec: -1 }] }, /dwellSec/],
        [{ events: [{ cameraId: 1, type: 'EXIT', ts, trackId: 't', visitorId: 'v', dwellSec: 1e12 }] }, /dwellSec/],
        [{ events: [{ cameraId: 1, type: 'ENTRY', ts, trackId: 't', visitorId: 'v', gender: 'X' }] }, /gender/],
        [{ events: [null] }, /./],
      ];
      for (const [body, msg] of cases) {
        const r = await ingest('events', body as object);
        expect([JSON.stringify(body).slice(0, 60), r.status]).toEqual([JSON.stringify(body).slice(0, 60), 400]);
        expect(JSON.stringify(r.body.message)).toMatch(msg);
      }
      const bad = await c.http().post('/api/ingest/events').set('X-Api-Key', c.seed.keys.tnagar).set('Content-Type', 'application/json').send('{"events": [');
      expect(bad.status).toBe(400);
      await ingest('heatmap', { cameraId: c.seed.cameras.floor, ts, width: 2, height: 2, grid: [1, 2, 3] }).expect(400);
      await ingest('heatmap', { cameraId: c.seed.cameras.floor, ts, width: 2, height: 1, grid: [1, -5] }).expect(400);
      await ingest('heartbeat', { cameras: [{ cameraId: c.seed.cameras.floor, status: 'MAYBE' }] }).expect(400);
    });

    it('I9 unicode / emoji / Tamil text survives store-ops details and comes back verbatim', async () => {
      const details = 'கடை திறக்கப்பட்டது 🛒✅ — "quotes" & <b>tags</b> \u0000-free';
      const r = await ingest('storeops', { events: [{ type: 'SOP_BREACH', ts: new Date(Date.now() - 120_000).toISOString(), details }] }).expect(200);
      expect(r.body.accepted).toBe(1);
      const so = (await get(`/api/analytics/storeops?storeIds=${c.seed.stores.tnagar}`).expect(200)).body;
      expect(so.events.find((e: { details: string }) => e.details === details)).toBeTruthy();
    });

    it('I10 concurrent ingest of the same hour from two cameras: rollup equals the sum and recompute is idempotent', async () => {
      const s = await newStore('QA-I10');
      const cam2 = (await c.http().post('/api/cameras').set(admin()).send({ storeId: s.store.id, name: 'Side door', type: 'ENTRANCE' }).expect(201)).body.id;
      const D = istDate(-1);
      const batch = (cam: number, n: number, tag: string) => ({ events: Array.from({ length: n }, (_, i) => ({ cameraId: cam, type: 'ENTRY', ts: istToday(`14:${String(i % 60).padStart(2, '0')}`, -1), trackId: `${tag}-${i}`, visitorId: `${tag}-${i}` })) });
      const res = await Promise.all([
        ingest('events', batch(s.cam, 40, 'a'), s.key), ingest('events', batch(cam2, 35, 'b'), s.key),
        ingest('events', batch(s.cam, 25, 'c'), s.key), ingest('events', batch(cam2, 20, 'd'), s.key),
      ]);
      expect(res.map((r) => r.status)).toEqual([200, 200, 200, 200]);
      const t1 = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(t1.hourly[14].footfall).toBe(120);
      expect(t1.totals.uniqueVisitors).toBe(120);
      await c.app.get(AggregationService).recompute(s.store.id, D);
      const t2 = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(t2.totals).toEqual(t1.totals);
    });

    it('I11 heartbeat flapping: transitions are logged in order, uptime/downtime add up, duplicate camera entries → last wins', async () => {
      const s = await newStore('QA-I11');
      const cam = await c.app.get(DataSource).getRepository(Camera).findOneByOrFail({ id: s.cam });
      const svc = c.app.get(CameraStatusService);
      const t0 = Date.now() - 60 * 60_000;
      const seqs: ['ONLINE' | 'OFFLINE', number][] = [['ONLINE', 0], ['OFFLINE', 10], ['ONLINE', 12], ['ONLINE', 13], ['OFFLINE', 20], ['ONLINE', 25], ['OFFLINE', 50]];
      for (const [st, min] of seqs) await svc.apply(cam, st, new Date(t0 + min * 60_000));
      const logs = await c.app.get(DataSource).getRepository(CameraStatusLog).find({ where: { cameraId: s.cam }, order: { startedAt: 'ASC' } });
      expect(logs.map((l) => l.status)).toEqual(['ONLINE', 'OFFLINE', 'ONLINE', 'OFFLINE', 'ONLINE', 'OFFLINE']); // repeated ONLINE is not a transition
      for (let i = 0; i + 1 < logs.length; i++) expect(logs[i].endedAt!.getTime()).toBe(logs[i + 1].startedAt.getTime());
      const health = await c.app.get(AnalyticsService).cameraHealth([s.store.id], { from: istDate(0), to: istDate(0) }, new Date(t0 + 60 * 60_000));
      const h = health.find((x) => x.cameraId === s.cam)!;
      // offline: 10→12 (2) + 20→25 (5) + 50→60 (10) = 17 min (if the hour started today)
      if (localParts(new Date(t0), 'Asia/Kolkata').date === istDate(0)) expect(h.downtimeMinutes).toBeCloseTo(17, 0);
      expect(h.status).toBe('OFFLINE');
      // one heartbeat listing the same camera twice: the last entry wins
      await ingest('heartbeat', { cameras: [{ cameraId: s.cam, status: 'OFFLINE' }, { cameraId: s.cam, status: 'ONLINE', fps: 12 }] }, s.key).expect(200);
      expect((await c.app.get(DataSource).getRepository(Camera).findOneByOrFail({ id: s.cam })).status).toBe('ONLINE');
    });
  });

  // ------------------------------------------------------------------ §3 analytics math
  describe('§3 analytics math', () => {
    it('A1 a brand-new store (no cameras, zones or data): every analytics / ops endpoint → 200 with empty structures', async () => {
      const { store } = await newStore('QA-EMPTY', 'Asia/Kolkata', false);
      const q = `storeIds=${store.id}`;
      const list = [
        'analytics/overview', 'analytics/traffic', 'analytics/demographics', 'analytics/zones', 'analytics/conversion', 'analytics/queue', 'analytics/storeops',
        'analytics/benchmark', 'analytics/benchmark/groups', 'analytics/traffic-density', 'analytics/journey', 'infra/health', 'ai-manager/summary',
        'ai-manager/open-close', 'ai-manager/detections', 'checklists/compliance', 'checklists/dashboard', 'image-directory', 'recaps', 'alerts', 'tasks', 'tickets',
      ];
      for (const p of list) {
        const r = await get(`/api/${p}?${q}`);
        expect([p, r.status]).toEqual([p, 200]);
        expect([p, nonFinite(r.body)]).toEqual([p, []]);
      }
      const ov = (await get(`/api/analytics/overview?${q}&compare=true`).expect(200)).body;
      expect(ov.kpis.footfall).toEqual({ value: 0, previous: 0, changePct: 0 });
      expect(ov.kpis.conversionPct).toEqual({ value: null, previous: null, changePct: null });
      expect(ov.kpis.engagedPct.value).toBeNull();
      expect(ov.kpis.bounceRatePct.value).toBeNull();
      expect(ov.kpis.atv.value).toBeNull();
      const live = (await get(`/api/analytics/live?storeId=${store.id}`).expect(200)).body;
      expect(live).toMatchObject({ todayFootfall: 0, currentOccupancy: 0, todayConversionPct: null, queues: [], cameras: [], recentEvents: [] });
      const hm = (await get(`/api/analytics/heatmap?storeId=${store.id}`).expect(200)).body;
      expect(hm).toMatchObject({ cameraId: null, max: 0 });
      const j = (await get(`/api/analytics/journey?storeId=${store.id}`).expect(200)).body;
      expect(j).toMatchObject({ nodes: [{ id: 0, name: 'Entrance' }], links: [], totalFootfall: 0 });
      const conv = (await get(`/api/analytics/conversion?${q}`).expect(200)).body;
      expect(conv.totals).toEqual({ revenue: 0, transactions: 0, atv: null, conversionPct: null, itemsPerBill: null });
      expect(conv.byStore).toEqual([{ storeId: store.id, storeName: store.name, conversionPct: null, revenue: 0, atv: null, missedOpportunities: 0 }]);
      for (const type of ['traffic', 'zones', 'conversion', 'queue', 'storeops', 'benchmark', 'checklists', 'alerts', 'tasks', 'tickets']) {
        const r = await get(`/api/reports/export?type=${type}&format=csv&${q}`);
        expect([type, r.status]).toEqual([type, 200]);
      }
    });

    it('A2 zero footfall with transactions (POS but no camera data) → conversion null, never Infinity', async () => {
      const s = await newStore('QA-A2');
      await c.http().post('/api/pos/transactions').set(admin()).send({ transactions: [{ storeId: s.store.id, billNo: 'A2-1', ts: istToday('12:00', -1), amount: 999, itemsCount: 1 }] }).expect(200);
      const D = istDate(-1);
      const o = (await get(`/api/analytics/overview?storeIds=${s.store.id}&from=${D}&to=${D}&compare=true`).expect(200)).body;
      expect(o.kpis.transactions.value).toBe(1);
      expect(o.kpis.conversionPct.value).toBeNull();
      expect(o.kpis.atv.value).toBe(999);
      expect(nonFinite(o)).toEqual([]);
      const b = (await get(`/api/analytics/benchmark?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(b).toEqual([expect.objectContaining({ storeId: s.store.id, rank: 1, conversionPct: null, revenue: 999, footfallChangePct: 0 })]); // A6: benchmark with one store
    });

    it('A3 groups: a group of 4 counts as ONE billable entity; a "group" of one is an individual; staff never counted', async () => {
      const s = await newStore('QA-A3');
      const D = istDate(-1);
      const g = (id: string, gid: string | null, extra: object = {}) => ({ cameraId: s.cam, type: 'ENTRY', ts: istToday('16:00', -1), trackId: `t-${id}`, visitorId: id, groupId: gid, ...extra });
      await ingest('events', { events: [g('p1', 'G4'), g('p2', 'G4'), g('p3', 'G4'), g('p4', 'G4'), g('solo', 'G1'), g('ind', null), g('st', null, { isStaff: true })] }, s.key).expect(200);
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(t.totals).toMatchObject({ footfallIn: 6, staffExcluded: 1, groups: 1, individuals: 2, billableEntities: 3, uniqueVisitors: 6 });
    });

    it('A4 staff exclusion: events in a STAFF_ONLY zone are flagged staff even without isStaff', async () => {
      const so = (await c.http().post('/api/zones').set(admin()).send({ storeId: c.seed.stores.tnagar, cameraId: c.seed.cameras.billing, name: 'Back office', type: 'STAFF_ONLY', polygon: [[0, 0], [1, 0], [1, 1]] }).expect(201)).body;
      const D = istDate(-5);
      await ingest('events', { events: [{ cameraId: c.seed.cameras.billing, zoneId: so.id, type: 'ENTRY', ts: istToday('09:00', -5), trackId: 'bo1', visitorId: 'bo1' }] }).expect(200);
      const t = (await get(`/api/analytics/traffic?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200)).body;
      expect(t.totals).toMatchObject({ footfallIn: 0, staffExcluded: 1 });
    });

    it('A5 repeat visitors: inside the 30-day window (inclusive) = repeat, outside = new', async () => {
      const s = await newStore('QA-A5');
      const ds = c.app.get(DataSource);
      // an old visit 31 days back (older than the ingest window, so written directly) and one 10 days back
      const mk = (vid: string, daysAgo: number) =>
        ds.getRepository(Visit).save({ storeId: s.store.id, visitorId: vid, trackId: vid, entryTs: new Date(Date.now() - daysAgo * 86400_000), exitTs: null, date: istDate(-daysAgo), hour: 12, dwellSec: 60, isStaff: false, groupId: null, gender: 'U', ageBand: 'U', engaged: false, zoneEngaged: false, bounced: false, isRepeat: false, maxZoneDwellSec: 0, autoClosed: false });
      await mk('loyal', 10);
      await mk('lapsed', 32); // 31 days before the visit day (D = yesterday): outside "the previous 30 days"
      await mk('edge30', 31); // exactly 30 days before D: still inside the window
      await ingest('events', { events: [entry(s.cam, istToday('12:00', -1), { visitorId: 'loyal' }), entry(s.cam, istToday('12:01', -1), { visitorId: 'lapsed' }), entry(s.cam, istToday('12:02', -1), { visitorId: 'fresh' }), entry(s.cam, istToday('12:03', -1), { visitorId: 'edge30' })] }, s.key).expect(200);
      const D = istDate(-1);
      const t = (await get(`/api/analytics/traffic?storeIds=${s.store.id}&from=${D}&to=${D}`).expect(200)).body;
      expect(t.totals).toMatchObject({ uniqueVisitors: 4, repeatVisitors: 2, newVisitors: 2 });
    });

    it('A7 journey with no transitions and A8 heatmap with no frames are empty, not errors', async () => {
      const s = await newStore('QA-A7');
      const j = (await get(`/api/analytics/journey?storeId=${s.store.id}`).expect(200)).body;
      expect(j.links).toEqual([]);
      expect(j.highlights).toEqual({ highestFootfall: null, highestImpression: null, highestBounced: null, highestEngaged: null, highestDwell: null });
      const h = (await get(`/api/analytics/heatmap?storeId=${s.store.id}`).expect(200)).body;
      expect(h).toMatchObject({ cameraId: s.cam, width: 32, height: 18, max: 0 });
      expect(h.grid.every((v: number) => v === 0)).toBe(true);
      const z = (await get(`/api/analytics/zones?storeIds=${s.store.id}`).expect(200)).body;
      expect(z[0]).toMatchObject({ visits: 0, engagedPct: null, bouncedPct: null, concentrationPct: null, classification: 'DEAD' });
    });

    it('A9 compare=true when the previous period is empty: changePct 100 (growth from 0), previous 0', async () => {
      const s = await newStore('QA-A9');
      await ingest('events', { events: [entry(s.cam, istToday('12:00', -1))] }, s.key).expect(200);
      const D = istDate(-1);
      const o = (await get(`/api/analytics/overview?storeIds=${s.store.id}&from=${D}&to=${D}&compare=true`).expect(200)).body;
      expect(o.kpis.footfall).toEqual({ value: 1, previous: 0, changePct: 100 });
      expect(o.kpis.conversionPct).toEqual({ value: 0, previous: null, changePct: null });
    });
  });
});
