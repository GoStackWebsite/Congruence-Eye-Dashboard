import { bearer, createTestApp, Ctx, istDate, istToday } from './helpers';

/**
 * Scenario (T Nagar, YESTERDAY, 11:00–12:00 IST) — expected numbers are computed by hand:
 *  V1 individual M 25-34: zone Men's 180s (engaged) → Women's 20s, store dwell 1200s; visited 4 days ago too (repeat)
 *  V2+V3 group G1: V2 F 18-24 Footwear 45s (< 60s zone threshold) dwell 360s (engaged by store dwell); V3 M 18-24 dwell 200s (casual)
 *  V4 individual F 35-44: Men's 10s, dwell 40s → bounced
 *  V5 individual U/U: entered, no exit yet
 *  staff S1 enters/exits (excluded)
 */
describe('Ingestion → analytics (exact numbers)', () => {
  let c: Ctx;
  let key: string;
  const D = istDate(-1);
  const t = (hhmm: string) => istToday(hhmm, -1);
  const ev = (o: Record<string, unknown>) => ({ trackId: `t-${o.visitorId}`, ...o });

  beforeAll(async () => {
    c = await createTestApp();
    key = c.seed.keys.tnagar;
  });
  afterAll(async () => c.app.close());

  const post = (path: string, body: object, k = key) => c.http().post(`/api/ingest/${path}`).set('X-Api-Key', k).send(body);
  const get = (path: string, token = c.tokens.admin) => c.http().get(path).set(bearer(token));

  it('rejects missing / invalid api key', async () => {
    await c.http().get('/api/ingest/config').expect(401);
    await c.http().get('/api/ingest/config').set('X-Api-Key', 'nope').expect(401);
  });

  it('serves config for the device store', async () => {
    const r = await c.http().get('/api/ingest/config').set('X-Api-Key', key).expect(200);
    expect(r.body.store).toMatchObject({ id: c.seed.stores.tnagar, code: 'CNG-TNR', regionName: 'Chennai' });
    expect(r.body.cameras).toHaveLength(3);
    expect(r.body.zones.map((z: { name: string }) => z.name)).toContain("Men's Wear");
    expect(r.body.settings).toMatchObject({ engagedStoreDwellSec: 300, bounceSec: 60, currency: 'INR' });
  });

  it('ingests visitor events', async () => {
    const { entrance, floor } = c.seed.cameras;
    const { mens, womens, footwear } = c.seed.zones;
    // earlier visit of V1 four days ago (makes V1 a repeat visitor)
    let r = await post('events', {
      events: [
        ev({ cameraId: entrance, type: 'ENTRY', ts: istToday('12:00', -4), visitorId: 'V1', gender: 'M', ageBand: '25-34' }),
        ev({ cameraId: entrance, type: 'EXIT', ts: istToday('12:10', -4), visitorId: 'V1', dwellSec: 600 }),
      ],
    }).expect(200);
    expect(r.body).toMatchObject({ accepted: 2, rejected: 0 });
    r = await post('events', {
      events: [
        ev({ cameraId: entrance, type: 'ENTRY', ts: t('11:00'), visitorId: 'V1', gender: 'M', ageBand: '25-34' }),
        ev({ cameraId: entrance, type: 'ENTRY', ts: t('11:00'), visitorId: 'S1', isStaff: true }),
        ev({ cameraId: floor, zoneId: mens, type: 'ZONE_ENTER', ts: t('11:02'), visitorId: 'V1', gender: 'M' }),
        ev({ cameraId: floor, zoneId: mens, type: 'ZONE_EXIT', ts: t('11:05'), visitorId: 'V1', gender: 'M', dwellSec: 180 }),
        ev({ cameraId: floor, zoneId: womens, type: 'ZONE_ENTER', ts: t('11:06'), visitorId: 'V1', gender: 'M' }),
        ev({ cameraId: floor, zoneId: womens, type: 'ZONE_EXIT', ts: t('11:06'), visitorId: 'V1', gender: 'M', dwellSec: 20 }),
        ev({ cameraId: entrance, type: 'ENTRY', ts: t('11:10'), visitorId: 'V2', groupId: 'G1', gender: 'F', ageBand: '18-24' }),
        ev({ cameraId: entrance, type: 'ENTRY', ts: t('11:10'), visitorId: 'V3', groupId: 'G1', gender: 'M', ageBand: '18-24' }),
        ev({ cameraId: floor, zoneId: footwear, type: 'ZONE_ENTER', ts: t('11:12'), visitorId: 'V2', gender: 'F' }),
        ev({ cameraId: floor, zoneId: footwear, type: 'ZONE_EXIT', ts: t('11:13'), visitorId: 'V2', gender: 'F', dwellSec: 45 }),
        ev({ cameraId: entrance, type: 'EXIT', ts: t('11:16'), visitorId: 'V2', dwellSec: 360 }),
        ev({ cameraId: entrance, type: 'EXIT', ts: t('11:16'), visitorId: 'V3', dwellSec: 200 }),
        ev({ cameraId: entrance, type: 'EXIT', ts: t('11:20'), visitorId: 'V1', dwellSec: 1200 }),
        ev({ cameraId: entrance, type: 'ENTRY', ts: t('11:30'), visitorId: 'V4', gender: 'F', ageBand: '35-44' }),
        ev({ cameraId: floor, zoneId: mens, type: 'ZONE_ENTER', ts: t('11:30'), visitorId: 'V4', gender: 'F' }),
        ev({ cameraId: floor, zoneId: mens, type: 'ZONE_EXIT', ts: t('11:30'), visitorId: 'V4', gender: 'F', dwellSec: 10 }),
        ev({ cameraId: entrance, type: 'ENTRY', ts: t('11:40'), visitorId: 'V5' }),
        ev({ cameraId: 9999, type: 'ENTRY', ts: t('11:40'), visitorId: 'BAD' }), // unknown camera → skipped
      ],
    }).expect(200);
    expect(r.body).toMatchObject({ accepted: 17, rejected: 1, errors: [{ index: 17, reason: 'UNKNOWN_CAMERA' }] });
    // V4 exit arrives in a later batch (visit is closed from the DB)
    r = await post('events', {
      events: [
        ev({ cameraId: entrance, type: 'EXIT', ts: t('11:31'), visitorId: 'V4', dwellSec: 40 }),
        ev({ cameraId: entrance, type: 'EXIT', ts: t('11:50'), visitorId: 'S1', isStaff: true }),
      ],
    }).expect(200);
    expect(r.body.accepted).toBe(2);
  });

  it('validates event payloads', async () => {
    await post('events', { events: [{ cameraId: 1, type: 'BOGUS', ts: 'x', trackId: 't', visitorId: 'v' }] }).expect(400);
  });

  it('ingests POS transactions (api key) with dedupe', async () => {
    const s = c.seed.stores.tnagar;
    const r = await c.http().post('/api/pos/transactions').set('X-Api-Key', key).send({
      transactions: [
        { storeId: s, billNo: 'B-1', ts: t('11:25'), amount: 1500.5, itemsCount: 3, staffCode: 'S01' },
        { storeId: s, billNo: 'B-2', ts: t('11:45'), amount: 2499.5, itemsCount: 2 },
        { storeId: s, billNo: 'B-1', ts: t('11:25'), amount: 1500.5, itemsCount: 3 },
      ],
    }).expect(200);
    expect(r.body).toEqual({ accepted: 2, duplicates: 1 });
    // device key cannot post for another store
    await c.http().post('/api/pos/transactions').set('X-Api-Key', key).send({ transactions: [{ storeId: c.seed.stores.annanagar, billNo: 'X', ts: t('11:00'), amount: 1, itemsCount: 1 }] }).expect(403);
  });

  it('ingests queue snapshots', async () => {
    const z = c.seed.zones.queue1;
    const r = await post('queue', {
      snapshots: [
        { zoneId: z, ts: t('11:00'), queueLength: 2, avgWaitSec: 60, counterStaffed: true },
        { zoneId: z, ts: t('11:01'), queueLength: 4, avgWaitSec: 120, counterStaffed: true },
        { zoneId: z, ts: t('11:02'), queueLength: 8, avgWaitSec: 360, counterStaffed: false },
      ],
    }).expect(200);
    expect(r.body).toMatchObject({ accepted: 3, rejected: 0 });
  });

  const q = () => `storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`;

  it('traffic totals', async () => {
    const r = await get(`/api/analytics/traffic?${q()}`).expect(200);
    expect(r.body.totals).toEqual({
      footfallIn: 5, footfallOut: 4, uniqueVisitors: 5, staffExcluded: 1, individuals: 3, groups: 1, billableEntities: 4,
      engaged: 2, casual: 3, bounced: 1, repeatVisitors: 1, newVisitors: 4, avgDwellSec: 450,
    });
    expect(r.body.daily).toEqual([{ date: D, footfallIn: 5, footfallOut: 4, uniqueVisitors: 5, billableEntities: 4, engaged: 2, bounced: 1, isPartial: false, hasData: true }]);
    expect(r.body.hourly).toHaveLength(24);
    expect(r.body.hourly[11]).toEqual({ hour: 11, footfall: 5, avgPerDay: 5, bouncedPct: 20 });
    expect(r.body.peakHour).toBe(11);
    expect(r.body.dayOfWeek).toHaveLength(7);
  });

  it('overview KPIs (conversion = transactions ÷ billable entities)', async () => {
    const r = await get(`/api/analytics/overview?${q()}&compare=true`).expect(200);
    const k = r.body.kpis;
    expect(k.footfall).toEqual({ value: 5, previous: 0, changePct: 100 });
    expect(k.billableEntities.value).toBe(4);
    expect(k.transactions.value).toBe(2);
    expect(k.conversionPct.value).toBe(50);
    expect(k.revenue.value).toBe(4000);
    expect(k.atv.value).toBe(2000);
    expect(k.avgDwellSec.value).toBe(450);
    expect(k.engagedPct.value).toBe(40);
    expect(k.bounceRatePct.value).toBe(20);
    expect(k.missedOpportunities.value).toBe(0);
    expect(k.avgQueueWaitSec.value).toBe(180);
    expect(k.uniqueVisitors.value).toBe(5);
    expect(k.openAlerts).toEqual({ value: 0 });
    expect(r.body.daily).toEqual([{ date: D, footfall: 5, transactions: 2, conversionPct: 50, revenue: 4000, isPartial: false, hasData: true }]);
  });

  it('demographics', async () => {
    const r = await get(`/api/analytics/demographics?${q()}`).expect(200);
    expect(r.body.gender).toEqual({ male: 2, female: 2, unknown: 1 });
    const age = Object.fromEntries(r.body.age.map((a: { band: string; count: number }) => [a.band, a.count]));
    expect(age).toMatchObject({ '18-24': 2, '25-34': 1, '35-44': 1, '0-17': 0, U: 1 });
    expect(r.body.genderByAge.find((g: { band: string }) => g.band === '18-24')).toEqual({ band: '18-24', male: 1, female: 1 });
  });

  it('zones with HOT/WARM/DEAD classification', async () => {
    await c.http().post('/api/zones').set(bearer(c.tokens.admin)).send({ storeId: c.seed.stores.tnagar, cameraId: c.seed.cameras.floor, name: 'Kids', type: 'SECTION', polygon: [[0.5, 0.5], [0.9, 0.5], [0.9, 0.9]] }).expect(201);
    const r = await get(`/api/analytics/zones?${q()}`).expect(200);
    const byName = Object.fromEntries(r.body.map((z: { name: string }) => [z.name, z]));
    expect(byName["Men's Wear"]).toMatchObject({ visits: 2, uniqueVisitors: 2, avgDwellSec: 95, engaged: 1, engagedPct: 50, male: 1, female: 1, classification: 'HOT', storeName: 'Congruence T Nagar', type: 'SECTION' });
    expect(byName["Women's Wear"]).toMatchObject({ visits: 1, avgDwellSec: 20, engaged: 0, classification: 'WARM' });
    expect(byName.Footwear).toMatchObject({ visits: 1, avgDwellSec: 45, engaged: 0, female: 1, classification: 'WARM' });
    expect(byName.Kids).toMatchObject({ visits: 0, classification: 'DEAD' });
  });

  it('journey (node 0 = Entrance)', async () => {
    const r = await get(`/api/analytics/journey?storeId=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200);
    const { mens, womens, footwear } = c.seed.zones;
    expect(r.body.nodes[0]).toEqual({ id: 0, name: 'Entrance' });
    expect(r.body.links).toEqual(
      expect.arrayContaining([
        { source: 0, target: mens, count: 2 },
        { source: mens, target: womens, count: 1 },
        { source: 0, target: footwear, count: 1 },
      ]),
    );
    expect(r.body.links).toHaveLength(3);
  });

  it('conversion', async () => {
    const r = await get(`/api/analytics/conversion?${q()}`).expect(200);
    expect(r.body.funnel).toEqual({ footfall: 5, engaged: 2, billableEntities: 2, transactions: 2 });
    expect(r.body.segments).toEqual({ bounced: 1, missedOpportunities: 0, converted: 2 });
    expect(r.body.totals).toEqual({ revenue: 4000, transactions: 2, atv: 2000, conversionPct: 50, itemsPerBill: 2.5 });
    expect(r.body.hourly.find((h: { hour: number }) => h.hour === 11)).toMatchObject({ billableEntities: 4, transactions: 2, conversionPct: 50, missedOpportunities: 0 });
    expect(r.body.hourly.find((h: { hour: number }) => h.hour === 11).staffPresentAvg).toBeCloseTo(50 / 60, 2);
    expect(r.body.byStore).toEqual([{ storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', conversionPct: 50, revenue: 4000, atv: 2000, missedOpportunities: 0 }]);
  });

  it('queue', async () => {
    const r = await get(`/api/analytics/queue?${q()}`).expect(200);
    expect(r.body.totals).toEqual({ avgQueueLength: 4.67, maxQueueLength: 8, avgWaitSec: 180, maxWaitSec: 360, breaches: 1, unattendedMinutes: 1 });
    expect(r.body.hourly).toEqual([{ hour: 11, avgQueueLength: 4.67, avgWaitSec: 180 }]);
    expect(r.body.byCounter).toEqual([
      { zoneId: c.seed.zones.queue1, storeId: c.seed.stores.tnagar, storeName: 'Congruence T Nagar', name: 'Billing Counter 1', avgQueueLength: 4.67, maxQueueLength: 8, avgWaitSec: 180, breaches: 1 },
    ]);
    expect(r.body.live[0]).toMatchObject({ zoneId: c.seed.zones.queue1, queueLength: 8, avgWaitSec: 360, counterStaffed: false });
  });

  it('heatmap accumulates grids', async () => {
    const cam = c.seed.cameras.floor;
    const grid = (base: number, first: number) => Array.from({ length: 32 * 18 }, (_, i) => (i === 0 ? first : base));
    await post('heatmap', { cameraId: cam, ts: t('11:00'), width: 32, height: 18, grid: grid(1, 5) }).expect(200);
    await post('heatmap', { cameraId: cam, ts: t('11:30'), width: 32, height: 18, grid: grid(2, 2) }).expect(200);
    await post('heatmap', { cameraId: cam, ts: t('12:00'), width: 32, height: 18, grid: grid(1, 1) }).expect(200);
    await post('heatmap', { cameraId: cam, ts: t('12:00'), width: 32, height: 18, grid: [1, 2] }).expect(400);
    const r = await get(`/api/analytics/heatmap?storeId=${c.seed.stores.tnagar}&cameraId=${cam}&from=${D}&to=${D}`).expect(200);
    expect(r.body).toMatchObject({ cameraId: cam, width: 32, height: 18, max: 8 });
    expect(r.body.grid).toHaveLength(576);
    expect(r.body.grid[0]).toBe(8);
    expect(r.body.grid[1]).toBe(4);
  });

  it('heartbeat → camera status + storeops', async () => {
    const { entrance, floor } = c.seed.cameras;
    await post('heartbeat', { version: '1.2.3', cameras: [{ cameraId: entrance, status: 'ONLINE', fps: 12 }, { cameraId: floor, status: 'ONLINE' }] }).expect(200);
    let cams = (await get(`/api/cameras?storeId=${c.seed.stores.tnagar}`).expect(200)).body;
    expect(cams.find((x: { id: number }) => x.id === entrance)).toMatchObject({ status: 'ONLINE', fps: 12 });
    expect(cams.find((x: { id: number }) => x.id === entrance).lastHeartbeatAt).toBeTruthy();
    await post('heartbeat', { cameras: [{ cameraId: floor, status: 'OFFLINE', reason: 'RTSP timeout' }] }).expect(200);
    cams = (await get(`/api/cameras?storeId=${c.seed.stores.tnagar}`).expect(200)).body;
    expect(cams.find((x: { id: number }) => x.id === floor).status).toBe('OFFLINE');
    const dev = (await get(`/api/edge-devices?storeId=${c.seed.stores.tnagar}`).expect(200)).body[0];
    expect(dev.version).toBe('1.2.3');
    expect(dev.lastSeenAt).toBeTruthy();
    expect(dev.apiKeyPrefix).toBe('dev-edge');
    expect(dev.apiKeyHash).toBeUndefined();

    const r1 = await post('storeops', {
      events: [
        { type: 'STORE_OPENED', ts: t('10:20') },
        { type: 'SOP_BREACH', ts: t('15:00'), cameraId: floor, details: 'No greeter at entrance' },
        { type: 'STORE_CLOSED', ts: t('21:00') },
      ],
    }).expect(200);
    expect(r1.body).toMatchObject({ accepted: 3, rejected: 0 });
    const today = istDate(0);
    const r = await get(`/api/analytics/storeops?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${today}`).expect(200);
    const row = r.body.openClose.find((o: { date: string }) => o.date === D);
    expect(row).toMatchObject({ scheduledOpen: '10:00', actualOpen: '10:20', lateOpenMin: 20, scheduledClose: '21:30', actualClose: '21:00', earlyCloseMin: 30 });
    expect(r.body.totals).toMatchObject({ lateOpenings: 1, earlyClosings: 1, sopBreaches: 1, offlineCameras: 1 });
    expect(r.body.events).toHaveLength(3);
    expect(r.body.events[0]).toHaveProperty('storeName', 'Congruence T Nagar');
    const fl = r.body.cameraHealth.find((x: { cameraId: number }) => x.cameraId === floor);
    expect(fl).toMatchObject({ status: 'OFFLINE', name: 'Floor 1' });
    expect(fl.uptimePct).toBeLessThanOrEqual(100);
    expect(r.body.staffPresence.find((s: { hour: number }) => s.hour === 11).avgStaff).toBeCloseTo(50 / 60, 2);
  });

  it('snapshot upload + fetch', async () => {
    const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46, 0x49, 0x46, 0, 1, 0xff, 0xd9]);
    await get(`/api/cameras/${c.seed.cameras.entrance}/snapshot`).expect(204); // none yet: 204, not an error (contract v4)
    await c.http().post('/api/ingest/snapshot').set('X-Api-Key', key).field('cameraId', String(c.seed.cameras.entrance)).attach('file', jpeg, { filename: 'a.jpg', contentType: 'image/jpeg' }).expect(200);
    const r = await get(`/api/cameras/${c.seed.cameras.entrance}/snapshot`).expect(200);
    expect(r.headers['content-type']).toContain('image/jpeg');
  });

  it('live for today', async () => {
    const now = Date.now();
    const iso = (minAgo: number) => new Date(now - minAgo * 60000).toISOString();
    await post('events', {
      events: [
        ev({ cameraId: c.seed.cameras.entrance, type: 'ENTRY', ts: iso(5), visitorId: 'L1' }),
        ev({ cameraId: c.seed.cameras.entrance, type: 'ENTRY', ts: iso(4), visitorId: 'L2' }),
        ev({ cameraId: c.seed.cameras.entrance, type: 'EXIT', ts: iso(2), visitorId: 'L1', dwellSec: 180 }),
      ],
    }).expect(200);
    const r = await get(`/api/analytics/live?storeId=${c.seed.stores.tnagar}`).expect(200);
    expect(r.body.storeId).toBe(c.seed.stores.tnagar);
    expect(r.body.todayFootfall).toBeGreaterThanOrEqual(2);
    expect(r.body.lastHourFootfall).toBe(2);
    expect(r.body.currentOccupancy).toBeGreaterThanOrEqual(1);
    expect(r.body.cameras).toHaveLength(3);
    expect(r.body.queues[0]).toHaveProperty('zoneId', c.seed.zones.queue1);
    expect(r.body.recentEvents.length).toBeGreaterThan(0);
    expect(r.body.recentEvents[0].type).toBe('EXIT');
  });

  it('benchmark ranks by revenue', async () => {
    const r = await get(`/api/analytics/benchmark?from=${D}&to=${D}`).expect(200);
    expect(r.body[0]).toMatchObject({ storeId: c.seed.stores.tnagar, rank: 1, revenue: 4000, footfall: 5, conversionPct: 50, regionName: 'Chennai', revenuePerSqft: 0.8, footfallChangePct: 100 });
    expect(r.body.length).toBe(3);
  });

  it('recompute is idempotent (re-posting POS for the hour does not change footfall)', async () => {
    await c.http().post('/api/pos/transactions').set('X-Api-Key', key).send({ transactions: [{ storeId: c.seed.stores.tnagar, billNo: 'B-1', ts: t('11:25'), amount: 1500.5, itemsCount: 3 }] }).expect(200);
    const r = await get(`/api/analytics/traffic?${q()}`).expect(200);
    expect(r.body.totals.footfallIn).toBe(5);
    expect(r.body.totals.billableEntities).toBe(4);
  });

  it('accepts a full 5000-event batch (~1 MB) and rejects 5001', async () => {
    const k = c.seed.keys.annanagar;
    const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ cameraId: c.seed.cameras.entrance2, type: i % 2 ? 'EXIT' : 'ENTRY', ts: istToday('15:00', -2), trackId: `bulk-track-${i}`, visitorId: `bulk-visitor-with-a-longer-reid-hash-${Math.floor(i / 2)}`, gender: 'F', ageBand: '25-34', dwellSec: i % 2 ? 120 : undefined, groupId: null as string | null }));
    await post('events', { events: mk(5001) }, k).expect(400);
    const r = await post('events', { events: mk(5000) }, k).expect(200);
    expect(r.body).toMatchObject({ accepted: 5000, rejected: 0 });
    const t = await get(`/api/analytics/traffic?storeIds=${c.seed.stores.annanagar}&from=${istDate(-2)}&to=${istDate(-2)}`).expect(200);
    expect(t.body.totals).toMatchObject({ footfallIn: 2500, footfallOut: 2500, uniqueVisitors: 2500, individuals: 2500 });
  });

  it('analytics param validation', async () => {
    await get('/api/analytics/traffic?from=2026-13-01').expect(400);
    await get(`/api/analytics/traffic?from=${D}&to=2020-01-01`).expect(400);
  });
});
