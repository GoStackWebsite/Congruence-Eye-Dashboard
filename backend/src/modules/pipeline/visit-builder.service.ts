import { Injectable } from '@nestjs/common';
import { DataSource, IsNull, LessThan } from 'typeorm';
import { bulkInsert, chunks } from '../../common/bulk';
import { toDate } from '../../common/db-types';
import { addDays } from '../../common/time.util';
import { Visit } from '../analytics/entities/visit.entity';
import { VisitorEvent } from '../ingest/entities/visitor-event.entity';
import { Settings } from '../settings/settings.service';
import { Zone } from '../zones/entities/zone.entity';

export type AffectedHours = Map<string, Set<number>>; // date -> hours

export const addAffected = (m: AffectedHours, date: string, hour: number) => {
  if (!m.has(date)) m.set(date, new Set());
  m.get(date).add(hour);
};

const LOOKBACK_MS = 12 * 3600 * 1000;
export const STALE_VISIT_MS = 3 * 3600 * 1000;

/** Flags derived from dwell: see ARCHITECTURE.md "Metric definitions". */
export function finalizeVisit(v: Visit, s: Pick<Settings, 'engagedStoreDwellSec' | 'bounceSec'>) {
  const dwell = v.dwellSec;
  if (v.isStaff) {
    v.engaged = false;
    v.bounced = false;
    return;
  }
  v.engaged = !!v.zoneEngaged || (dwell !== null && dwell !== undefined && dwell >= s.engagedStoreDwellSec);
  v.bounced = !v.engaged && dwell !== null && dwell !== undefined && dwell < s.bounceSec;
}

/**
 * Builds one `visits` row per ENTRY (by visitorId), closes it on EXIT and links ZONE_EXIT dwell
 * within the visit window. Works on a batch in memory, then persists.
 */
@Injectable()
export class VisitBuilderService {
  constructor(private readonly ds: DataSource) {}

  async process(storeId: number, events: VisitorEvent[], zones: Map<number, Zone>, settings: Settings): Promise<AffectedHours> {
    const affected: AffectedHours = new Map();
    const relevant = events
      .filter((e) => e.type === 'ENTRY' || e.type === 'EXIT' || e.type === 'ZONE_EXIT')
      .sort((a, b) => a.ts.getTime() - b.ts.getTime());
    if (!relevant.length) return affected;
    const repo = this.ds.getRepository(Visit);
    const visitorIds = [...new Set(relevant.map((e) => e.visitorId))];
    const minTs = new Date(relevant[0].ts.getTime() - LOOKBACK_MS);

    const byVisitor = new Map<string, Visit[]>();
    for (const ids of chunks(visitorIds, 800)) {
      const rows = await repo
        .createQueryBuilder('v')
        .where('v.storeId = :storeId', { storeId })
        .andWhere('v.visitorId IN (:...ids)', { ids })
        .andWhere('v.entryTs >= :minTs', { minTs })
        .getMany();
      for (const v of rows) {
        if (!byVisitor.has(v.visitorId)) byVisitor.set(v.visitorId, []);
        byVisitor.get(v.visitorId).push(v);
      }
    }
    for (const list of byVisitor.values()) list.sort((a, b) => a.entryTs.getTime() - b.entryTs.getTime());

    // previous visit dates for repeat detection
    const entries = relevant.filter((e) => e.type === 'ENTRY');
    const priorDates = new Map<string, string[]>();
    if (entries.length) {
      const dates = entries.map((e) => e.date).sort();
      const fromDate = addDays(dates[0], -settings.repeatWindowDays);
      const entryVisitors = [...new Set(entries.map((e) => e.visitorId))];
      for (const ids of chunks(entryVisitors, 800)) {
        const rows: { visitorId: string; date: string }[] = await repo
          .createQueryBuilder('v')
          .select('v.visitorId', 'visitorId')
          .addSelect('v.date', 'date')
          .where('v.storeId = :storeId', { storeId })
          .andWhere('v.visitorId IN (:...ids)', { ids })
          .andWhere('v.date >= :fromDate AND v.date < :toDate', { fromDate, toDate: dates[dates.length - 1] })
          .andWhere('v.isStaff = :f', { f: false })
          .groupBy('v.visitorId')
          .addGroupBy('v.date')
          .getRawMany();
        for (const r of rows) {
          if (!priorDates.has(r.visitorId)) priorDates.set(r.visitorId, []);
          priorDates.get(r.visitorId).push(r.date);
        }
      }
    }

    const created: Visit[] = [];
    const dirty = new Set<Visit>();
    const mark = (v: Visit) => {
      finalizeVisit(v, settings);
      if (v.id) dirty.add(v);
      addAffected(affected, v.date, v.hour);
    };

    for (const e of relevant) {
      const list = byVisitor.get(e.visitorId) ?? [];
      if (e.type === 'ENTRY') {
        const prior = priorDates.get(e.visitorId) ?? [];
        const windowStart = addDays(e.date, -settings.repeatWindowDays);
        const isRepeat =
          !e.isStaff &&
          (prior.some((d) => d < e.date && d >= windowStart) || list.some((v) => !v.isStaff && v.date < e.date && v.date >= windowStart));
        const v = repo.create({
          storeId,
          visitorId: e.visitorId,
          trackId: e.trackId,
          entryTs: e.ts,
          exitTs: null,
          date: e.date,
          hour: e.hour,
          dwellSec: null,
          isStaff: e.isStaff,
          groupId: e.groupId || null,
          gender: e.gender || 'U',
          ageBand: e.ageBand || 'U',
          engaged: false,
          zoneEngaged: false,
          bounced: false,
          isRepeat,
          maxZoneDwellSec: 0,
          autoClosed: false,
        });
        list.push(v);
        byVisitor.set(e.visitorId, list);
        created.push(v);
        mark(v);
      } else if (e.type === 'EXIT') {
        const v = [...list].reverse().find((x) => !x.exitTs && x.entryTs.getTime() <= e.ts.getTime());
        if (!v) continue;
        v.exitTs = e.ts;
        v.dwellSec = e.dwellSec ?? Math.round((e.ts.getTime() - v.entryTs.getTime()) / 1000);
        mark(v);
      } else {
        const t = e.ts.getTime();
        const v = [...list]
          .reverse()
          .find((x) => x.entryTs.getTime() <= t && (!x.exitTs || x.exitTs.getTime() >= t) && t - x.entryTs.getTime() <= STALE_VISIT_MS);
        if (!v || e.dwellSec === null || e.dwellSec === undefined) continue;
        v.maxZoneDwellSec = Math.max(v.maxZoneDwellSec || 0, e.dwellSec);
        const z = e.zoneId ? zones.get(e.zoneId) : undefined;
        const threshold = z?.engagedDwellSec ?? 30;
        if (e.dwellSec >= threshold) v.zoneEngaged = true;
        mark(v);
      }
    }

    await bulkInsert(this.ds.manager, Visit, created);
    for (const v of dirty) {
      await repo.update(v.id, {
        exitTs: v.exitTs,
        dwellSec: v.dwellSec,
        engaged: v.engaged,
        zoneEngaged: v.zoneEngaged,
        bounced: v.bounced,
        maxZoneDwellSec: v.maxZoneDwellSec,
      });
    }
    return affected;
  }

  /** Closes visits without EXIT older than 3h. Returns affected hours per store. */
  async closeStale(now: Date, settings: Settings): Promise<Map<number, AffectedHours>> {
    const repo = this.ds.getRepository(Visit);
    const cutoff = new Date(now.getTime() - STALE_VISIT_MS);
    const stale = await repo.find({ where: { exitTs: IsNull(), entryTs: LessThan(cutoff) }, take: 5000 });
    const out = new Map<number, AffectedHours>();
    for (const v of stale) {
      const last = await this.ds
        .getRepository(VisitorEvent)
        .createQueryBuilder('e')
        .select('MAX(e.ts)', 'ts')
        .where('e.storeId = :s AND e.visitorId = :vid', { s: v.storeId, vid: v.visitorId })
        .andWhere('e.ts >= :a AND e.ts <= :b', { a: v.entryTs, b: new Date(v.entryTs.getTime() + STALE_VISIT_MS) })
        .getRawOne<{ ts: unknown }>();
      const exit = toDate(last?.ts) ?? v.entryTs;
      v.exitTs = exit;
      v.dwellSec = Math.round((exit.getTime() - v.entryTs.getTime()) / 1000);
      v.autoClosed = true;
      finalizeVisit(v, settings);
      await repo.update(v.id, { exitTs: v.exitTs, dwellSec: v.dwellSec, autoClosed: true, engaged: v.engaged, bounced: v.bounced });
      if (!out.has(v.storeId)) out.set(v.storeId, new Map());
      addAffected(out.get(v.storeId), v.date, v.hour);
    }
    return out;
  }
}

