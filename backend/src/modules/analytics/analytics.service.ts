import { Injectable, NotFoundException } from '@nestjs/common';
import { Between, DataSource, In, IsNull, LessThanOrEqual, MoreThanOrEqual } from 'typeorm';
import { chunks } from '../../common/bulk';
import { num, toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { daysInclusive, dowOf, eachDate, hhmm, localParts, minutesOfDay, pct, round, safeDiv, todayLocal, zonedToUtc } from '../../common/time.util';
import { Alert } from '../alerts/entities/alert.entity';
import { CameraStatusLog } from '../cameras/entities/camera-status-log.entity';
import { Camera } from '../cameras/entities/camera.entity';
import { ChecklistSubmission } from '../checklists/entities/checklist-submission.entity';
import { HeatmapFrame } from '../ingest/entities/heatmap-frame.entity';
import { QueueSnapshot } from '../ingest/entities/queue-snapshot.entity';
import { StoreOpsEvent } from '../ingest/entities/storeops-event.entity';
import { VisitorEvent } from '../ingest/entities/visitor-event.entity';
import { PosTransaction } from '../pos/entities/pos-transaction.entity';
import { Store } from '../stores/entities/store.entity';
import { Zone } from '../zones/entities/zone.entity';
import { previousRange, Range } from './analytics.query';
import { AGE_BANDS, AGE_KEYS, HourlyStoreMetric } from './entities/hourly-store-metric.entity';
import { HourlyZoneMetric } from './entities/hourly-zone-metric.entity';
import { ZoneTransition } from './entities/zone-transition.entity';

type M = HourlyStoreMetric;
/** value null = undefined ratio (zero denominator) — shown as "--", never 0/NaN/Infinity. */
export interface Kpi {
  value: number | null;
  previous?: number | null;
  changePct?: number | null;
}
/** Percentage, or null when the denominator is 0 (API_CONTRACT: ratios of nothing are null). */
export const pctN = (a: number, b: number, dp = 2): number | null => (b > 0 ? pct(a, b, dp) : null);
export const divN = (a: number, b: number, dp = 2): number | null => (b > 0 ? safeDiv(a, b, dp) : null);

const SUM_KEYS = [
  'footfallIn', 'footfallOut', 'uniqueVisitors', 'staffEntries', 'individuals', 'groups', 'billableEntities', 'engaged',
  'engagedEntities', 'bounced', 'repeatVisitors', 'male', 'female', 'genderUnknown', 'totalDwellSec', 'dwellCount',
  'transactions', 'revenue', 'itemsSold', 'queueSamples', 'queueBreaches', 'unattendedSec',
  ...AGE_KEYS.map((k) => 'age_' + k), 'ageUnknown', ...AGE_KEYS.map((k) => 'male_' + k), ...AGE_KEYS.map((k) => 'female_' + k),
] as const;
type Sums = Record<string, number> & { queueLenWeighted: number; waitWeighted: number; maxQueueLength: number; maxWaitSec: number };

export function sumRows(rows: M[]): Sums {
  const s = { queueLenWeighted: 0, waitWeighted: 0, maxQueueLength: 0, maxWaitSec: 0 } as Sums;
  for (const k of SUM_KEYS) s[k] = 0;
  for (const r of rows) {
    for (const k of SUM_KEYS) s[k] += num((r as unknown as Record<string, unknown>)[k]);
    s.queueLenWeighted += num(r.avgQueueLength) * num(r.queueSamples);
    s.waitWeighted += num(r.avgWaitSec) * num(r.queueSamples);
    s.maxQueueLength = Math.max(s.maxQueueLength, num(r.maxQueueLength));
    s.maxWaitSec = Math.max(s.maxWaitSec, num(r.maxWaitSec));
  }
  s.revenue = round(s.revenue, 2);
  return s;
}

const emptyHighlights = () => ({ highestFootfall: null as null, highestImpression: null as null, highestBounced: null as null, highestEngaged: null as null, highestDwell: null as null });
const kpi = (value: number | null, previous?: number | null): Kpi => {
  if (previous === undefined) return { value };
  if (value === null || previous === null) return { value, previous, changePct: null };
  const changePct = previous === 0 ? (value === 0 ? 0 : 100) : round(((value - previous) / previous) * 100, 2);
  return { value, previous, changePct };
};
export const dominantAge = (a: Record<string, number>): string | null => {
  let best: string | null = null;
  let max = 0;
  AGE_KEYS.forEach((k, i) => {
    const v = a['age_' + k] ?? 0;
    if (v > max) {
      max = v;
      best = AGE_BANDS[i];
    }
  });
  return best;
};
const missed = (s: Sums) => Math.max(0, s.engagedEntities - s.transactions);
const groupBy = <T, K>(arr: T[], key: (t: T) => K) => {
  const m = new Map<K, T[]>();
  for (const a of arr) {
    const k = key(a);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(a);
  }
  return m;
};

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly ds: DataSource,
    private readonly lookup: LookupService,
  ) {}

  // ---------------------------------------------------------------- loaders
  /**
   * Hourly store rollups for a range. Read as raw rows (no entity hydration): a 90-day × 6-store range is
   * ~13k rows × 60 columns and hydrating entities was ~60 % of every analytics call (QA §9 perf).
   * Numeric columns may arrive as strings on SQL Server (decimal) — every consumer goes through num().
   */
  async storeRows(ids: number[], r: Range): Promise<M[]> {
    if (!ids.length) return [];
    const qb = this.ds.getRepository(HourlyStoreMetric).createQueryBuilder('h').select([]);
    for (const c of this.ds.getMetadata(HourlyStoreMetric).columns) qb.addSelect(`h.${c.propertyName}`, c.propertyName);
    const rows: Record<string, unknown>[] = await qb
      .where('h.storeId IN (:...ids)', { ids })
      .andWhere('h.date >= :from AND h.date <= :to', { from: r.from, to: r.to })
      .getRawMany();
    for (const x of rows) {
      x.storeId = num(x.storeId);
      x.hour = num(x.hour);
      x.date = String(x.date);
    }
    return rows as unknown as M[];
  }

  async zoneRows(ids: number[], r: Range) {
    if (!ids.length) return [];
    const rows: Record<string, unknown>[] = await this.ds
      .getRepository(HourlyZoneMetric)
      .createQueryBuilder('z')
      .select('z.zoneId', 'zoneId')
      .addSelect('z.storeId', 'storeId')
      .addSelect('SUM(z.visits)', 'visits')
      .addSelect('SUM(z.uniqueVisitors)', 'uniqueVisitors')
      .addSelect('SUM(z.totalDwellSec)', 'totalDwellSec')
      .addSelect('SUM(z.dwellCount)', 'dwellCount')
      .addSelect('SUM(z.engaged)', 'engaged')
      .addSelect('SUM(z.male)', 'male')
      .addSelect('SUM(z.female)', 'female')
      .addSelect('SUM(z.bounced)', 'bounced')
      .addSelect('SUM(z.age_0_17)', 'age_0_17')
      .addSelect('SUM(z.age_18_24)', 'age_18_24')
      .addSelect('SUM(z.age_25_34)', 'age_25_34')
      .addSelect('SUM(z.age_35_44)', 'age_35_44')
      .addSelect('SUM(z.age_45_54)', 'age_45_54')
      .addSelect('SUM(z.age_55_plus)', 'age_55_plus')
      .addSelect('SUM(z.queueSamples)', 'queueSamples')
      .addSelect('SUM(z.avgQueueLength * z.queueSamples)', 'qlw')
      .addSelect('MAX(z.maxQueueLength)', 'maxQueueLength')
      .addSelect('SUM(z.avgWaitSec * z.queueSamples)', 'waitw')
      .addSelect('SUM(z.queueBreaches)', 'queueBreaches')
      .where('z.storeId IN (:...ids)', { ids })
      .andWhere('z.date >= :from AND z.date <= :to', r)
      .groupBy('z.zoneId')
      .addGroupBy('z.storeId')
      .getRawMany();
    return rows.map((x) => {
      const o: Record<string, number> = {};
      for (const [k, v] of Object.entries(x)) o[k] = num(v);
      return o;
    });
  }

  private async complianceByStore(ids: number[], r: Range): Promise<Map<number, number>> {
    const m = new Map<number, number>();
    if (!ids.length) return m;
    const rows: { storeId: unknown; avg: unknown }[] = await this.ds
      .getRepository(ChecklistSubmission)
      .createQueryBuilder('s')
      .select('s.storeId', 'storeId')
      .addSelect('AVG(s.scorePct)', 'avg')
      .where('s.storeId IN (:...ids)', { ids })
      .andWhere('s.date >= :from AND s.date <= :to', r)
      .groupBy('s.storeId')
      .getRawMany();
    for (const x of rows) m.set(num(x.storeId), round(num(x.avg), 2));
    return m;
  }

  private async complianceScore(ids: number[], r: Range): Promise<number> {
    if (!ids.length) return 0;
    const x = await this.ds
      .getRepository(ChecklistSubmission)
      .createQueryBuilder('s')
      .select('AVG(s.scorePct)', 'avg')
      .where('s.storeId IN (:...ids)', { ids })
      .andWhere('s.date >= :from AND s.date <= :to', r)
      .getRawOne<{ avg: unknown }>();
    return round(num(x?.avg), 2);
  }

  /** People who crossed the street-side "Pass-by" line (edge PASS_BY events, staff excluded). */
  async passBy(ids: number[], r: Range): Promise<number> {
    if (!ids.length) return 0;
    return this.ds.getRepository(VisitorEvent).count({ where: { storeId: In(ids), type: 'PASS_BY', isStaff: false, date: Between(r.from, r.to) } });
  }

  /** Latest manual-count audit per store (edge COUNT_AUDIT store-ops events; details is JSON). */
  async countAudits(ids: number[]): Promise<Map<number, { accuracyInPct: number | null; accuracyOutPct: number | null; manualIn: number | null; engineIn: number | null; at: string | null; camera: string | null }>> {
    const out = new Map();
    if (!ids.length) return out;
    const rows = await this.ds.getRepository(StoreOpsEvent).find({ where: { storeId: In(ids), type: 'COUNT_AUDIT' }, order: { ts: 'DESC' }, take: 500 });
    for (const e of rows) {
      if (out.has(e.storeId)) continue;
      let d: Record<string, unknown> = {};
      try { d = JSON.parse(e.details ?? '{}'); } catch { /* free text: no figures */ }
      const n = (v: unknown) => (typeof v === 'number' && isFinite(v) ? v : null);
      out.set(e.storeId, { accuracyInPct: n(d.accuracyIn), accuracyOutPct: n(d.accuracyOut), manualIn: n(d.manualIn), engineIn: n(d.engineIn), at: toIso(e.ts), camera: typeof d.camera === 'string' ? d.camera : null });
    }
    return out;
  }

  // ---------------------------------------------------------------- overview
  private async kpiValues(ids: number[], r: Range, preloaded?: M[]) {
    const s = sumRows(preloaded ?? (await this.storeRows(ids, r)));
    return {
      footfall: s.footfallIn,
      uniqueVisitors: s.uniqueVisitors,
      billableEntities: s.billableEntities,
      transactions: s.transactions,
      conversionPct: pctN(s.transactions, s.billableEntities),
      revenue: s.revenue,
      atv: divN(s.revenue, s.transactions),
      avgDwellSec: safeDiv(s.totalDwellSec, s.dwellCount, 1),
      engagedPct: pctN(s.engaged, s.footfallIn),
      bounceRatePct: pctN(s.bounced, s.footfallIn),
      missedOpportunities: missed(s),
      avgQueueWaitSec: safeDiv(s.waitWeighted, s.queueSamples, 1),
      complianceScore: await this.complianceScore(ids, r),
    };
  }

  async overview(ids: number[], r: Range, compare: boolean) {
    const rows = await this.storeRows(ids, r);
    const cur = await this.kpiValues(ids, r, rows);
    const prev = compare ? await this.kpiValues(ids, previousRange(r)) : null;
    const kpis: Record<string, Kpi> = {};
    for (const [k, v] of Object.entries(cur)) kpis[k] = kpi(v, prev ? prev[k as keyof typeof prev] : undefined);
    const passBy = await this.passBy(ids, r);
    kpis.passBy = { value: passBy };
    kpis.captureRatePct = { value: passBy ? round((cur.footfall / passBy) * 100, 1) : null };
    kpis.openAlerts = { value: ids.length ? await this.ds.getRepository(Alert).count({ where: { storeId: In(ids), status: 'OPEN' } }) : 0 };
    const byDate = groupBy(rows, (x) => x.date);
    const today = await this.todayOf(ids);
    const daily = eachDate(r.from, r.to).map((date) => {
      const s = sumRows(byDate.get(date) ?? []);
      return { date, footfall: s.footfallIn, transactions: s.transactions, conversionPct: pctN(s.transactions, s.billableEntities), revenue: s.revenue, isPartial: date === today, hasData: byDate.has(date) };
    });
    return { kpis, daily };
  }

  // ---------------------------------------------------------------- traffic
  /** Store-local "today" of the stores in the request (several time zones → the latest local date). */
  private async todayOf(ids: number[]): Promise<string> {
    const stores = ids.length ? await this.lookup.stores(ids) : new Map<number, Store>();
    const dates = [...stores.values()].map((s) => todayLocal(s.timezone));
    return dates.length ? dates.sort()[dates.length - 1] : todayLocal();
  }

  async traffic(ids: number[], r: Range) {
    const rows = await this.storeRows(ids, r);
    const s = sumRows(rows);
    const days = daysInclusive(r.from, r.to);
    const byDate = groupBy(rows, (x) => x.date);
    const today = await this.todayOf(ids);
    // isPartial: today's point is "so far" (the UI labels it); hasData: false = no rollup at all for that day
    // (no edge data yet / edge offline) so a chart can show a gap instead of a false 0
    const daily = eachDate(r.from, r.to).map((date) => {
      const d = sumRows(byDate.get(date) ?? []);
      return {
        date, footfallIn: d.footfallIn, footfallOut: d.footfallOut, uniqueVisitors: d.uniqueVisitors, billableEntities: d.billableEntities, engaged: d.engaged, bounced: d.bounced,
        isPartial: date === today, hasData: byDate.has(date),
      };
    });
    const hourlyTotals = new Array(24).fill(0);
    const hourlyBounced = new Array(24).fill(0);
    for (const x of rows) {
      hourlyTotals[x.hour] += num(x.footfallIn);
      hourlyBounced[x.hour] += num(x.bounced);
    }
    const hourly = hourlyTotals.map((footfall, hour) => ({ hour, footfall, avgPerDay: round(footfall / days, 2), bouncedPct: pctN(hourlyBounced[hour], footfall) }));
    let peakHour = 0;
    hourlyTotals.forEach((v, h) => {
      if (v > hourlyTotals[peakHour]) peakHour = h;
    });
    const dowCount = new Array(7).fill(0);
    for (const d of eachDate(r.from, r.to)) dowCount[dowOf(d)]++;
    const dowTotals = new Array(7).fill(0);
    for (const x of rows) dowTotals[dowOf(x.date)] += num(x.footfallIn);
    const dayOfWeek = dowTotals.map((footfall, dow) => ({ dow, footfall, avgPerDay: dowCount[dow] ? round(footfall / dowCount[dow], 2) : 0 }));
    const passBy = await this.passBy(ids, r);
    return {
      totals: {
        footfallIn: s.footfallIn,
        passBy,
        captureRatePct: passBy ? round((s.footfallIn / passBy) * 100, 1) : null,
        footfallOut: s.footfallOut,
        uniqueVisitors: s.uniqueVisitors,
        staffExcluded: s.staffEntries,
        individuals: s.individuals,
        groups: s.groups,
        billableEntities: s.billableEntities,
        engaged: s.engaged,
        casual: Math.max(0, s.footfallIn - s.engaged),
        bounced: s.bounced,
        repeatVisitors: s.repeatVisitors,
        newVisitors: Math.max(0, s.uniqueVisitors - s.repeatVisitors),
        avgDwellSec: safeDiv(s.totalDwellSec, s.dwellCount, 1),
      },
      daily,
      hourly,
      peakHour,
      dayOfWeek,
    };
  }

  // ---------------------------------------------------------------- demographics
  async demographics(ids: number[], r: Range) {
    const s = sumRows(await this.storeRows(ids, r));
    const age: { band: string; count: number }[] = AGE_BANDS.map((band, i) => ({ band, count: s['age_' + AGE_KEYS[i]] }));
    age.push({ band: 'U', count: s.ageUnknown });
    return {
      gender: { male: s.male, female: s.female, unknown: s.genderUnknown },
      age,
      genderByAge: AGE_BANDS.map((band, i) => ({ band, male: s['male_' + AGE_KEYS[i]], female: s['female_' + AGE_KEYS[i]] })),
    };
  }

  // ---------------------------------------------------------------- zones
  async zones(ids: number[], r: Range) {
    if (!ids.length) return [];
    const zones = await this.ds.getRepository(Zone).find({ where: { storeId: In(ids), type: 'SECTION' }, order: { storeId: 'ASC', id: 'ASC' } });
    const agg = new Map((await this.zoneRows(ids, r)).map((x) => [x.zoneId, x]));
    const names = await this.lookup.storeNames(ids);
    const footfallByStore = new Map<number, number>();
    for (const x of await this.storeRows(ids, r)) footfallByStore.set(x.storeId, (footfallByStore.get(x.storeId) ?? 0) + num(x.footfallIn));
    const list = zones
      .filter((z) => z.isActive || agg.has(z.id))
      .map((z) => {
        const a = agg.get(z.id) ?? ({} as Record<string, number>);
        const visits = a.visits ?? 0;
        return {
          id: z.id,
          storeId: z.storeId,
          storeName: names.get(z.storeId) ?? '',
          name: z.name,
          type: z.type,
          visits,
          uniqueVisitors: a.uniqueVisitors ?? 0,
          avgDwellSec: safeDiv(a.totalDwellSec ?? 0, a.dwellCount ?? 0, 1),
          engaged: a.engaged ?? 0,
          engagedPct: pctN(a.engaged ?? 0, visits),
          male: a.male ?? 0,
          female: a.female ?? 0,
          classification: 'WARM' as 'HOT' | 'WARM' | 'DEAD',
          bouncedPct: pctN(a.bounced ?? 0, visits),
          concentrationPct: pctN(a.engaged ?? 0, footfallByStore.get(z.storeId) ?? 0),
          dominantAgeBand: dominantAge(a),
          genderSplit: { malePct: pct(a.male ?? 0, (a.male ?? 0) + (a.female ?? 0)), femalePct: pct(a.female ?? 0, (a.male ?? 0) + (a.female ?? 0)) },
        };
      });
    for (const [, zs] of groupBy(list, (z) => z.storeId)) {
      const avg = zs.reduce((a, z) => a + z.visits, 0) / zs.length;
      for (const z of zs) z.classification = z.visits >= 1.25 * avg && avg > 0 ? 'HOT' : z.visits <= 0.5 * avg || avg === 0 ? 'DEAD' : 'WARM';
    }
    return list;
  }

  // ---------------------------------------------------------------- heatmap
  async heatmap(storeId: number, cameraId: number | undefined, r: Range) {
    let camId = cameraId;
    if (!camId) {
      const cams = await this.ds.getRepository(Camera).find({ where: { storeId }, order: { id: 'ASC' } });
      camId = (cams.find((c) => c.type === 'ZONE' && c.isActive) ?? cams.find((c) => c.isActive) ?? cams[0])?.id;
      // a store without cameras (new store) gets an empty grid, not an error
      if (!camId) return { cameraId: null as number | null, width: 32, height: 18, grid: new Array(32 * 18).fill(0), max: 0 };
    }
    const frames = await this.ds.getRepository(HeatmapFrame).find({ where: { cameraId: camId, date: Between(r.from, r.to) } });
    let width = 32;
    let height = 18;
    if (frames.length) {
      width = frames[0].width;
      height = frames[0].height;
    }
    const grid = new Array(width * height).fill(0);
    for (const f of frames) {
      if (f.width !== width || f.height !== height) continue;
      for (let i = 0; i < grid.length; i++) grid[i] += num(f.grid[i]);
    }
    const rounded = grid.map((v) => round(v, 2));
    return { cameraId: camId, width, height, grid: rounded, max: rounded.reduce((a, b) => Math.max(a, b), 0) };
  }

  // ---------------------------------------------------------------- journey
  /** Journey for one or several stores (zones merged by name; node id = lowest zone id of that name). */
  async journey(storeIds: number | number[], r: Range) {
    const ids = Array.isArray(storeIds) ? storeIds : [storeIds];
    if (!ids.length) return { nodes: [{ id: 0, name: 'Entrance' }], links: [], totalFootfall: 0, highlights: emptyHighlights() };
    const zones = await this.ds.getRepository(Zone).find({ where: { storeId: In(ids) }, order: { id: 'ASC' } });
    const canon = new Map<string, number>();
    for (const z of zones) if (!canon.has(z.name)) canon.set(z.name, z.id);
    const mapId = new Map(zones.map((z) => [z.id, canon.get(z.name)]));
    mapId.set(0, 0);
    const rows: { fromZoneId: unknown; toZoneId: unknown; c: unknown }[] = await this.ds
      .getRepository(ZoneTransition)
      .createQueryBuilder('t')
      .select('t.fromZoneId', 'fromZoneId')
      .addSelect('t.toZoneId', 'toZoneId')
      .addSelect('SUM(t.count)', 'c')
      .where('t.storeId IN (:...ids)', { ids })
      .andWhere('t.date >= :from AND t.date <= :to', r)
      .groupBy('t.fromZoneId')
      .addGroupBy('t.toZoneId')
      .getRawMany();
    const merged = new Map<string, number>();
    for (const x of rows) {
      const s = mapId.get(num(x.fromZoneId)) ?? num(x.fromZoneId);
      const t = mapId.get(num(x.toZoneId)) ?? num(x.toZoneId);
      if (s === t) continue;
      merged.set(`${s}>${t}`, (merged.get(`${s}>${t}`) ?? 0) + num(x.c));
    }
    const links = [...merged]
      .map(([k, count]) => {
        const [source, target] = k.split('>').map(Number);
        return { source, target, count };
      })
      .filter((l) => l.count > 0)
      .sort((a, b) => b.count - a.count || a.source - b.source || a.target - b.target);
    const used = new Set(links.flatMap((l) => [l.source, l.target]));
    const nodes = [{ id: 0, name: 'Entrance' }];
    for (const z of zones) {
      const id = canon.get(z.name);
      if (id !== z.id) continue;
      if (zones.some((y) => y.name === z.name && y.type === 'SECTION' && y.isActive) || used.has(id)) nodes.push({ id, name: z.name });
    }
    const totalFootfall = sumRows(await this.storeRows(ids, r)).footfallIn;
    // highlights over SECTION zones merged by name
    const agg = await this.zoneRows(ids, r);
    const byName = new Map<string, Record<string, number>>();
    for (const z of zones.filter((x) => x.type === 'SECTION')) {
      const a = agg.find((x) => x.zoneId === z.id);
      const cur = byName.get(z.name) ?? { visits: 0, uniqueVisitors: 0, engaged: 0, bounced: 0, totalDwellSec: 0, dwellCount: 0 };
      for (const k of Object.keys(cur)) cur[k] += a?.[k] ?? 0;
      byName.set(z.name, cur);
    }
    const stats = [...byName].map(([zoneName, a]) => ({
      zoneName,
      visits: a.visits,
      impressionPct: pct(a.uniqueVisitors, totalFootfall),
      bouncedPct: pct(a.bounced, a.visits),
      engagedPct: pct(a.engaged, a.visits),
      avgDwellSec: safeDiv(a.totalDwellSec, a.dwellCount, 1),
    }));
    const top = (key: keyof (typeof stats)[number], label: (v: number) => string) => {
      const best = stats.filter((s) => s.visits > 0).sort((a, b) => (b[key] as number) - (a[key] as number) || a.zoneName.localeCompare(b.zoneName))[0];
      return best ? { zoneName: best.zoneName, value: best[key] as number, label: label(best[key] as number) } : null;
    };
    return {
      nodes,
      links,
      totalFootfall,
      highlights: {
        highestFootfall: top('visits', (v) => `${v.toLocaleString('en-IN')} visits`),
        highestImpression: top('impressionPct', (v) => `${v}% of footfall`),
        highestBounced: top('bouncedPct', (v) => `${v}% bounced`),
        highestEngaged: top('engagedPct', (v) => `${v}% engaged`),
        highestDwell: top('avgDwellSec', (v) => `${Math.round(v)} s avg dwell`),
      },
    };
  }

  // ---------------------------------------------------------------- traffic density
  async trafficDensity(ids: number[], r: Range) {
    const rows = await this.storeRows(ids, r);
    const stores = ids.length ? await this.ds.getRepository(Store).find({ where: { id: In(ids) } }) : [];
    let minH = 24;
    let maxH = -1;
    for (const s of stores) {
      minH = Math.min(minH, Math.floor(minutesOfDay(s.openTime) / 60));
      maxH = Math.max(maxH, Math.ceil(minutesOfDay(s.closeTime) / 60) - 1);
    }
    if (maxH < minH) {
      minH = 10;
      maxH = 21;
    }
    const hours = Array.from({ length: maxH - minH + 1 }, (_, i) => minH + i);
    const dowCount = new Array(7).fill(0);
    for (const d of eachDate(r.from, r.to)) dowCount[dowOf(d)]++;
    const sums = new Map<string, number>();
    for (const x of rows) {
      const k = `${dowOf(x.date)}|${x.hour}`;
      sums.set(k, (sums.get(k) ?? 0) + num(x.footfallIn));
    }
    const cells: { dow: number; hour: number; avgFootfall: number }[] = [];
    for (let dow = 0; dow < 7; dow++) for (const hour of hours) cells.push({ dow, hour, avgFootfall: dowCount[dow] ? round((sums.get(`${dow}|${hour}`) ?? 0) / dowCount[dow], 2) : 0 });
    return { cells, max: cells.reduce((a, c) => Math.max(a, c.avgFootfall), 0), hours };
  }

  // ---------------------------------------------------------------- conversion
  async conversion(ids: number[], r: Range) {
    const rows = await this.storeRows(ids, r);
    const s = sumRows(rows);
    const byDate = groupBy(rows, (x) => x.date);
    const daily = eachDate(r.from, r.to).map((date) => {
      const d = sumRows(byDate.get(date) ?? []);
      return { date, billableEntities: d.billableEntities, transactions: d.transactions, conversionPct: pctN(d.transactions, d.billableEntities), revenue: d.revenue, atv: divN(d.revenue, d.transactions) };
    });
    const byHour = groupBy(rows, (x) => x.hour);
    const hourly = [...byHour.keys()]
      .sort((a, b) => a - b)
      .map((hour) => {
        const hr = byHour.get(hour);
        const d = sumRows(hr);
        return {
          hour,
          billableEntities: d.billableEntities,
          transactions: d.transactions,
          conversionPct: pctN(d.transactions, d.billableEntities),
          missedOpportunities: missed(d),
          staffPresentAvg: round(hr.reduce((a, x) => a + num(x.staffPresentAvg), 0) / hr.length, 2),
          customersPerStaff: safeDiv(d.billableEntities, hr.reduce((a, x) => a + num(x.staffPresentAvg), 0)),
        };
      })
      .filter((h) => h.billableEntities > 0 || h.transactions > 0 || h.staffPresentAvg > 0);
    const stores = await this.lookup.storeNames(ids);
    const byStoreRows = groupBy(rows, (x) => x.storeId);
    const byStore = ids.map((storeId) => {
      const d = sumRows(byStoreRows.get(storeId) ?? []);
      return { storeId, storeName: stores.get(storeId) ?? '', conversionPct: pctN(d.transactions, d.billableEntities), revenue: d.revenue, atv: divN(d.revenue, d.transactions), missedOpportunities: missed(d) };
    });
    const m = missed(s);
    return {
      // monotonic conversion flow: footfall → engaged people → engaged billable entities → transactions
      funnel: { footfall: s.footfallIn, engaged: s.engaged, billableEntities: s.engagedEntities, transactions: s.transactions },
      segments: { bounced: s.bounced, missedOpportunities: m, converted: s.transactions },
      totals: { revenue: s.revenue, transactions: s.transactions, atv: divN(s.revenue, s.transactions), conversionPct: pctN(s.transactions, s.billableEntities), itemsPerBill: divN(s.itemsSold, s.transactions) },
      daily,
      hourly,
      byStore,
    };
  }

  // ---------------------------------------------------------------- queue
  async liveQueues(ids: number[]) {
    if (!ids.length) return [];
    const zones = await this.ds.getRepository(Zone).find({ where: { storeId: In(ids), type: 'QUEUE', isActive: true }, order: { storeId: 'ASC', id: 'ASC' } });
    if (!zones.length) return [];
    const latestIds: { id: unknown }[] = await this.ds
      .getRepository(QueueSnapshot)
      .createQueryBuilder('q')
      .select('MAX(q.id)', 'id')
      .where('q.zoneId IN (:...zids)', { zids: zones.map((z) => z.id) })
      .groupBy('q.zoneId')
      .getRawMany();
    const snaps = latestIds.length ? await this.ds.getRepository(QueueSnapshot).find({ where: { id: In(latestIds.map((x) => num(x.id))) } }) : [];
    const byZone = new Map(snaps.map((s) => [s.zoneId, s]));
    return zones.map((z) => {
      const s = byZone.get(z.id);
      return { zoneId: z.id, storeId: z.storeId, name: z.name, queueLength: s?.queueLength ?? 0, avgWaitSec: round(s?.avgWaitSec ?? 0, 1), counterStaffed: s ? s.counterStaffed : false, ts: toIso(s?.ts) };
    });
  }

  async queue(ids: number[], r: Range) {
    const rows = await this.storeRows(ids, r);
    const s = sumRows(rows);
    const byHour = groupBy(rows.filter((x) => num(x.queueSamples) > 0), (x) => x.hour);
    const hourly = [...byHour.keys()]
      .sort((a, b) => a - b)
      .map((hour) => {
        const d = sumRows(byHour.get(hour));
        return { hour, avgQueueLength: safeDiv(d.queueLenWeighted, d.queueSamples), avgWaitSec: safeDiv(d.waitWeighted, d.queueSamples, 1) };
      });
    const zones = ids.length ? await this.ds.getRepository(Zone).find({ where: { storeId: In(ids), type: 'QUEUE' }, order: { storeId: 'ASC', id: 'ASC' } }) : [];
    const agg = new Map((await this.zoneRows(ids, r)).map((x) => [x.zoneId, x]));
    const names = await this.lookup.storeNames(ids);
    const byCounter = zones
      .filter((z) => z.isActive || agg.has(z.id))
      .map((z) => {
        const a = agg.get(z.id) ?? ({} as Record<string, number>);
        return {
          zoneId: z.id,
          storeId: z.storeId,
          storeName: names.get(z.storeId) ?? '',
          name: z.name,
          avgQueueLength: safeDiv(a.qlw ?? 0, a.queueSamples ?? 0),
          maxQueueLength: a.maxQueueLength ?? 0,
          avgWaitSec: safeDiv(a.waitw ?? 0, a.queueSamples ?? 0, 1),
          breaches: a.queueBreaches ?? 0,
        };
      });
    return {
      totals: {
        avgQueueLength: safeDiv(s.queueLenWeighted, s.queueSamples),
        maxQueueLength: s.maxQueueLength,
        avgWaitSec: safeDiv(s.waitWeighted, s.queueSamples, 1),
        maxWaitSec: round(s.maxWaitSec, 1),
        breaches: s.queueBreaches,
        unattendedMinutes: round(s.unattendedSec / 60, 1),
      },
      hourly,
      byCounter,
      live: await this.liveQueues(ids),
    };
  }

  // ---------------------------------------------------------------- store ops
  private windowFor(store: Store, r: Range, now: Date) {
    const start = zonedToUtc(r.from, '00:00', store.timezone).getTime();
    const end = Math.min(zonedToUtc(r.to, '00:00', store.timezone).getTime() + 86400_000, now.getTime());
    return { start, end };
  }

  async cameraHealth(ids: number[], r: Range, now = new Date()) {
    if (!ids.length) return [];
    const cams = await this.ds.getRepository(Camera).find({ where: { storeId: In(ids), isActive: true }, order: { storeId: 'ASC', id: 'ASC' } });
    const stores = await this.lookup.stores(ids);
    const minStart = Math.min(...[...stores.values()].map((s) => this.windowFor(s, r, now).start));
    const logs: CameraStatusLog[] = [];
    // two IN lists per statement → chunks of 900 ids stay under SQL Server's 2100-parameter limit
    for (const part of chunks(cams.map((c) => c.id), 900)) {
      logs.push(
        ...(await this.ds.getRepository(CameraStatusLog).find({
          where: [
            { cameraId: In(part), status: 'OFFLINE', endedAt: IsNull() },
            { cameraId: In(part), status: 'OFFLINE', endedAt: MoreThanOrEqual(new Date(minStart)) },
          ],
        })),
      );
    }
    const byCam = groupBy(logs, (l) => l.cameraId);
    return cams.map((c) => {
      const store = stores.get(c.storeId);
      const { start, end } = this.windowFor(store, r, now);
      const span = Math.max(1, end - start);
      let down = 0;
      for (const l of byCam.get(c.id) ?? []) {
        const a = Math.max(start, l.startedAt.getTime());
        const b = Math.min(end, l.endedAt ? l.endedAt.getTime() : now.getTime());
        if (b > a) down += b - a;
      }
      return {
        cameraId: c.id,
        storeId: c.storeId,
        storeName: store?.name ?? '',
        name: c.name,
        status: c.status,
        lastHeartbeatAt: toIso(c.lastHeartbeatAt),
        uptimePct: end > start ? round(100 - (down / span) * 100, 2) : 100,
        downtimeMinutes: round(down / 60000, 1),
      };
    });
  }

  async storeops(ids: number[], r: Range, now = new Date()) {
    const stores = await this.lookup.stores(ids);
    const events = ids.length
      ? await this.ds.getRepository(StoreOpsEvent).find({ where: { storeId: In(ids), date: Between(r.from, r.to) }, order: { ts: 'DESC', id: 'DESC' } })
      : [];
    const openClose: Record<string, unknown>[] = [];
    let lateOpenings = 0;
    let earlyClosings = 0;
    const evByStoreDate = groupBy(events, (e) => `${e.storeId}|${e.date}`);
    for (const id of ids) {
      const s = stores.get(id);
      if (!s) continue;
      const today = todayLocal(s.timezone);
      for (const date of eachDate(r.from, r.to)) {
        if (date > today) continue;
        const evs = evByStoreDate.get(`${id}|${date}`) ?? [];
        const opened = evs.filter((e) => e.type === 'STORE_OPENED').sort((a, b) => a.ts.getTime() - b.ts.getTime())[0];
        const closed = evs.filter((e) => e.type === 'STORE_CLOSED').sort((a, b) => b.ts.getTime() - a.ts.getTime())[0];
        const actualOpen = opened ? hhmm(opened.ts, s.timezone) : null;
        const actualClose = closed ? hhmm(closed.ts, s.timezone) : null;
        const lateOpenMin = actualOpen ? Math.max(0, minutesOfDay(actualOpen) - minutesOfDay(s.openTime)) : 0;
        const earlyCloseMin = actualClose ? Math.max(0, minutesOfDay(s.closeTime) - minutesOfDay(actualClose)) : 0;
        if (lateOpenMin > 0) lateOpenings++;
        if (earlyCloseMin > 0) earlyClosings++;
        openClose.push({ storeId: id, storeName: s.name, date, scheduledOpen: s.openTime, actualOpen, lateOpenMin, scheduledClose: s.closeTime, actualClose, earlyCloseMin });
      }
    }
    openClose.sort((a, b) => (a.date === b.date ? (a.storeId as number) - (b.storeId as number) : a.date < b.date ? 1 : -1));
    const cameraHealth = await this.cameraHealth(ids, r, now);
    const rows = await this.storeRows(ids, r);
    const byHour = groupBy(rows.filter((x) => num(x.staffPresentAvg) > 0), (x) => x.hour);
    const staffPresence = [...byHour.keys()].sort((a, b) => a - b).map((hour) => {
      const hr = byHour.get(hour);
      return { hour, avgStaff: round(hr.reduce((a, x) => a + num(x.staffPresentAvg), 0) / hr.length, 2) };
    });
    return {
      openClose,
      totals: {
        lateOpenings,
        earlyClosings,
        sopBreaches: events.filter((e) => e.type === 'SOP_BREACH').length,
        cameraUptimePct: cameraHealth.length ? round(cameraHealth.reduce((a, c) => a + c.uptimePct, 0) / cameraHealth.length, 2) : 100,
        downtimeMinutes: round(cameraHealth.reduce((a, c) => a + c.downtimeMinutes, 0), 1),
        offlineCameras: cameraHealth.filter((c) => c.status === 'OFFLINE').length,
      },
      events: events.slice(0, 200).map((e) => ({ id: e.id, storeId: e.storeId, storeName: stores.get(e.storeId)?.name ?? '', type: e.type, ts: toIso(e.ts), cameraId: e.cameraId ?? null, details: e.details ?? null, snapshotId: e.snapshotId ?? null })),
      cameraHealth,
      staffPresence,
    };
  }

  // ---------------------------------------------------------------- benchmark
  async benchmark(ids: number[], r: Range) {
    const stores = await this.lookup.stores(ids);
    const rows = await this.storeRows(ids, r);
    const prevRows = await this.storeRows(ids, previousRange(r));
    const compliance = await this.complianceByStore(ids, r);
    const byStore = groupBy(rows, (x) => x.storeId);
    const prevByStore = groupBy(prevRows, (x) => x.storeId);
    const list = ids
      .filter((id) => stores.has(id))
      .map((id) => {
        const s = stores.get(id);
        const d = sumRows(byStore.get(id) ?? []);
        const p = sumRows(prevByStore.get(id) ?? []);
        return {
          storeId: id,
          storeName: s.name,
          regionName: s.regionName,
          format: s.format ?? 'HIGH_STREET',
          footfall: d.footfallIn,
          conversionPct: pctN(d.transactions, d.billableEntities),
          revenue: d.revenue,
          atv: divN(d.revenue, d.transactions),
          avgDwellSec: safeDiv(d.totalDwellSec, d.dwellCount, 1),
          avgQueueWaitSec: safeDiv(d.waitWeighted, d.queueSamples, 1),
          complianceScore: compliance.get(id) ?? 0,
          revenuePerSqft: s.areaSqft > 0 ? round(d.revenue / s.areaSqft, 2) : 0,
          rank: 0,
          footfallChangePct: p.footfallIn === 0 ? (d.footfallIn === 0 ? 0 : 100) : round(((d.footfallIn - p.footfallIn) / p.footfallIn) * 100, 2),
          bouncedPct: pctN(d.bounced, d.footfallIn),
          engagedPct: pctN(d.engaged, d.footfallIn),
        };
      })
      .sort((a, b) => b.revenue - a.revenue || a.storeId - b.storeId);
    list.forEach((x, i) => (x.rank = i + 1));
    return list;
  }

  /** Benchmark aggregated by region, store format or city. */
  async benchmarkGroups(ids: number[], r: Range, groupBy: string) {
    const stores = await this.lookup.stores(ids);
    const rows = await this.storeRows(ids, r);
    const keyOf = (s: Store & { regionName: string }) => (groupBy === 'format' ? s.format || 'HIGH_STREET' : groupBy === 'city' ? s.city || '' : s.regionName);
    const groups = new Map<string, { stores: Set<number>; rows: M[] }>();
    for (const id of ids) {
      const s = stores.get(id);
      if (!s) continue;
      const k = keyOf(s);
      if (!groups.has(k)) groups.set(k, { stores: new Set(), rows: [] });
      groups.get(k).stores.add(id);
    }
    for (const x of rows) {
      const s = stores.get(x.storeId);
      if (s) groups.get(keyOf(s))?.rows.push(x);
    }
    return [...groups]
      .map(([group, g]) => {
        const d = sumRows(g.rows);
        return {
          group,
          stores: g.stores.size,
          footfall: d.footfallIn,
          conversionPct: pctN(d.transactions, d.billableEntities),
          revenue: d.revenue,
          atv: divN(d.revenue, d.transactions),
          avgDwellSec: safeDiv(d.totalDwellSec, d.dwellCount, 1),
          bouncedPct: pctN(d.bounced, d.footfallIn),
          engagedPct: pctN(d.engaged, d.footfallIn),
          missedOpportunities: missed(d),
        };
      })
      .sort((a, b) => b.revenue - a.revenue || a.group.localeCompare(b.group));
  }

  // ---------------------------------------------------------------- live
  async live(storeId: number, now = new Date()) {
    const store = await this.ds.getRepository(Store).findOne({ where: { id: storeId } });
    if (!store) throw new NotFoundException('Store not found');
    const local = localParts(now, store.timezone);
    const date = local.date;
    const ev = this.ds.getRepository(VisitorEvent);
    const todayFootfall = await ev.count({ where: { storeId, date, type: 'ENTRY', isStaff: false } });
    const todayExits = await ev.count({ where: { storeId, date, type: 'EXIT', isStaff: false } });
    const lastHourFootfall = await ev.count({ where: { storeId, type: 'ENTRY', isStaff: false, ts: Between(new Date(now.getTime() - 3600_000), now) } });
    const todayTransactions = await this.ds.getRepository(PosTransaction).count({ where: { storeId, date } });
    const s = sumRows(await this.storeRows([storeId], { from: date, to: date }));
    const cameras = await this.ds.getRepository(Camera).find({ where: { storeId, isActive: true }, order: { id: 'ASC' } });
    const recent = await ev.find({ where: { storeId, ts: LessThanOrEqual(new Date(now.getTime() + 60_000)) }, order: { ts: 'DESC', id: 'DESC' }, take: 20 });
    return {
      storeId,
      asOf: now.toISOString(),
      todayFootfall,
      currentOccupancy: Math.max(0, todayFootfall - todayExits),
      lastHourFootfall,
      todayTransactions,
      todayConversionPct: pctN(todayTransactions, s.billableEntities),
      queues: await this.liveQueues([storeId]),
      cameras: cameras.map((c) => ({ id: c.id, name: c.name, status: c.status, lastHeartbeatAt: toIso(c.lastHeartbeatAt) })),
      recentEvents: recent.map((e) => ({
        id: e.id,
        cameraId: e.cameraId,
        zoneId: e.zoneId ?? null,
        type: e.type,
        ts: toIso(e.ts),
        trackId: e.trackId,
        visitorId: e.visitorId,
        isStaff: e.isStaff,
        groupId: e.groupId ?? null,
        gender: e.gender,
        ageBand: e.ageBand,
        dwellSec: e.dwellSec ?? null,
      })),
    };
  }
}

