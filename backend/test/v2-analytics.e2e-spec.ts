import { bearer, createTestApp, Ctx, istDate, istToday } from './helpers';

/**
 * v2 analytics on YESTERDAY (D) — hand-computed:
 *  T Nagar: V1 F 25-34 Men's 120s (engaged) → Women's 10s (bounced), store 1200s
 *           V2 M 18-24 Men's 20s (bounced), store 40s (bounced)       — hour 11
 *           V3 M 18-24 Men's 60s (engaged), store 1800s                — hour 12
 *           V4 U       no zones, store 30s (bounced)                   — hour 12
 *           staff S1 11:00 → 12:00
 *  Anna Nagar: W1 F 25-34 Men's 100s (engaged), store 600s            — hour 11
 */
describe('v2 analytics: zones, traffic density, journey, benchmark groups, conversion, infra health', () => {
  let c: Ctx;
  let annMens: number;
  const D = istDate(-1);
  const t = (hhmm: string) => istToday(hhmm, -1);
  const adm = () => bearer(c.tokens.admin);
  const get = (p: string) => c.http().get(p).set(adm());
  const post = (path: string, body: object, key: string) => c.http().post(`/api/ingest/${path}`).set('X-Api-Key', key).send(body);
  const e = (o: Record<string, unknown>) => ({ trackId: `t-${o.visitorId}-${o.type}`, ...o });

  beforeAll(async () => {
    c = await createTestApp();
    const { entrance, floor, entrance2 } = c.seed.cameras;
    const { mens, womens } = c.seed.zones;
    const z = await c.http().post('/api/zones').set(adm()).send({ storeId: c.seed.stores.annanagar, cameraId: entrance2, name: "Men's Wear", type: 'SECTION', polygon: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] }).expect(201);
    annMens = z.body.id;
    await post('events', {
      events: [
        e({ cameraId: entrance, type: 'ENTRY', ts: t('11:00'), visitorId: 'S1', isStaff: true }),
        e({ cameraId: entrance, type: 'ENTRY', ts: t('11:00'), visitorId: 'V1', gender: 'F', ageBand: '25-34' }),
        e({ cameraId: floor, zoneId: mens, type: 'ZONE_ENTER', ts: t('11:01'), visitorId: 'V1', gender: 'F', ageBand: '25-34' }),
        e({ cameraId: floor, zoneId: mens, type: 'ZONE_EXIT', ts: t('11:03'), visitorId: 'V1', gender: 'F', ageBand: '25-34', dwellSec: 120 }),
        e({ cameraId: floor, zoneId: womens, type: 'ZONE_ENTER', ts: t('11:05'), visitorId: 'V1', gender: 'F', ageBand: '25-34' }),
        e({ cameraId: floor, zoneId: womens, type: 'ZONE_EXIT', ts: t('11:05'), visitorId: 'V1', gender: 'F', ageBand: '25-34', dwellSec: 10 }),
        e({ cameraId: entrance, type: 'ENTRY', ts: t('11:10'), visitorId: 'V2', gender: 'M', ageBand: '18-24' }),
        e({ cameraId: floor, zoneId: mens, type: 'ZONE_ENTER', ts: t('11:10'), visitorId: 'V2', gender: 'M', ageBand: '18-24' }),
        e({ cameraId: floor, zoneId: mens, type: 'ZONE_EXIT', ts: t('11:10'), visitorId: 'V2', gender: 'M', ageBand: '18-24', dwellSec: 20 }),
        e({ cameraId: entrance, type: 'EXIT', ts: t('11:11'), visitorId: 'V2', dwellSec: 40 }),
        e({ cameraId: entrance, type: 'EXIT', ts: t('11:20'), visitorId: 'V1', dwellSec: 1200 }),
        e({ cameraId: entrance, type: 'EXIT', ts: t('12:00'), visitorId: 'S1', isStaff: true }),
        e({ cameraId: entrance, type: 'ENTRY', ts: t('12:00'), visitorId: 'V3', gender: 'M', ageBand: '18-24' }),
        e({ cameraId: floor, zoneId: mens, type: 'ZONE_ENTER', ts: t('12:01'), visitorId: 'V3', gender: 'M', ageBand: '18-24' }),
        e({ cameraId: floor, zoneId: mens, type: 'ZONE_EXIT', ts: t('12:02'), visitorId: 'V3', gender: 'M', ageBand: '18-24', dwellSec: 60 }),
        e({ cameraId: entrance, type: 'ENTRY', ts: t('12:05'), visitorId: 'V4' }),
        e({ cameraId: entrance, type: 'EXIT', ts: t('12:05'), visitorId: 'V4', dwellSec: 30 }),
        e({ cameraId: entrance, type: 'EXIT', ts: t('12:30'), visitorId: 'V3', dwellSec: 1800 }),
      ],
    }, c.seed.keys.tnagar).expect(200);
    await post('events', {
      events: [
        e({ cameraId: entrance2, type: 'ENTRY', ts: t('11:00'), visitorId: 'W1', gender: 'F', ageBand: '25-34' }),
        e({ cameraId: entrance2, zoneId: annMens, type: 'ZONE_ENTER', ts: t('11:01'), visitorId: 'W1', gender: 'F', ageBand: '25-34' }),
        e({ cameraId: entrance2, zoneId: annMens, type: 'ZONE_EXIT', ts: t('11:03'), visitorId: 'W1', gender: 'F', ageBand: '25-34', dwellSec: 100 }),
        e({ cameraId: entrance2, type: 'EXIT', ts: t('11:10'), visitorId: 'W1', dwellSec: 600 }),
      ],
    }, c.seed.keys.annanagar).expect(200);
  });
  afterAll(async () => c.app.close());

  it('zones: bouncedPct, concentrationPct, dominantAgeBand, genderSplit', async () => {
    const r = await get(`/api/analytics/zones?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200);
    const by = Object.fromEntries(r.body.map((z: { name: string }) => [z.name, z]));
    expect(by["Men's Wear"]).toMatchObject({ visits: 3, engaged: 2, bouncedPct: 33.33, concentrationPct: 50, dominantAgeBand: '18-24', genderSplit: { malePct: 66.67, femalePct: 33.33 } });
    expect(by["Women's Wear"]).toMatchObject({ visits: 1, engaged: 0, bouncedPct: 100, concentrationPct: 0, dominantAgeBand: '25-34', genderSplit: { malePct: 0, femalePct: 100 } });
    expect(by.Footwear).toMatchObject({ visits: 0, bouncedPct: null, engagedPct: null, concentrationPct: 0, dominantAgeBand: null, genderSplit: { malePct: 0, femalePct: 0 } });
  });

  it('traffic hourly bouncedPct', async () => {
    const r = await get(`/api/analytics/traffic?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200);
    expect(r.body.hourly[11]).toEqual({ hour: 11, footfall: 2, avgPerDay: 2, bouncedPct: 50 });
    expect(r.body.hourly[12]).toEqual({ hour: 12, footfall: 2, avgPerDay: 2, bouncedPct: 50 });
    expect(r.body.hourly[13].bouncedPct).toBeNull(); // no footfall in that hour → undefined ratio
  });

  it('conversion: funnel order and customersPerStaff', async () => {
    const r = await get(`/api/analytics/conversion?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200);
    expect(Object.keys(r.body.funnel)).toEqual(['footfall', 'engaged', 'billableEntities', 'transactions']);
    expect(r.body.funnel).toEqual({ footfall: 4, engaged: 2, billableEntities: 2, transactions: 0 });
    const h11 = r.body.hourly.find((h: { hour: number }) => h.hour === 11);
    const h12 = r.body.hourly.find((h: { hour: number }) => h.hour === 12);
    expect(h11).toMatchObject({ billableEntities: 2, staffPresentAvg: 1, customersPerStaff: 2 });
    expect(h12).toMatchObject({ billableEntities: 2, staffPresentAvg: 0, customersPerStaff: 0 });
  });

  it('conversion funnel is monotonic: footfall → engaged people → engaged billable entities → transactions', async () => {
    // Anna Nagar, D-2: group G (2 people, both engaged) + individual I1 engaged + individual I2 bounced; 1 bill
    const D2 = istDate(-2);
    const t2 = (hhmm: string) => istToday(hhmm, -2);
    const cam = c.seed.cameras.entrance2;
    await post('events', { events: [
      e({ cameraId: cam, type: 'ENTRY', ts: t2('15:00'), visitorId: 'G-a', groupId: 'G' }),
      e({ cameraId: cam, type: 'ENTRY', ts: t2('15:00'), visitorId: 'G-b', groupId: 'G' }),
      e({ cameraId: cam, type: 'ENTRY', ts: t2('15:05'), visitorId: 'I1' }),
      e({ cameraId: cam, type: 'ENTRY', ts: t2('15:10'), visitorId: 'I2' }),
      e({ cameraId: cam, type: 'EXIT', ts: t2('15:10'), visitorId: 'I2', dwellSec: 30 }),
      e({ cameraId: cam, type: 'EXIT', ts: t2('15:20'), visitorId: 'G-a', dwellSec: 1200 }),
      e({ cameraId: cam, type: 'EXIT', ts: t2('15:20'), visitorId: 'G-b', dwellSec: 1200 }),
      e({ cameraId: cam, type: 'EXIT', ts: t2('15:30'), visitorId: 'I1', dwellSec: 1500 }),
    ] }, c.seed.keys.annanagar).expect(200);
    await c.http().post('/api/pos/transactions').set('X-Api-Key', c.seed.keys.annanagar).send({ transactions: [{ storeId: c.seed.stores.annanagar, billNo: 'F-1', ts: t2('15:25'), amount: 1000, itemsCount: 1 }] }).expect(200);
    const r = await get(`/api/analytics/conversion?storeIds=${c.seed.stores.annanagar}&from=${D2}&to=${D2}`).expect(200);
    expect(r.body.funnel).toEqual({ footfall: 4, engaged: 3, billableEntities: 2, transactions: 1 });
    expect(r.body.totals.conversionPct).toBe(33.33); // 1 ÷ 3 billable entities (unchanged definition)
    expect(r.body.segments).toEqual({ bounced: 1, missedOpportunities: 1, converted: 1 });
    const ov = await get(`/api/analytics/overview?storeIds=${c.seed.stores.annanagar}&from=${D2}&to=${D2}`).expect(200);
    expect(ov.body.kpis.billableEntities.value).toBe(3);
    expect(ov.body.kpis.missedOpportunities.value).toBe(1);
  });

  it('traffic density (dow × hour over open hours)', async () => {
    const r = await get(`/api/analytics/traffic-density?storeIds=${c.seed.stores.tnagar}&from=${D}&to=${D}`).expect(200);
    expect(r.body.hours).toEqual([10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]);
    expect(r.body.cells).toHaveLength(7 * 12);
    const dow = new Date(D + 'T00:00:00Z').getUTCDay();
    const cell = (d: number, h: number) => r.body.cells.find((x: { dow: number; hour: number }) => x.dow === d && x.hour === h);
    expect(cell(dow, 11)).toEqual({ dow, hour: 11, avgFootfall: 2 });
    expect(cell(dow, 12)).toEqual({ dow, hour: 12, avgFootfall: 2 });
    expect(cell((dow + 1) % 7, 11).avgFootfall).toBe(0);
    expect(r.body.max).toBe(2);
    // two weeks: the same weekday occurs twice → average halves
    const r2 = await get(`/api/analytics/traffic-density?storeIds=${c.seed.stores.tnagar}&from=${istDate(-14)}&to=${D}`).expect(200);
    expect(r2.body.cells.find((x: { dow: number; hour: number }) => x.dow === dow && x.hour === 11).avgFootfall).toBe(1);
  });

  it('journey across stores (merged by zone name) with highlights', async () => {
    const r = await get(`/api/analytics/journey?storeIds=${c.seed.stores.tnagar},${c.seed.stores.annanagar}&from=${D}&to=${D}`).expect(200);
    const { mens, womens } = c.seed.zones;
    expect(r.body.totalFootfall).toBe(5);
    expect(r.body.links).toEqual([
      { source: 0, target: mens, count: 4 },
      { source: mens, target: womens, count: 1 },
    ]);
    expect(r.body.nodes.filter((n: { name: string }) => n.name === "Men's Wear")).toEqual([{ id: mens, name: "Men's Wear" }]);
    expect(r.body.highlights).toEqual({
      highestFootfall: { zoneName: "Men's Wear", value: 4, label: '4 visits' },
      highestImpression: { zoneName: "Men's Wear", value: 80, label: '80% of footfall' },
      highestBounced: { zoneName: "Women's Wear", value: 100, label: '100% bounced' },
      highestEngaged: { zoneName: "Men's Wear", value: 75, label: '75% engaged' },
      highestDwell: { zoneName: "Men's Wear", value: 75, label: '75 s avg dwell' },
    });
    const single = await get(`/api/analytics/journey?storeId=${c.seed.stores.annanagar}&from=${D}&to=${D}`).expect(200);
    expect(single.body.links).toEqual([{ source: 0, target: annMens, count: 1 }]);
    expect(single.body.totalFootfall).toBe(1);
    await c.http().get(`/api/analytics/journey?storeIds=${c.seed.stores.tnagar},${c.seed.stores.annanagar}`).set(bearer(c.tokens.manager)).expect(200);
  });

  it('benchmark rows add format/bouncedPct/engagedPct; grouped benchmark', async () => {
    await c.http().patch(`/api/stores/${c.seed.stores.annanagar}`).set(adm()).send({ format: 'MALL' }).expect(200);
    await c.http().patch(`/api/stores/${c.seed.stores.annanagar}`).set(adm()).send({ format: 'SPACESHIP' }).expect(400);
    const b = await get(`/api/analytics/benchmark?from=${D}&to=${D}`).expect(200);
    expect(b.body.find((x: { storeId: number }) => x.storeId === c.seed.stores.tnagar)).toMatchObject({ format: 'HIGH_STREET', footfall: 4, bouncedPct: 50, engagedPct: 50 });
    expect(b.body.find((x: { storeId: number }) => x.storeId === c.seed.stores.annanagar)).toMatchObject({ format: 'MALL', footfall: 1, bouncedPct: 0, engagedPct: 100 });
    const g = await get(`/api/analytics/benchmark/groups?groupBy=format&from=${D}&to=${D}`).expect(200);
    expect(g.body).toEqual([
      { group: 'HIGH_STREET', stores: 2, footfall: 4, conversionPct: 0, revenue: 0, atv: null, avgDwellSec: 767.5, bouncedPct: 50, engagedPct: 50, missedOpportunities: 2 },
      { group: 'MALL', stores: 1, footfall: 1, conversionPct: 0, revenue: 0, atv: null, avgDwellSec: 600, bouncedPct: 0, engagedPct: 100, missedOpportunities: 1 },
    ]);
    const reg = await get(`/api/analytics/benchmark/groups?groupBy=region&from=${D}&to=${D}`).expect(200);
    expect(reg.body.map((x: { group: string; stores: number; footfall: number }) => [x.group, x.stores, x.footfall])).toEqual([['Chennai', 2, 5], ['Coimbatore', 1, 0]]);
    const city = await get(`/api/analytics/benchmark/groups?groupBy=city&from=${D}&to=${D}`).expect(200);
    expect(city.body.map((x: { group: string }) => x.group)).toEqual(['Chennai', 'Coimbatore']);
    await get('/api/analytics/benchmark/groups?groupBy=planet').expect(400);
    expect((await c.http().get(`/api/analytics/benchmark/groups?groupBy=region&from=${D}&to=${D}`).set(bearer(c.tokens.manager)).expect(200)).body).toEqual([expect.objectContaining({ group: 'Chennai', stores: 1, footfall: 4 })]);
  });

  it('infra health classification + auto tickets', async () => {
    const { entrance, floor, billing } = c.seed.cameras;
    await post('heartbeat', { version: '2.0.1', cameras: [{ cameraId: entrance, status: 'ONLINE' }, { cameraId: floor, status: 'ONLINE' }, { cameraId: billing, status: 'OFFLINE' }] }, c.seed.keys.tnagar).expect(200);
    // Anna Nagar edge last seen 30 min ago → OFFLINE
    await c.http().get('/api/ingest/config').set('X-Api-Key', c.seed.keys.annanagar).expect(200);
    await c.ds.query('UPDATE edge_devices SET lastSeenAt = ? WHERE storeId = ?', [new Date(Date.now() - 30 * 60000).toISOString().replace('T', ' ').replace('Z', ''), c.seed.stores.annanagar]);
    await c.http().post('/api/tickets').set(adm()).send({ title: 'Billing cam down', storeId: c.seed.stores.tnagar, category: 'CAMERA', priority: 'HIGH' }).expect(201);
    await c.http().post('/api/tickets').set(adm()).send({ title: 'AC leak', storeId: c.seed.stores.tnagar, category: 'MAINTENANCE', priority: 'LOW' }).expect(201);
    let r = await get('/api/infra/health').expect(200);
    const s = (id: number) => r.body.stores.find((x: { storeId: number }) => x.storeId === id);
    expect(s(c.seed.stores.tnagar)).toMatchObject({ edgeStatus: 'ONLINE', edgeVersion: '2.0.1', camerasOnline: 2, camerasTotal: 3, health: 'DEGRADED', openTickets: 1, issues: ['Camera "Billing" is OFFLINE'] });
    expect(s(c.seed.stores.tnagar).uptimePct7d).toBeGreaterThan(95);
    expect(s(c.seed.stores.annanagar)).toMatchObject({ edgeStatus: 'OFFLINE', camerasOnline: 0, camerasTotal: 1, health: 'DOWN' });
    expect(s(c.seed.stores.annanagar).issues[0]).toContain('Edge device offline since');
    // store-local wording, never a raw ISO timestamp ("Edge device offline since 05 Oct, 10:11 pm")
    expect(s(c.seed.stores.annanagar).issues[0]).toMatch(/since \d{2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (am|pm)$/);
    for (const st of r.body.stores) for (const i of st.issues) expect(i).not.toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:/);
    // no cameras → no uptime (null), not 100 %
    expect(s(c.seed.stores.coimbatore)).toMatchObject({ edgeStatus: 'NEVER', edgeLastSeenAt: null, camerasTotal: 0, health: 'DOWN', uptimePct7d: null });
    expect(r.body.totals).toEqual({ stores: 3, healthy: 0, degraded: 1, down: 2, camerasOnline: 2, camerasTotal: 4, openInfraTickets: 1 });
    await post('heartbeat', { cameras: [{ cameraId: billing, status: 'ONLINE' }] }, c.seed.keys.tnagar).expect(200);
    r = await get(`/api/infra/health?storeIds=${c.seed.stores.tnagar}`).expect(200);
    expect(r.body.stores).toHaveLength(1);
    expect(r.body.stores[0]).toMatchObject({ health: 'GOOD', camerasOnline: 3, issues: [] });

    // EDGE_OFFLINE with autoTicket → NETWORK ticket
    const rule = await c.http().post('/api/alert-rules').set(adm()).send({ name: 'Edge box offline', metric: 'EDGE_OFFLINE', threshold: 10, severity: 'CRITICAL', channels: ['IN_APP'], autoTicket: true }).expect(201);
    expect(rule.body.autoTicket).toBe(true);
    expect((await c.http().post('/api/alerts/evaluate').set(adm()).expect(200)).body.created).toBe(1);
    const a = (await get(`/api/alerts?storeIds=${c.seed.stores.annanagar}`).expect(200)).body.items[0];
    expect(a).toMatchObject({ metric: 'EDGE_OFFLINE', severity: 'CRITICAL', value: 30, ticketId: expect.any(Number) });
    const tk = (await get(`/api/tickets/${a.ticketId}`).expect(200)).body;
    expect(tk).toMatchObject({ category: 'NETWORK', priority: 'URGENT', alertId: a.id, storeId: c.seed.stores.annanagar, status: 'OPEN' });
    const after = await get(`/api/infra/health?storeIds=${c.seed.stores.annanagar}`).expect(200);
    expect(after.body.totals.openInfraTickets).toBe(1);
  });
});
