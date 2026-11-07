import { DataSource } from 'typeorm';
import { databaseOptions } from '../../config/database.config';
import { localParts, zonedToUtc } from '../../common/time.util';
import { HourlyStoreMetric } from '../analytics/entities/hourly-store-metric.entity';
import { HourlyZoneMetric } from '../analytics/entities/hourly-zone-metric.entity';
import { Visit } from '../analytics/entities/visit.entity';
import { ZoneTransition } from '../analytics/entities/zone-transition.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { QueueSnapshot } from '../ingest/entities/queue-snapshot.entity';
import { VisitorEvent } from '../ingest/entities/visitor-event.entity';
import { PosTransaction } from '../pos/entities/pos-transaction.entity';
import { Region } from '../regions/entities/region.entity';
import { DEFAULT_SETTINGS } from '../settings/settings.service';
import { Store } from '../stores/entities/store.entity';
import { Zone } from '../zones/entities/zone.entity';
import { AggregationService } from './aggregation.service';
import { finalizeVisit, VisitBuilderService } from './visit-builder.service';

describe('AggregationService + VisitBuilderService', () => {
  let ds: DataSource;
  let agg: AggregationService;
  let builder: VisitBuilderService;
  let storeId: number;
  let zones: Map<number, Zone>;
  let mens: Zone;
  let shoes: Zone;
  let queue: Zone;
  const DATE = '2026-09-15';
  const at = (hhmm: string) => zonedToUtc(DATE, hhmm, 'Asia/Kolkata');

  beforeAll(async () => {
    ds = new DataSource(databaseOptions());
    await ds.initialize();
    const region = await ds.getRepository(Region).save({ name: 'Chennai' });
    const store = await ds.getRepository(Store).save({ code: 'S1', name: 'S1', regionId: region.id, timezone: 'Asia/Kolkata', openTime: '10:00', closeTime: '21:30', areaSqft: 1000, isActive: true });
    storeId = store.id;
    const cam = await ds.getRepository(Camera).save({ storeId, name: 'Floor', type: 'ZONE', status: 'ONLINE', isActive: true, rtspUrl: '' });
    const poly: [number, number][] = [[0, 0], [1, 0], [1, 1]];
    mens = await ds.getRepository(Zone).save({ storeId, cameraId: cam.id, name: 'Mens', type: 'SECTION', polygon: poly, engagedDwellSec: 30, isActive: true });
    shoes = await ds.getRepository(Zone).save({ storeId, cameraId: cam.id, name: 'Shoes', type: 'SECTION', polygon: poly, engagedDwellSec: 120, isActive: true });
    queue = await ds.getRepository(Zone).save({ storeId, cameraId: cam.id, name: 'Q1', type: 'QUEUE', polygon: poly, engagedDwellSec: 30, queueAlertLength: 3, isActive: true });
    zones = new Map([mens, shoes, queue].map((z) => [z.id, z]));
    agg = new AggregationService(ds);
    builder = new VisitBuilderService(ds);
  });
  afterAll(async () => ds.destroy());

  const event = (o: Partial<VisitorEvent> & { ts: Date }): Partial<VisitorEvent> => {
    const p = localParts(o.ts, 'Asia/Kolkata');
    return { storeId, cameraId: 1, zoneId: null, trackId: 't', isStaff: false, groupId: null, gender: 'U', ageBand: 'U', dwellSec: null, date: p.date, hour: p.hour, ...o };
  };

  it('finalizeVisit applies engaged / bounced definitions', () => {
    const v = { zoneEngaged: false, dwellSec: 59 } as Visit;
    finalizeVisit(v, DEFAULT_SETTINGS);
    expect([v.engaged, v.bounced]).toEqual([false, true]);
    v.dwellSec = 300;
    finalizeVisit(v, DEFAULT_SETTINGS);
    expect([v.engaged, v.bounced]).toEqual([true, false]);
    Object.assign(v, { dwellSec: 10, zoneEngaged: true });
    finalizeVisit(v, DEFAULT_SETTINGS);
    expect([v.engaged, v.bounced]).toEqual([true, false]);
    Object.assign(v, { dwellSec: null, zoneEngaged: false });
    finalizeVisit(v, DEFAULT_SETTINGS);
    expect([v.engaged, v.bounced]).toEqual([false, false]);
  });

  it('builds visits and hourly rollups', async () => {
    const rows = [
      event({ type: 'ENTRY', ts: at('14:05'), visitorId: 'A', gender: 'M', ageBand: '25-34', groupId: 'G' }),
      event({ type: 'ENTRY', ts: at('14:06'), visitorId: 'B', gender: 'F', ageBand: '25-34', groupId: 'G' }),
      event({ type: 'ENTRY', ts: at('14:50'), visitorId: 'C', gender: 'F', ageBand: '0-17', groupId: 'SOLO' }),
      event({ type: 'ENTRY', ts: at('14:10'), visitorId: 'STAFF1', isStaff: true }),
      event({ type: 'ZONE_ENTER', ts: at('14:07'), visitorId: 'A', zoneId: mens.id, gender: 'M' }),
      event({ type: 'ZONE_EXIT', ts: at('14:09'), visitorId: 'A', zoneId: mens.id, gender: 'M', dwellSec: 100 }),
      event({ type: 'ZONE_ENTER', ts: at('14:10'), visitorId: 'A', zoneId: shoes.id, gender: 'M' }),
      event({ type: 'ZONE_EXIT', ts: at('14:12'), visitorId: 'A', zoneId: shoes.id, gender: 'M', dwellSec: 100 }),
      event({ type: 'EXIT', ts: at('15:10'), visitorId: 'A', dwellSec: 3900 }),
      event({ type: 'EXIT', ts: at('14:07'), visitorId: 'B', dwellSec: 30 }),
      event({ type: 'EXIT', ts: at('14:52'), visitorId: 'C', dwellSec: 120 }),
      event({ type: 'EXIT', ts: at('16:10'), visitorId: 'STAFF1', isStaff: true }),
    ];
    const saved = await ds.getRepository(VisitorEvent).save(rows as VisitorEvent[]);
    const affected = await builder.process(storeId, saved, zones, DEFAULT_SETTINGS);
    expect([...affected.get(DATE)].sort()).toEqual([14]);
    await ds.getRepository(PosTransaction).save({ storeId, billNo: 'X1', ts: at('14:30'), date: DATE, hour: 14, amount: 1000, itemsCount: 3, source: 'API' });
    await ds.getRepository(QueueSnapshot).save([
      { storeId, zoneId: queue.id, ts: at('14:00'), date: DATE, hour: 14, queueLength: 2, avgWaitSec: 30, counterStaffed: true },
      { storeId, zoneId: queue.id, ts: at('14:01'), date: DATE, hour: 14, queueLength: 4, avgWaitSec: 90, counterStaffed: false },
      { storeId, zoneId: queue.id, ts: at('14:02'), date: DATE, hour: 14, queueLength: 0, avgWaitSec: 0, counterStaffed: false },
    ]);
    await agg.recompute(storeId, DATE, undefined, at('23:00'));

    const visits = await ds.getRepository(Visit).find({ where: { storeId }, order: { id: 'ASC' } });
    expect(visits.map((v) => [v.visitorId, v.engaged, v.bounced]).sort()).toEqual([
      ['A', true, false],
      ['B', false, true],
      ['C', false, false],
      ['STAFF1', false, false],
    ]);
    const h14 = await ds.getRepository(HourlyStoreMetric).findOneByOrFail({ storeId, date: DATE, hour: 14 });
    expect(h14).toMatchObject({
      footfallIn: 3, footfallOut: 2, staffEntries: 1, uniqueVisitors: 3,
      individuals: 1, groups: 1, billableEntities: 2, engaged: 1, engagedEntities: 1, bounced: 1,
      male: 1, female: 2, age_25_34: 2, age_0_17: 1, male_25_34: 1, female_25_34: 1, female_0_17: 1,
      totalDwellSec: 4050, dwellCount: 3, transactions: 1, revenue: 1000, itemsSold: 3,
      queueSamples: 3, maxQueueLength: 4, avgQueueLength: 2, avgWaitSec: 40, queueBreaches: 1, unattendedSec: 60,
    });
    // staff present 14:10 → 16:10 : 50 minutes of hour 14
    expect(h14.staffPresentAvg).toBeCloseTo(50 / 60, 2);
    const h15 = await ds.getRepository(HourlyStoreMetric).findOneByOrFail({ storeId, date: DATE, hour: 15 });
    expect(h15).toMatchObject({ footfallIn: 0, footfallOut: 1, staffPresentAvg: 1 });

    const zm = await ds.getRepository(HourlyZoneMetric).find({ where: { storeId, date: DATE } });
    const byZone = Object.fromEntries(zm.map((z) => [z.zoneId, z]));
    expect(byZone[mens.id]).toMatchObject({ visits: 1, uniqueVisitors: 1, totalDwellSec: 100, dwellCount: 1, engaged: 1, male: 1 });
    expect(byZone[shoes.id]).toMatchObject({ visits: 1, engaged: 0 }); // 100s < 120s threshold
    expect(byZone[queue.id]).toMatchObject({ queueSamples: 3, maxQueueLength: 4, queueBreaches: 1, unattendedSec: 60 });

    const tr = await ds.getRepository(ZoneTransition).find({ where: { storeId, date: DATE } });
    expect(tr.map((t) => [t.fromZoneId, t.toZoneId, t.count]).sort()).toEqual([[0, mens.id, 1], [mens.id, shoes.id, 1]].sort());
  });

  it('recompute is idempotent', async () => {
    await agg.recompute(storeId, DATE, undefined, at('23:00'));
    await agg.recompute(storeId, DATE, [14], at('23:00'));
    expect(await ds.getRepository(HourlyStoreMetric).count({ where: { storeId, date: DATE } })).toBeGreaterThan(0);
    expect(await ds.getRepository(HourlyStoreMetric).count({ where: { storeId, date: DATE, hour: 14 } })).toBe(1);
    expect((await ds.getRepository(HourlyStoreMetric).findOneByOrFail({ storeId, date: DATE, hour: 14 })).footfallIn).toBe(3);
    expect(await ds.getRepository(ZoneTransition).count({ where: { storeId, date: DATE } })).toBe(2);
  });

  it('closes stale visits and marks repeat visitors', async () => {
    const next = '2026-09-20';
    const e = event({ type: 'ENTRY', ts: zonedToUtc(next, '11:00', 'Asia/Kolkata'), visitorId: 'A' });
    const saved = await ds.getRepository(VisitorEvent).save([e as VisitorEvent]);
    await builder.process(storeId, saved, zones, DEFAULT_SETTINGS);
    const v = await ds.getRepository(Visit).findOneByOrFail({ storeId, visitorId: 'A', date: next });
    expect(v.isRepeat).toBe(true);
    expect(v.exitTs).toBeNull();
    const closed = await builder.closeStale(zonedToUtc(next, '15:30', 'Asia/Kolkata'), DEFAULT_SETTINGS);
    expect([...closed.get(storeId).get(next)]).toEqual([11]);
    const after = await ds.getRepository(Visit).findOneByOrFail({ id: v.id });
    expect(after).toMatchObject({ autoClosed: true, dwellSec: 0, bounced: true });
  });
});
