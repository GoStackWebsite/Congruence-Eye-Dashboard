import { DataSource } from 'typeorm';
import { bulkInsert } from '../common/bulk';
import { localParts, zonedToUtc } from '../common/time.util';
import { QueueSnapshot } from '../modules/ingest/entities/queue-snapshot.entity';
import { VisitorEvent } from '../modules/ingest/entities/visitor-event.entity';
import { AggregationService } from '../modules/pipeline/aggregation.service';
import { VisitBuilderService } from '../modules/pipeline/visit-builder.service';
import { PosTransaction } from '../modules/pos/entities/pos-transaction.entity';
import { Settings } from '../modules/settings/settings.service';
import { Zone } from '../modules/zones/entities/zone.entity';
import { AGE_DIST } from './catalog';
import { amountFor, baseDailyFootfall, dayFactor, hourShares, openHours, SeedStore } from './model';
import { Rng } from './rng';

/**
 * Generates TODAY's raw edge data (visitor events, queue snapshots, POS) up to `now` for every store
 * and runs it through the real pipeline (VisitBuilderService + AggregationService) so live views work.
 */
export async function seedToday(ds: DataSource, stores: SeedStore[], today: string, now: Date, pools: Map<number, string[]>, settings: Settings, rng: Rng, log: (m: string) => void) {
  const builder = new VisitBuilderService(ds);
  const agg = new AggregationService(ds);
  let totalEvents = 0;
  for (const st of stores) {
    const tz = st.tz;
    const lp = localParts(now, tz);
    const nowMin = lp.hour * 60 + lp.minute + lp.second / 60;
    const base = zonedToUtc(today, '00:00', tz).getTime();
    const tsAt = (min: number) => new Date(base + Math.round(min * 60_000));
    const events: Partial<VisitorEvent>[] = [];
    const snaps: Partial<QueueSnapshot>[] = [];
    const pos: Partial<PosTransaction>[] = [];
    const ev = (o: Partial<VisitorEvent> & { min: number }) => {
      const { min, ...rest } = o;
      if (min > nowMin) return;
      const ts = tsAt(min);
      const p = localParts(ts, tz);
      events.push({ storeId: st.id, zoneId: null, isStaff: false, groupId: null, gender: 'U', ageBand: 'U', dwellSec: null, ...rest, ts, date: p.date, hour: p.hour });
    };
    const hours = openHours(st.def);
    const openMin = hours[0].startMin;
    // staff
    st.staff.slice(0, rng.int(6, Math.min(8, st.staff.length))).forEach((s, i) => {
      const inMin = i < 2 && rng.chance(0.5) ? 14 * 60 + rng.between(-5, 10) : openMin - rng.between(5, 25);
      const outMin = inMin + 9.5 * 60 + rng.between(-10, 20);
      ev({ min: inMin, type: 'ENTRY', cameraId: st.entrance.id, zoneId: st.entryLine.id, trackId: `st-${s.code}`, visitorId: `staff-${s.code}`, isStaff: true });
      ev({ min: inMin + 20, type: 'ZONE_ENTER', cameraId: st.billing.id, zoneId: st.staffArea.id, trackId: `st-${s.code}`, visitorId: `staff-${s.code}`, isStaff: true });
      ev({ min: outMin, type: 'EXIT', cameraId: st.entrance.id, zoneId: st.entryLine.id, trackId: `st-${s.code}`, visitorId: `staff-${s.code}`, isStaff: true, dwellSec: Math.round((outMin - inMin) * 60) });
    });
    if (nowMin < openMin) {
      // before opening only staff arrive — still run them through the pipeline (visits + rollups), like the edge would
      if (events.length) {
        await ds.transaction((em) => bulkInsert(em, VisitorEvent, events));
        const early = await ds.getRepository(VisitorEvent).find({ where: { storeId: st.id, date: today }, order: { ts: 'ASC', id: 'ASC' } });
        await builder.process(st.id, early, new Map([st.entryLine, st.staffArea].map((z) => [z.id, z])), settings);
        await agg.recompute(st.id, today, undefined, now);
      }
      continue;
    }
    const daily = baseDailyFootfall(st.def) * dayFactor(today);
    const shares = hourShares(st.def);
    const conv = st.def.baseConversion;
    const pool = [...(pools.get(st.id) ?? [])];
    const sectionW = st.sections.map((s) => s.def.weight);
    let n = 0;
    let bill = 0;
    const cashiers = st.staff.filter((s) => s.designation === 'Cashier').map((s) => s.code);
    for (const h of hours) {
      if (h.startMin > nowMin) break;
      const until = Math.min(h.endMin, nowMin);
      const portion = (until - h.startMin) / (h.endMin - h.startMin);
      let people = rng.round(daily * (shares.get(h.hour) ?? 0) * portion * rng.jitter(0.1));
      while (people > 0) {
        const size = Math.min(people, rng.chance(0.67) ? 1 : rng.chance(0.75) ? 2 : 3);
        people -= size;
        const groupId = size > 1 ? `g-${st.def.short}-${today}-${n}` : null;
        const entry = rng.between(h.startMin, until);
        const bounced = rng.chance(0.15);
        const buyer = !bounced && rng.chance(Math.min(0.6, conv * 1.15));
        const dwellSec = bounced ? rng.int(18, 55) : Math.round(Math.min(3600, Math.max(150, Math.exp(rng.normal(Math.log(560), 0.45)))));
        for (let k = 0; k < size; k++) {
          n++;
          const visitorId = pool.length && rng.chance(0.2) ? pool.splice(rng.int(0, pool.length - 1), 1)[0] : `v-${st.def.short}-${today}-${n}`;
          const trackId = `trk-${n}`;
          const age = rng.weighted(AGE_DIST.map((a) => a[0]), AGE_DIST.map((a) => a[1]));
          const gender = rng.weighted(['M', 'F', 'U'], [0.46, 0.5, 0.04]);
          const t0 = entry + k * (rng.int(1, 4) / 60);
          ev({ min: t0, type: 'ENTRY', cameraId: st.entrance.id, zoneId: st.entryLine.id, trackId, visitorId, groupId, gender, ageBand: age });
          const exitMin = t0 + dwellSec / 60;
          if (!bounced) {
            const visitsN = rng.int(1, 3);
            let cursor = t0 + rng.between(0.3, 1.2);
            const budget = (dwellSec / 60) * 0.75;
            const seen = new Set<Zone>();
            for (let z = 0; z < visitsN; z++) {
              const s = rng.weighted(st.sections, sectionW);
              if (seen.has(s.zone)) continue;
              seen.add(s.zone);
              const zd = Math.max(8, Math.min((budget / visitsN) * 60, s.def.dwell * rng.jitter(0.6)));
              const cam = st.floors[s.def.cam];
              ev({ min: cursor, type: 'ZONE_ENTER', cameraId: cam.id, zoneId: s.zone.id, trackId: `${trackId}-z${z}`, visitorId, gender, ageBand: age });
              ev({ min: cursor + zd / 60, type: 'ZONE_EXIT', cameraId: cam.id, zoneId: s.zone.id, trackId: `${trackId}-z${z}`, visitorId, gender, ageBand: age, dwellSec: Math.round(zd) });
              cursor += zd / 60 + rng.between(0.2, 1.5);
            }
          }
          if (buyer && k === 0) {
            const q = rng.chance(0.6) ? st.queues[0] : st.queues[1];
            const wait = rng.int(30, 240);
            const qIn = exitMin - (wait + 90) / 60;
            ev({ min: qIn, type: 'ZONE_ENTER', cameraId: st.billing.id, zoneId: q.id, trackId: `${trackId}-q`, visitorId, gender, ageBand: age });
            ev({ min: qIn + wait / 60, type: 'ZONE_EXIT', cameraId: st.billing.id, zoneId: q.id, trackId: `${trackId}-q`, visitorId, gender, ageBand: age, dwellSec: wait });
            const payMin = exitMin - 1;
            if (payMin <= nowMin) {
              const ts = tsAt(payMin);
              const p = localParts(ts, tz);
              bill++;
              pos.push({ storeId: st.id, billNo: `${st.def.short}-${today.replace(/-/g, '')}-${String(bill).padStart(4, '0')}`, ts, date: p.date, hour: p.hour, amount: amountFor(rng, st.def.atv), itemsCount: Math.max(1, Math.round(rng.normal(2.3, 1.1))), staffCode: rng.pick(cashiers.length ? cashiers : ['S01']), source: 'POS' });
            }
          }
          ev({ min: exitMin, type: 'EXIT', cameraId: st.entrance.id, zoneId: st.entryLine.id, trackId, visitorId, groupId, gender, ageBand: age, dwellSec });
        }
      }
    }
    // queue snapshots: one per counter per minute
    for (let m = openMin; m <= nowMin; m += 1) {
      const hour = Math.floor(m / 60);
      const demand = daily * (shares.get(hour) ?? 0) * 0.8 * conv * 0.085;
      st.queues.forEach((q, qi) => {
        const morning = m < 12 * 60;
        const staffed = qi === 0 ? !rng.chance(0.02) : morning ? false : !rng.chance(0.05);
        const len = qi === 1 && morning ? 0 : Math.max(0, Math.round(rng.normal(demand * (qi === 0 ? 1.2 : 0.8), 1.1)));
        const ts = tsAt(m + rng.between(0, 0.1));
        const p = localParts(ts, tz);
        snaps.push({ storeId: st.id, zoneId: q.id, ts, date: p.date, hour: p.hour, queueLength: len, avgWaitSec: Math.round(len * rng.between(40, 65)), counterStaffed: staffed });
      });
    }
    events.sort((a, b) => a.ts.getTime() - b.ts.getTime());
    await ds.transaction(async (em) => {
      await bulkInsert(em, VisitorEvent, events);
      await bulkInsert(em, QueueSnapshot, snaps);
      await bulkInsert(em, PosTransaction, pos);
    });
    const saved = await ds.getRepository(VisitorEvent).find({ where: { storeId: st.id, date: today }, order: { ts: 'ASC', id: 'ASC' } });
    const zones = new Map([st.entryLine, st.staffArea, ...st.queues, ...st.sections.map((s) => s.zone)].map((z) => [z.id, z]));
    for (let i = 0; i < saved.length; i += 4000) await builder.process(st.id, saved.slice(i, i + 4000), zones, settings);
    await agg.recompute(st.id, today, undefined, now);
    totalEvents += saved.length;
    log(`  ${st.def.code}: ${saved.length} events, ${snaps.length} queue snapshots, ${pos.length} POS bills today`);
  }
  return totalEvents;
}
