import { Injectable, Logger } from '@nestjs/common';
import { DataSource, EntityManager, In } from 'typeorm';
import { bulkInsert } from '../../common/bulk';
import { isMssql, num, toBool, toDate } from '../../common/db-types';
import { KeyedLock } from '../../common/lock';
import { DEFAULT_TZ, round, zonedToUtc } from '../../common/time.util';
import { AGE_BANDS, AGE_KEYS, HourlyStoreMetric } from '../analytics/entities/hourly-store-metric.entity';
import { HourlyZoneMetric } from '../analytics/entities/hourly-zone-metric.entity';
import { Visit } from '../analytics/entities/visit.entity';
import { ZoneTransition } from '../analytics/entities/zone-transition.entity';
import { QueueSnapshot } from '../ingest/entities/queue-snapshot.entity';
import { VisitorEvent } from '../ingest/entities/visitor-event.entity';
import { PosTransaction } from '../pos/entities/pos-transaction.entity';
import { Store } from '../stores/entities/store.entity';
import { Zone } from '../zones/entities/zone.entity';
import { AffectedHours } from './visit-builder.service';

const SESSION_GAP_MS = 3 * 3600 * 1000;
const MAX_SNAPSHOT_INTERVAL_SEC = 120;
const LAST_SNAPSHOT_INTERVAL_SEC = 60;

interface SnapRow {
  zoneId: number;
  hour: number;
  ts: Date;
  queueLength: number;
  avgWaitSec: number;
  counterStaffed: boolean;
}
interface ZoneEventRow {
  zoneId: number;
  hour: number;
  type: string;
  visitorId: string;
  ts: Date;
  gender: string;
  ageBand: string;
  dwellSec: number | null;
}

export const ageKey = (band: string): string | null => {
  const i = AGE_BANDS.indexOf(band as (typeof AGE_BANDS)[number]);
  return i >= 0 ? AGE_KEYS[i] : null;
};

/**
 * Recomputes hourly_store_metrics, hourly_zone_metrics and zone_transitions for a store/date
 * from raw tables (visits, visitor_events, pos_transactions, queue_snapshots). Idempotent.
 */
@Injectable()
export class AggregationService {
  private readonly logger = new Logger(AggregationService.name);
  readonly lock = new KeyedLock();
  constructor(private readonly ds: DataSource) {}

  lockKey(storeId: number) {
    return isMssql() ? `store:${storeId}` : 'sqlite';
  }

  async recomputeAffected(storeId: number, affected: AffectedHours) {
    for (const [date, hours] of affected) await this.recompute(storeId, date, [...hours]);
  }

  /** hours undefined = whole day */
  async recompute(storeId: number, date: string, hours?: number[], now = new Date()): Promise<void> {
    const ds = this.ds;
    const store = await ds.getRepository(Store).findOne({ where: { id: storeId } });
    if (!store) return;
    const tz = store.timezone || DEFAULT_TZ;
    const zones = await ds.getRepository(Zone).find({ where: { storeId } });
    const zoneMap = new Map(zones.map((z) => [z.id, z]));

    const visits = await ds.getRepository(Visit).find({ where: { storeId, date } });

    const evRows: { hour: number; type: string; isStaff: unknown; c: unknown }[] = await ds
      .getRepository(VisitorEvent)
      .createQueryBuilder('e')
      .select('e.hour', 'hour')
      .addSelect('e.type', 'type')
      .addSelect('e.isStaff', 'isStaff')
      .addSelect('COUNT(*)', 'c')
      .where('e.storeId = :storeId AND e.date = :date', { storeId, date })
      .andWhere('e.type IN (:...types)', { types: ['ENTRY', 'EXIT'] })
      .groupBy('e.hour')
      .addGroupBy('e.type')
      .addGroupBy('e.isStaff')
      .getRawMany();

    const zoneEvents: ZoneEventRow[] = (
      await ds
        .getRepository(VisitorEvent)
        .createQueryBuilder('e')
        .select(['e.zoneId AS zoneId', 'e.hour AS hour', 'e.type AS type', 'e.visitorId AS visitorId', 'e.ts AS ts', 'e.gender AS gender', 'e.ageBand AS ageBand', 'e.dwellSec AS dwellSec'])
        .where('e.storeId = :storeId AND e.date = :date', { storeId, date })
        .andWhere('e.type IN (:...types)', { types: ['ZONE_ENTER', 'ZONE_EXIT'] })
        .andWhere('e.isStaff = :f', { f: false })
        .andWhere('e.zoneId IS NOT NULL')
        .getRawMany()
    ).map((r: Record<string, unknown>) => ({
      zoneId: num(r.zoneId),
      hour: num(r.hour),
      type: String(r.type),
      visitorId: String(r.visitorId),
      ts: toDate(r.ts),
      gender: String(r.gender ?? 'U'),
      ageBand: String(r.ageBand ?? 'U'),
      dwellSec: r.dwellSec === null || r.dwellSec === undefined ? null : Number(r.dwellSec),
    }));

    const posRows: { hour: unknown; c: unknown; amt: unknown; items: unknown }[] = await ds
      .getRepository(PosTransaction)
      .createQueryBuilder('p')
      .select('p.hour', 'hour')
      .addSelect('COUNT(*)', 'c')
      .addSelect('SUM(p.amount)', 'amt')
      .addSelect('SUM(p.itemsCount)', 'items')
      .where('p.storeId = :storeId AND p.date = :date', { storeId, date })
      .groupBy('p.hour')
      .getRawMany();

    const snaps: SnapRow[] = (
      await ds
        .getRepository(QueueSnapshot)
        .createQueryBuilder('q')
        .select(['q.zoneId AS zoneId', 'q.hour AS hour', 'q.ts AS ts', 'q.queueLength AS queueLength', 'q.avgWaitSec AS avgWaitSec', 'q.counterStaffed AS counterStaffed'])
        .where('q.storeId = :storeId AND q.date = :date', { storeId, date })
        .orderBy('q.zoneId', 'ASC')
        .addOrderBy('q.ts', 'ASC')
        .getRawMany()
    ).map((r: Record<string, unknown>) => ({
      zoneId: num(r.zoneId),
      hour: num(r.hour),
      ts: toDate(r.ts),
      queueLength: num(r.queueLength),
      avgWaitSec: num(r.avgWaitSec),
      counterStaffed: toBool(r.counterStaffed),
    }));
    // interval each snapshot represents (for unattended time)
    const snapSec = new Map<SnapRow, number>();
    for (let i = 0; i < snaps.length; i++) {
      const s = snaps[i];
      const n = snaps[i + 1];
      const sec = n && n.zoneId === s.zoneId ? Math.min(MAX_SNAPSHOT_INTERVAL_SEC, (n.ts.getTime() - s.ts.getTime()) / 1000) : LAST_SNAPSHOT_INTERVAL_SEC;
      snapSec.set(s, Math.max(0, sec));
    }
    const isBreach = (s: SnapRow) => {
      const z = zoneMap.get(s.zoneId);
      if (!z) return false;
      return (
        (z.queueAlertLength !== null && z.queueAlertLength !== undefined && s.queueLength > z.queueAlertLength) ||
        (z.queueAlertWaitSec !== null && z.queueAlertWaitSec !== undefined && s.avgWaitSec > z.queueAlertWaitSec)
      );
    };

    // ---- groups: a group (>=2 non-staff members) counts once, in the hour of its first member
    const customers = visits.filter((v) => !v.isStaff);
    const groupMembers = new Map<string, Visit[]>();
    for (const v of customers) {
      if (!v.groupId) continue;
      if (!groupMembers.has(v.groupId)) groupMembers.set(v.groupId, []);
      groupMembers.get(v.groupId).push(v);
    }
    const groupAnchorHour = new Map<string, number>();
    const groupEngaged = new Map<string, boolean>();
    for (const [gid, members] of groupMembers) {
      if (members.length < 2) continue;
      const first = members.reduce((a, b) => (a.entryTs.getTime() <= b.entryTs.getTime() ? a : b));
      groupAnchorHour.set(gid, first.hour);
      groupEngaged.set(gid, members.some((m) => m.engaged));
    }
    const isIndividual = (v: Visit) => !v.groupId || (groupMembers.get(v.groupId)?.length ?? 0) < 2;

    const staffVisits = visits.filter((v) => v.isStaff);

    // ---- hours to compute
    const candidate = new Set<number>(hours ?? []);
    if (!hours) {
      for (const r of evRows) candidate.add(num(r.hour));
      for (const v of visits) candidate.add(v.hour);
      for (const r of zoneEvents) candidate.add(r.hour);
      for (const r of posRows) candidate.add(num(r.hour));
      for (const s of snaps) candidate.add(s.hour);
      for (const g of groupAnchorHour.values()) candidate.add(g);
      if (staffVisits.length) for (let h = 0; h < 24; h++) candidate.add(h);
    }
    const hourList = [...candidate].filter((h) => h >= 0 && h <= 23).sort((a, b) => a - b);

    const storeRows: Partial<HourlyStoreMetric>[] = [];
    const zoneRows: Partial<HourlyZoneMetric>[] = [];

    for (const h of hourList) {
      const m: Record<string, number> = {};
      const inc = (k: string, by = 1) => (m[k] = (m[k] ?? 0) + by);
      for (const r of evRows) {
        if (num(r.hour) !== h) continue;
        const staff = toBool(r.isStaff);
        const c = num(r.c);
        if (r.type === 'ENTRY') inc(staff ? 'staffEntries' : 'footfallIn', c);
        else if (!staff) inc('footfallOut', c);
      }
      const hv = customers.filter((v) => v.hour === h);
      m.uniqueVisitors = new Set(hv.map((v) => v.visitorId)).size;
      m.repeatVisitors = new Set(hv.filter((v) => v.isRepeat).map((v) => v.visitorId)).size;
      let individuals = 0;
      let engagedIndividuals = 0;
      for (const v of hv) {
        if (v.engaged) inc('engaged');
        if (v.bounced) inc('bounced');
        if (v.gender === 'M') inc('male');
        else if (v.gender === 'F') inc('female');
        else inc('genderUnknown');
        const ak = ageKey(v.ageBand);
        if (ak) {
          inc('age_' + ak);
          if (v.gender === 'M') inc('male_' + ak);
          if (v.gender === 'F') inc('female_' + ak);
        } else inc('ageUnknown');
        if (v.dwellSec !== null && v.dwellSec !== undefined) {
          inc('totalDwellSec', v.dwellSec);
          inc('dwellCount');
        }
        if (isIndividual(v)) {
          individuals++;
          if (v.engaged) engagedIndividuals++;
        }
      }
      let groups = 0;
      let engagedGroups = 0;
      for (const [gid, gh] of groupAnchorHour) {
        if (gh !== h) continue;
        groups++;
        if (groupEngaged.get(gid)) engagedGroups++;
      }
      m.individuals = individuals;
      m.groups = groups;
      m.billableEntities = individuals + groups;
      m.engagedEntities = engagedIndividuals + engagedGroups;

      for (const r of posRows) {
        if (num(r.hour) !== h) continue;
        m.transactions = num(r.c);
        m.revenue = round(num(r.amt), 2);
        m.itemsSold = num(r.items);
      }

      const hs = snaps.filter((s) => s.hour === h);
      if (hs.length) {
        m.queueSamples = hs.length;
        m.avgQueueLength = round(hs.reduce((a, s) => a + s.queueLength, 0) / hs.length, 2);
        m.maxQueueLength = Math.max(...hs.map((s) => s.queueLength));
        m.avgWaitSec = round(hs.reduce((a, s) => a + s.avgWaitSec, 0) / hs.length, 2);
        m.maxWaitSec = Math.max(...hs.map((s) => s.avgWaitSec));
        m.queueBreaches = hs.filter(isBreach).length;
        m.unattendedSec = round(hs.filter((s) => !s.counterStaffed && s.queueLength > 0).reduce((a, s) => a + snapSec.get(s), 0), 1);
      }

      if (staffVisits.length) {
        const hStart = zonedToUtc(date, `${String(h).padStart(2, '0')}:00`, tz).getTime();
        const hEnd = hStart + 3600_000;
        const cap = Math.min(hEnd, now.getTime());
        let overlap = 0;
        if (cap > hStart) {
          for (const sv of staffVisits) {
            const a = Math.max(hStart, sv.entryTs.getTime());
            const endTs = sv.exitTs ? sv.exitTs.getTime() : Math.min(cap, sv.entryTs.getTime() + 14 * 3600_000);
            const b = Math.min(cap, endTs);
            if (b > a) overlap += b - a;
          }
          m.staffPresentAvg = round(overlap / (cap - hStart), 2);
        }
      }

      const hasData = Object.values(m).some((x) => x > 0);
      if (hasData) storeRows.push({ storeId, date, hour: h, ...m } as Partial<HourlyStoreMetric>);

      // ---- zone metrics
      const zIds = new Set<number>([...zoneEvents.filter((e) => e.hour === h).map((e) => e.zoneId), ...hs.map((s) => s.zoneId)]);
      for (const zoneId of zIds) {
        const zone = zoneMap.get(zoneId);
        const enters = zoneEvents.filter((e) => e.hour === h && e.zoneId === zoneId && e.type === 'ZONE_ENTER');
        const exits = zoneEvents.filter((e) => e.hour === h && e.zoneId === zoneId && e.type === 'ZONE_EXIT' && e.dwellSec !== null);
        const zs = hs.filter((s) => s.zoneId === zoneId);
        const threshold = zone?.engagedDwellSec ?? 30;
        const zr: Partial<HourlyZoneMetric> = {
          storeId,
          zoneId,
          date,
          hour: h,
          visits: enters.length,
          uniqueVisitors: new Set(enters.map((e) => e.visitorId)).size,
          male: enters.filter((e) => e.gender === 'M').length,
          female: enters.filter((e) => e.gender === 'F').length,
          totalDwellSec: round(exits.reduce((a, e) => a + e.dwellSec, 0), 1),
          dwellCount: exits.length,
          engaged: exits.filter((e) => e.dwellSec >= threshold).length,
          bounced: exits.filter((e) => e.dwellSec < threshold).length,
        };
        for (const e of enters) {
          const ak = ageKey(e.ageBand);
          if (ak) (zr as Record<string, number>)['age_' + ak] = ((zr as Record<string, number>)['age_' + ak] ?? 0) + 1;
        }
        if (zs.length) {
          zr.queueSamples = zs.length;
          zr.avgQueueLength = round(zs.reduce((a, s) => a + s.queueLength, 0) / zs.length, 2);
          zr.maxQueueLength = Math.max(...zs.map((s) => s.queueLength));
          zr.avgWaitSec = round(zs.reduce((a, s) => a + s.avgWaitSec, 0) / zs.length, 2);
          zr.maxWaitSec = Math.max(...zs.map((s) => s.avgWaitSec));
          zr.queueBreaches = zs.filter(isBreach).length;
          zr.unattendedSec = round(zs.filter((s) => !s.counterStaffed && s.queueLength > 0).reduce((a, s) => a + snapSec.get(s), 0), 1);
        }
        zoneRows.push(zr);
      }
    }

    // ---- journey (whole day): Entrance(0) -> zone -> zone ..., sessions split on 3h gaps
    const transitions = new Map<string, number>();
    const journeyZones = new Set(zones.filter((z) => z.type === 'SECTION' || z.type === 'QUEUE').map((z) => z.id));
    const enters = zoneEvents
      .filter((e) => e.type === 'ZONE_ENTER' && journeyZones.has(e.zoneId))
      .sort((a, b) => (a.visitorId < b.visitorId ? -1 : a.visitorId > b.visitorId ? 1 : a.ts.getTime() - b.ts.getTime()));
    let prevVisitor = '';
    let prevZone = 0;
    let prevTs = 0;
    for (const e of enters) {
      if (e.visitorId !== prevVisitor || e.ts.getTime() - prevTs > SESSION_GAP_MS) prevZone = 0;
      if (e.zoneId !== prevZone) {
        const k = `${prevZone}>${e.zoneId}`;
        transitions.set(k, (transitions.get(k) ?? 0) + 1);
      }
      prevVisitor = e.visitorId;
      prevZone = e.zoneId;
      prevTs = e.ts.getTime();
    }
    const transitionRows: Partial<ZoneTransition>[] = [...transitions].map(([k, count]) => {
      const [from, to] = k.split('>').map(Number);
      return { storeId, date, fromZoneId: from, toZoneId: to, count };
    });

    await ds.transaction(async (em: EntityManager) => {
      const delStore = em.createQueryBuilder().delete().from(HourlyStoreMetric).where('storeId = :storeId AND date = :date', { storeId, date });
      const delZone = em.createQueryBuilder().delete().from(HourlyZoneMetric).where('storeId = :storeId AND date = :date', { storeId, date });
      if (hours) {
        if (!hourList.length) return;
        delStore.andWhere('hour IN (:...hourList)', { hourList });
        delZone.andWhere('hour IN (:...hourList)', { hourList });
      }
      await delStore.execute();
      await delZone.execute();
      await bulkInsert(em, HourlyStoreMetric, storeRows);
      await bulkInsert(em, HourlyZoneMetric, zoneRows);
      await em.getRepository(ZoneTransition).delete({ storeId, date });
      await bulkInsert(em, ZoneTransition, transitionRows);
    });
  }

  /** Recompute today's current (and previous) hour for every active store. Used by the 5-minute cron. */
  async recomputeCurrentHours(storeIds: number[], affectedByStore: Map<number, AffectedHours>, localNow: (s: Store) => { date: string; hour: number }) {
    const stores = await this.ds.getRepository(Store).find({ where: { id: In(storeIds) } });
    for (const s of stores) {
      const { date, hour } = localNow(s);
      const aff = affectedByStore.get(s.id) ?? new Map<string, Set<number>>();
      if (!aff.has(date)) aff.set(date, new Set());
      aff.get(date).add(hour);
      if (hour > 0) aff.get(date).add(hour - 1);
      await this.lock.run(this.lockKey(s.id), () => this.recomputeAffected(s.id, aff));
    }
  }
}
