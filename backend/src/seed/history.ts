import { DataSource, EntityManager } from 'typeorm';
import { bulkInsert } from '../common/bulk';
import { addDays, zonedToUtc } from '../common/time.util';
import { AGE_KEYS, HourlyStoreMetric } from '../modules/analytics/entities/hourly-store-metric.entity';
import { HourlyZoneMetric } from '../modules/analytics/entities/hourly-zone-metric.entity';
import { Visit } from '../modules/analytics/entities/visit.entity';
import { ZoneTransition } from '../modules/analytics/entities/zone-transition.entity';
import { CameraStatusLog } from '../modules/cameras/entities/camera-status-log.entity';
import { Camera } from '../modules/cameras/entities/camera.entity';
import { HeatmapFrame } from '../modules/ingest/entities/heatmap-frame.entity';
import { StoreOpsEvent } from '../modules/ingest/entities/storeops-event.entity';
import { PosTransaction } from '../modules/pos/entities/pos-transaction.entity';
import { AGE_DIST } from './catalog';
import { amountFor, baseDailyFootfall, dateRange, dayFactor, festiveFactor, hourShares, openHours, SeedStore, split } from './model';
import { Rng } from './rng';

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const r2 = (v: number) => Math.round(v * 100) / 100;

/** 90 days of hourly rollups + POS rows + zone metrics + transitions (history ends yesterday). */
export async function seedHistory(ds: DataSource, stores: SeedStore[], today: string, days: number, rng: Rng, log: (m: string) => void) {
  const dates = dateRange(today, days);
  let posTotal = 0;
  for (const st of stores) {
    const def = st.def;
    const shares = hourShares(def);
    const hours = openHours(def);
    const storeRows: Partial<HourlyStoreMetric>[] = [];
    const zoneRows: Partial<HourlyZoneMetric>[] = [];
    const transRows: Partial<ZoneTransition>[] = [];
    const posRows: Partial<PosTransaction>[] = [];
    const cashiers = st.staff.filter((s) => s.designation === 'Cashier' || s.designation === 'Store Supervisor').map((s) => s.code);
    const totalW = st.sections.reduce((a, s) => a + s.def.weight, 0);
    for (const date of dates) {
      const dow = new Date(date + 'T00:00:00Z').getUTCDay();
      const weekend = dow === 0 || dow === 6;
      const daily = baseDailyFootfall(def) * dayFactor(date) * rng.jitter(0.08);
      const conv = clamp(def.baseConversion * (weekend ? 0.92 : 1) * rng.jitter(0.1), 0.18, 0.35);
      const atv = def.atv * rng.jitter(0.08) * (festiveFactor(date) > 1.2 ? 1.12 : 1);
      const avgDwellMin = clamp(9.5 * (weekend ? 1.15 : 1) * rng.jitter(0.2) * (def.areaSqft / 6000) ** 0.3, 6, 18);
      const staffN = Math.min(st.staff.length, rng.int(6, 8));
      const sectionDay = new Map<number, number>();
      let txDay = 0;
      let seq = 0;
      for (const h of hours) {
        const ff = rng.round(daily * (shares.get(h.hour) ?? 0) * rng.jitter(0.12));
        const out = h.hour === hours[hours.length - 1].hour ? ff + rng.int(2, 8) : Math.max(0, rng.round(ff * rng.between(0.9, 1.0)));
        const unique = Math.round(ff * rng.between(0.95, 0.99));
        const groupPeople = Math.round(ff * rng.between(0.3, 0.4));
        const groups = Math.round(groupPeople / rng.between(2.2, 2.6));
        const individuals = ff - groupPeople;
        const billable = individuals + groups;
        const eRate = rng.between(0.45, 0.6);
        const engaged = Math.round(ff * eRate);
        const engagedEntities = Math.min(billable, Math.round(billable * eRate * 1.05));
        const bounced = Math.round(ff * rng.between(0.12, 0.2));
        const repeat = Math.round(unique * rng.between(0.18, 0.28));
        const tx = Math.min(engagedEntities, rng.round(billable * conv * rng.jitter(0.15)));
        // demographics
        const ages = split(ff, AGE_DIST.map((a) => a[1]), rng, 0.12);
        const m: Record<string, number> = { male: 0, female: 0, genderUnknown: 0, ageUnknown: ages[ages.length - 1] };
        AGE_KEYS.forEach((k, i) => {
          const [male, female, unk] = split(ages[i], [0.46, 0.5, 0.04], rng, 0.1);
          m['age_' + k] = ages[i];
          m['male_' + k] = male;
          m['female_' + k] = female;
          m.male += male;
          m.female += female;
          m.genderUnknown += unk;
        });
        const [um, uf, uu] = split(m.ageUnknown, [0.4, 0.4, 0.2], rng, 0.1);
        m.male += um;
        m.female += uf;
        m.genderUnknown += uu;
        // POS
        let revenue = 0;
        let items = 0;
        for (let i = 0; i < tx; i++) {
          const amount = amountFor(rng, atv);
          const itemsCount = Math.max(1, Math.round(rng.normal(2.3, 1.1)));
          const minute = h.startMin + rng.between(0, h.endMin - h.startMin);
          const ts = new Date(zonedToUtc(date, '00:00', st.tz).getTime() + minute * 60000 + rng.int(0, 59) * 1000);
          seq++;
          posRows.push({ storeId: st.id, billNo: `${def.short}-${date.replace(/-/g, '')}-${String(seq).padStart(4, '0')}`, ts, date, hour: h.hour, amount, itemsCount, staffCode: rng.pick(cashiers), source: 'POS' });
          revenue += amount;
          items += itemsCount;
        }
        txDay += tx;
        // queue (2 counters, one snapshot per minute each)
        const samples = Math.round(120 * h.frac);
        const avgQ = clamp(tx * 0.085 * rng.jitter(0.25), 0, 14);
        const maxQ = Math.round(avgQ * rng.between(1.7, 2.3) + 1);
        const avgWait = avgQ * rng.between(45, 65);
        const maxWait = maxQ * rng.between(50, 70);
        const breaches = maxQ > 6 || maxWait > 300 ? Math.round(samples * clamp((avgQ - 2.5) / 9, 0.02, 0.4)) : 0;
        const unattended = rng.chance(0.07) ? rng.int(60, 420) : 0;
        storeRows.push({
          storeId: st.id, date, hour: h.hour, footfallIn: ff, footfallOut: out, uniqueVisitors: unique,
          staffEntries: h === hours[0] ? staffN : h.hour === 14 ? 2 : 0,
          individuals, groups, billableEntities: billable, engaged, engagedEntities, bounced, repeatVisitors: repeat, ...m,
          totalDwellSec: Math.round(out * avgDwellMin * 60 * rng.jitter(0.1)), dwellCount: out,
          transactions: tx, revenue: r2(revenue), itemsSold: items,
          avgQueueLength: r2(avgQ), maxQueueLength: maxQ, avgWaitSec: r2(avgWait), maxWaitSec: Math.round(maxWait), queueSamples: samples, queueBreaches: breaches, unattendedSec: unattended,
          staffPresentAvg: r2(staffN * (h === hours[0] ? 0.8 : rng.between(0.78, 1))),
        } as Partial<HourlyStoreMetric>);
        // sections
        for (const s of st.sections) {
          const visits = rng.round(ff * 0.33 * s.def.weight * rng.jitter(0.2));
          sectionDay.set(s.zone.id, (sectionDay.get(s.zone.id) ?? 0) + visits);
          if (!visits) continue;
          const zr: Partial<HourlyZoneMetric> = {
            storeId: st.id, zoneId: s.zone.id, date, hour: h.hour, visits, uniqueVisitors: Math.round(visits * 0.93),
            totalDwellSec: Math.round(visits * s.def.dwell * (weekend ? 1.1 : 1) * rng.jitter(0.15)), dwellCount: visits,
            engaged: Math.min(visits, Math.round(visits * s.def.engagedRate * rng.jitter(0.1))),
            female: Math.round(visits * s.def.femaleShare * 0.96), male: Math.round(visits * (1 - s.def.femaleShare) * 0.96),
          };
          zr.bounced = visits - zr.engaged;
          const zAges = split(visits, AGE_DIST.map((a) => a[1]), rng, 0.2);
          AGE_KEYS.forEach((k, i) => ((zr as Record<string, number>)['age_' + k] = zAges[i]));
          zoneRows.push(zr);
        }
        st.queues.forEach((q, qi) => {
          const share = qi === 0 ? 1.2 : 0.8;
          const qSamples = Math.round(samples / 2);
          zoneRows.push({
            storeId: st.id, zoneId: q.id, date, hour: h.hour, queueSamples: qSamples, avgQueueLength: r2(avgQ * share), maxQueueLength: Math.max(0, Math.round(maxQ * share)),
            avgWaitSec: r2(avgWait * share), maxWaitSec: Math.round(maxWait * share), queueBreaches: qi === 0 ? Math.ceil(breaches * 0.7) : Math.floor(breaches * 0.3),
            unattendedSec: qi === 1 ? unattended : 0, visits: Math.round(tx * (qi === 0 ? 0.6 : 0.4)),
          });
        });
      }
      // journey for the day
      for (const s of st.sections) {
        const v = sectionDay.get(s.zone.id) ?? 0;
        if (v > 0) transRows.push({ storeId: st.id, date, fromZoneId: 0, toZoneId: s.zone.id, count: Math.round(v * 0.55) });
        const otherW = totalW - s.def.weight;
        for (const t of st.sections) {
          if (t === s) continue;
          const c = Math.round(v * 0.35 * (t.def.weight / otherW) * rng.jitter(0.25));
          if (c > 0) transRows.push({ storeId: st.id, date, fromZoneId: s.zone.id, toZoneId: t.zone.id, count: c });
        }
        st.queues.forEach((q, qi) => {
          const c = Math.round(txDay * (s.def.weight / totalW) * (qi === 0 ? 0.6 : 0.4));
          if (c > 0) transRows.push({ storeId: st.id, date, fromZoneId: s.zone.id, toZoneId: q.id, count: c });
        });
      }
    }
    await ds.transaction(async (em: EntityManager) => {
      await bulkInsert(em, HourlyStoreMetric, storeRows);
      await bulkInsert(em, HourlyZoneMetric, zoneRows);
      await bulkInsert(em, ZoneTransition, transRows);
      await bulkInsert(em, PosTransaction, posRows);
    });
    posTotal += posRows.length;
    log(`  ${def.code}: ${storeRows.length} hourly rows, ${zoneRows.length} zone rows, ${posRows.length} POS bills`);
  }
  return posTotal;
}

/** A pool of loyal visitors with closed visits in the last 30 days (enables repeat detection today). */
export async function seedLoyalVisits(ds: DataSource, stores: SeedStore[], today: string, rng: Rng): Promise<Map<number, string[]>> {
  const pools = new Map<number, string[]>();
  const rows: Partial<Visit>[] = [];
  for (const st of stores) {
    const ids: string[] = [];
    for (let i = 0; i < 300; i++) {
      const vid = `loyal-${st.def.short}-${String(i).padStart(4, '0')}`;
      ids.push(vid);
      const n = rng.int(1, 3);
      for (let k = 0; k < n; k++) {
        const date = addDays(today, -rng.int(1, 29));
        const entry = zonedToUtc(date, `${rng.int(11, 20)}:${String(rng.int(0, 59)).padStart(2, '0')}`, st.tz);
        const dwell = rng.int(240, 1500);
        rows.push({
          storeId: st.id, visitorId: vid, trackId: `h${i}`, entryTs: entry, exitTs: new Date(entry.getTime() + dwell * 1000), date,
          hour: Number(new Intl.DateTimeFormat('en-GB', { timeZone: st.tz, hour: '2-digit', hourCycle: 'h23' }).format(entry)),
          dwellSec: dwell, isStaff: false, groupId: null, gender: rng.pick(['M', 'F']), ageBand: rng.pick(['18-24', '25-34', '35-44']),
          engaged: dwell >= 300, zoneEngaged: false, bounced: false, isRepeat: k > 0, maxZoneDwellSec: 0, autoClosed: false,
        });
      }
    }
    pools.set(st.id, ids);
  }
  await ds.transaction((em) => bulkInsert(em, Visit, rows));
  return pools;
}

/** Heatmap frames per camera / hour for the last `days` days (gaussian blobs around zone centres). */
export async function seedHeatmaps(ds: DataSource, stores: SeedStore[], today: string, nowHourLocal: number, days: number, rng: Rng) {
  const W = 32;
  const H = 18;
  const blob = (grid: number[], cx: number, cy: number, amp: number, sigma: number) => {
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const dx = x - cx * (W - 1);
        const dy = y - cy * (H - 1);
        grid[y * W + x] += amp * Math.exp(-(dx * dx + dy * dy) / (2 * sigma * sigma));
      }
  };
  let count = 0;
  for (const st of stores) {
    const rows: Partial<HeatmapFrame>[] = [];
    const shares = hourShares(st.def);
    for (let d = days - 1; d >= 0; d--) {
      const date = addDays(today, -d);
      const daily = baseDailyFootfall(st.def) * dayFactor(date);
      for (const h of openHours(st.def)) {
        if (d === 0 && h.hour > nowHourLocal) continue;
        const traffic = daily * (shares.get(h.hour) ?? 0);
        const cams: [Camera, [number, number, number][]][] = [
          [st.entrance, [[0.5, 0.78, 1.0], [0.5, 0.45, 0.6]]],
          [st.billing, [[0.3, 0.5, 0.8], [0.7, 0.5, 0.55]]],
          ...st.floors.map((cam, ci): [Camera, [number, number, number][]] => [cam, st.sections.filter((s) => s.def.cam === ci).map((s) => [s.def.center[0], s.def.center[1], s.def.weight])]),
        ];
        for (const [cam, blobs] of cams) {
          if (!cam.isActive) continue;
          const grid = new Array(W * H).fill(0);
          for (const [cx, cy, w] of blobs) blob(grid, cx + rng.between(-0.03, 0.03), cy + rng.between(-0.03, 0.03), traffic * 0.12 * w * rng.jitter(0.2), rng.between(2.2, 3.6));
          rows.push({ storeId: st.id, cameraId: cam.id, date, hour: h.hour, width: W, height: H, grid: grid.map((v) => Math.round(v + rng.between(0, 0.6))), samples: Math.round(60 * h.frac) });
        }
      }
    }
    await ds.transaction((em) => bulkInsert(em, HeatmapFrame, rows));
    count += rows.length;
  }
  return count;
}

const SOP_DETAILS = ['No greeter at entrance during peak', 'Fitting room left unattended', 'Mannequin display not refreshed', 'Staff using mobile phone on floor', 'Cash drawer left open', 'Fire exit partially blocked by cartons'];

/** STORE_OPENED/CLOSED per day with occasional late openings / early closings, plus SOP & counter events. */
export async function seedStoreOps(ds: DataSource, stores: SeedStore[], today: string, nowLocalMin: number, days: number, rng: Rng) {
  const rows: Partial<StoreOpsEvent>[] = [];
  const at = (st: SeedStore, date: string, min: number) => {
    const ts = new Date(zonedToUtc(date, '00:00', st.tz).getTime() + Math.round(min * 60) * 1000);
    return { ts, date, hour: Math.floor(min / 60) };
  };
  for (const st of stores) {
    const [oh, om] = st.def.openTime.split(':').map(Number);
    const [ch, cm] = st.def.closeTime.split(':').map(Number);
    const openMin = oh * 60 + om;
    const closeMin = ch * 60 + cm;
    for (let d = days; d >= 0; d--) {
      const date = addDays(today, -d);
      const isToday = d === 0;
      const late = rng.chance(0.08) ? rng.int(5, 40) : 0;
      const openAt = late ? openMin + late : openMin - rng.between(2, 8);
      if (!isToday || openAt <= nowLocalMin) rows.push({ storeId: st.id, type: 'STORE_OPENED', cameraId: st.entrance.id, details: late ? `Shutter opened ${late} min late` : 'Shutter opened', ...at(st, date, openAt) });
      const early = rng.chance(0.05) ? rng.int(10, 35) : 0;
      const closeAt = early ? closeMin - early : closeMin + rng.between(1, 12);
      if (!isToday) rows.push({ storeId: st.id, type: 'STORE_CLOSED', cameraId: st.entrance.id, details: early ? `Shutter closed ${early} min early` : 'Shutter closed', ...at(st, date, closeAt) });
      const add = (type: string, p: number, details: () => string, cam?: Camera) => {
        if (!rng.chance(p)) return;
        const min = rng.between(openMin + 30, closeMin - 15);
        if (isToday && min > nowLocalMin) return;
        rows.push({ storeId: st.id, type, cameraId: cam?.id ?? null, details: details(), ...at(st, date, min) });
      };
      add('SOP_BREACH', 0.28, () => rng.pick(SOP_DETAILS), rng.pick(st.floors));
      add('COUNTER_UNATTENDED', 0.4, () => `Billing counter ${rng.int(1, 2)} unattended for ${rng.int(3, 12)} min with customers waiting`, st.billing);
      add('STAFF_ABSENT', 0.08, () => `${rng.int(1, 2)} rostered staff absent at shift start`);
      add('CAMERA_TAMPER', 0.015, () => 'Camera view obstructed / moved', rng.pick(st.floors));
      if (!isToday && rng.chance(0.03)) rows.push({ storeId: st.id, type: 'LIGHTS_OFF', cameraId: st.entrance.id, details: 'Display lights left on after closing', ...at(st, date, closeMin + rng.int(20, 50)) });
    }
  }
  await ds.transaction((em) => bulkInsert(em, StoreOpsEvent, rows));
  return rows.length;
}

/** camera_status_log intervals with a few downtime windows; one camera currently OFFLINE. */
export async function seedCameraStatus(ds: DataSource, stores: SeedStore[], today: string, now: Date, days: number, rng: Rng) {
  const start = zonedToUtc(addDays(today, -days), '00:00', stores[0].tz);
  const rows: Partial<CameraStatusLog>[] = [];
  const offlineNow = stores.find((s) => s.def.short === 'ADY')?.floors[1] ?? stores[0].floors[1];
  const span = now.getTime() - start.getTime();
  for (const st of stores) {
    for (const cam of [st.entrance, ...st.floors, st.billing]) {
      const windows: [number, number][] = [];
      const n = rng.int(0, 3);
      for (let i = 0; i < n; i++) {
        const a = start.getTime() + rng.between(0.02, 0.95) * span;
        windows.push([a, a + rng.int(10, cam.id % 7 === 0 ? 360 : 180) * 60000]);
      }
      if (cam.id === offlineNow.id) windows.push([now.getTime() - 150 * 60000, Infinity]);
      windows.sort((a, b) => a[0] - b[0]);
      let t = start.getTime();
      for (const [a, b] of windows) {
        if (a <= t) continue;
        rows.push({ storeId: st.id, cameraId: cam.id, status: 'ONLINE', startedAt: new Date(t), endedAt: new Date(a), reason: null });
        rows.push({ storeId: st.id, cameraId: cam.id, status: 'OFFLINE', startedAt: new Date(a), endedAt: b === Infinity ? null : new Date(Math.min(b, now.getTime() - 60000)), reason: rng.pick(['RTSP stream timeout', 'Network switch reboot', 'Power outage', 'NVR maintenance']) });
        t = b;
      }
      if (t !== Infinity) rows.push({ storeId: st.id, cameraId: cam.id, status: 'ONLINE', startedAt: new Date(Math.min(t, now.getTime() - 60000)), endedAt: null, reason: null });
      const isOff = cam.id === offlineNow.id;
      await ds.getRepository(Camera).update(cam.id, {
        status: isOff ? 'OFFLINE' : 'ONLINE',
        lastHeartbeatAt: isOff ? new Date(now.getTime() - 150 * 60000) : new Date(now.getTime() - rng.int(5, 50) * 1000),
        fps: isOff ? null : rng.pick([12, 15, 15, 20]),
      });
    }
  }
  await ds.transaction((em) => bulkInsert(em, CameraStatusLog, rows));
  return { rows: rows.length, offlineCamera: offlineNow };
}
