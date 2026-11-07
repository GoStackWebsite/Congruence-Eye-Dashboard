import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { IngestTally, tsProblem } from '../ingest/ingest-policy';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { Paged, parseIds, parseIntOpt, parsePaging, qstr } from '../../common/paging';
import { AuthUser, EdgeContext } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { addDays, eachDate, hhmm, isDateStr, localParts, minutesOfDay, pct, todayLocal } from '../../common/time.util';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { Camera } from '../cameras/entities/camera.entity';
import { StoreOpsEvent } from '../ingest/entities/storeops-event.entity';
import { Snapshot } from '../media/entities/snapshot.entity';
import { SnapshotsService, snapshotUrl } from '../media/snapshots.service';
import { Store } from '../stores/entities/store.entity';
import { Zone } from '../zones/entities/zone.entity';
import { AI_RULE_TYPES, aiRuleView, DEFAULT_AI_PARAMS, WINDOW_RULE_TYPES } from './ai-manager.views';
import { AiRuleDto, IngestDetectionsDto, UpdateAiRuleDto } from './dto/ai-manager.dto';
import { AiDetection } from './entities/ai-detection.entity';
import { AiManagerRule } from './entities/ai-manager-rule.entity';

export const typeLabel = (t: string) => t.toLowerCase().split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');

@Injectable()
export class AiManagerService {
  private readonly log = new Logger(AiManagerService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
    private readonly alerts: AlertEngineService,
    private readonly snapshots: SnapshotsService,
  ) {}

  // ------------------------------------------------------------ rules
  async listRules(user: AuthUser) {
    const rows = await this.ds.getRepository(AiManagerRule).find({ order: { id: 'ASC' } });
    return rows.filter((r) => !r.storeIds?.length || r.storeIds.some((id) => this.scope.canAccess(user, id))).map(aiRuleView);
  }

  private async validate(user: AuthUser, dto: Partial<AiRuleDto>) {
    for (const id of dto.storeIds ?? []) await this.scope.assertStore(user, id);
    if (dto.zoneIds?.length) {
      const zones = await this.ds.getRepository(Zone).find({ where: { id: In(dto.zoneIds) } });
      if (zones.length !== new Set(dto.zoneIds).size) throw new BadRequestException('Unknown zoneIds');
      if (dto.storeIds?.length && zones.some((z) => !dto.storeIds.includes(z.storeId))) throw new BadRequestException('zoneIds must belong to the rule stores');
    }
  }

  async createRule(user: AuthUser, dto: AiRuleDto) {
    await this.validate(user, dto);
    const repo = this.ds.getRepository(AiManagerRule);
    const r = await repo.save(
      repo.create({
        name: dto.name, type: dto.type, storeIds: dto.storeIds ?? [], zoneIds: dto.zoneIds ?? [], windowStart: dto.windowStart ?? '00:00', windowEnd: dto.windowEnd ?? '23:59',
        daysOfWeek: dto.daysOfWeek ?? [0, 1, 2, 3, 4, 5, 6], params: { ...(DEFAULT_AI_PARAMS[dto.type] ?? {}), ...(dto.params ?? {}) },
        severity: dto.severity ?? 'MEDIUM', notifyChannels: dto.notifyChannels ?? ['IN_APP'], notifyEmails: dto.notifyEmails ?? null, isActive: dto.isActive ?? true,
      }),
    );
    return aiRuleView(r);
  }

  private async findRule(user: AuthUser, id: number) {
    const r = await this.ds.getRepository(AiManagerRule).findOne({ where: { id } });
    if (!r) throw new NotFoundException('AI Manager rule not found');
    for (const s of r.storeIds ?? []) this.scope.assert(user, s);
    return r;
  }

  async updateRule(user: AuthUser, id: number, dto: UpdateAiRuleDto) {
    const r = await this.findRule(user, id);
    await this.validate(user, { ...dto, storeIds: dto.storeIds ?? r.storeIds });
    const { params, ...rest } = dto;
    Object.assign(r, rest);
    if (params) r.params = { ...(r.params ?? {}), ...params };
    return aiRuleView(await this.ds.getRepository(AiManagerRule).save(r));
  }

  async deleteRule(user: AuthUser, id: number) {
    await this.findRule(user, id);
    await this.ds.getRepository(AiDetection).update({ ruleId: id }, { ruleId: null });
    await this.ds.getRepository(AiManagerRule).delete(id);
    return { ok: true };
  }

  // ------------------------------------------------------------ detections
  async views(rows: AiDetection[]) {
    const ruleIds = [...new Set(rows.map((r) => r.ruleId).filter((x): x is number => !!x))];
    const rules = new Map((ruleIds.length ? await this.ds.getRepository(AiManagerRule).find({ where: { id: In(ruleIds) } }) : []).map((r) => [r.id, r.name]));
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const camIds = [...new Set(rows.map((r) => r.cameraId))];
    const cams = new Map((camIds.length ? await this.ds.getRepository(Camera).find({ where: { id: In(camIds) } }) : []).map((c) => [c.id, c.name]));
    const zoneIds = [...new Set(rows.map((r) => r.zoneId).filter((x): x is number => !!x))];
    const zones = new Map((zoneIds.length ? await this.ds.getRepository(Zone).find({ where: { id: In(zoneIds) } }) : []).map((z) => [z.id, z.name]));
    const snaps = await this.snapshots.urls(rows.map((r) => r.snapshotId));
    return rows.map((d) => ({
      id: d.id,
      ruleId: d.ruleId ?? null,
      ruleName: d.ruleId ? (rules.get(d.ruleId) ?? typeLabel(d.type)) : typeLabel(d.type),
      type: d.type,
      storeId: d.storeId,
      storeName: stores.get(d.storeId) ?? '',
      cameraId: d.cameraId,
      cameraName: cams.get(d.cameraId) ?? '',
      zoneId: d.zoneId ?? null,
      zoneName: d.zoneId ? (zones.get(d.zoneId) ?? null) : null,
      ts: toIso(d.ts),
      status: d.status,
      details: d.details ?? null,
      confidence: d.confidence ?? null,
      snapshotUrl: d.snapshotId ? (snaps.get(d.snapshotId) ?? null) : null,
      reviewStatus: d.reviewStatus ?? null,
    }));
  }

  private filtered(ids: number[], q: Record<string, unknown>) {
    const qb = this.ds.getRepository(AiDetection).createQueryBuilder('d').where('d.storeId IN (:...ids)', { ids });
    if (q.type) qb.andWhere('d.type IN (:...types)', { types: String(q.type).split(',') });
    if (q.status) qb.andWhere('d.status = :st', { st: qstr(q.status) });
    const rid = parseIntOpt(q.ruleId);
    if (rid) qb.andWhere('d.ruleId = :rid', { rid });
    if (isDateStr(q.from)) qb.andWhere('d.date >= :from', { from: q.from });
    if (isDateStr(q.to)) qb.andWhere('d.date <= :to', { to: q.to });
    if (q.reviewStatus) qb.andWhere('d.reviewStatus = :rs', { rs: qstr(q.reviewStatus) });
    return qb;
  }

  async detections(user: AuthUser, q: Record<string, unknown>): Promise<Paged<unknown>> {
    const { page, pageSize, skip, take } = parsePaging(q);
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return { items: [], total: 0, page, pageSize };
    const [rows, total] = await this.filtered(ids, q).orderBy('d.ts', 'DESC').addOrderBy('d.id', 'DESC').skip(skip).take(take).getManyAndCount();
    return { items: await this.views(rows), total, page, pageSize };
  }

  async review(user: AuthUser, id: number, reviewStatus: string) {
    const d = await this.ds.getRepository(AiDetection).findOne({ where: { id } });
    if (!d) throw new NotFoundException('Detection not found');
    this.scope.assert(user, d.storeId);
    d.reviewStatus = reviewStatus;
    d.reviewedById = user.id;
    await this.ds.getRepository(AiDetection).save(d);
    return (await this.views([d]))[0];
  }

  /** Summary excludes detections reviewed as FALSE_POSITIVE. */
  async summary(user: AuthUser, q: Record<string, unknown>) {
    // same store scope as the detections list (inactive stores included) so the header and list agree
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    const to = isDateStr(q.to) ? q.to : todayLocal();
    const from = isDateStr(q.from) ? q.from : addDays(to, -6);
    if (from > to) throw new BadRequestException('from must be <= to');
    const all = ids.length ? await this.filtered(ids, { from, to }).select(['d.type', 'd.storeId', 'd.date', 'd.status', 'd.reviewStatus']).getMany() : [];
    const rows = all.filter((d) => d.reviewStatus !== 'FALSE_POSITIVE');
    const tally = <K>(key: (d: AiDetection) => K) => {
      const m = new Map<K, { breached: number; complied: number }>();
      for (const d of rows) {
        const k = key(d);
        if (!m.has(k)) m.set(k, { breached: 0, complied: 0 });
        m.get(k)[d.status === 'BREACHED' ? 'breached' : 'complied']++;
      }
      return m;
    };
    const stores = await this.lookup.storeNames(ids);
    const byType = tally((d) => d.type);
    const byStore = tally((d) => d.storeId);
    const byDate = tally((d) => d.date);
    const rate = (x: { breached: number; complied: number }) => pct(x.complied, x.breached + x.complied);
    const breached = rows.filter((d) => d.status === 'BREACHED').length;
    return {
      // totals.detections = what GET /detections returns for the same filters (false positives included)
      totals: { detections: all.length, falsePositives: all.length - rows.length, breached, complied: rows.length - breached, compliancePct: rows.length ? pct(rows.length - breached, rows.length) : null },
      byType: AI_RULE_TYPES.filter((t) => byType.has(t)).map((type) => ({ type, ...byType.get(type), compliancePct: rate(byType.get(type)) })),
      byStore: ids.filter((id) => byStore.has(id)).map((storeId) => ({ storeId, storeName: stores.get(storeId) ?? '', ...byStore.get(storeId), compliancePct: rate(byStore.get(storeId)) })),
      daily: eachDate(from, to).map((date) => ({ date, breached: byDate.get(date)?.breached ?? 0, complied: byDate.get(date)?.complied ?? 0 })),
    };
  }

  /** Store open/close with snaps; tolerance from the STORE_OPEN_CLOSE rule (params.toleranceMin, default 10). */
  async openClose(user: AuthUser, q: Record<string, unknown>, now = new Date()) {
    const ids = await this.scope.resolve(user, parseIds(q.storeIds));
    const to = isDateStr(q.to) ? q.to : todayLocal();
    const from = isDateStr(q.from) ? q.from : addDays(to, -6);
    if (!ids.length) return [];
    const stores = await this.ds.getRepository(Store).find({ where: { id: In(ids) }, order: { id: 'ASC' } });
    const rules = await this.ds.getRepository(AiManagerRule).find({ where: { type: 'STORE_OPEN_CLOSE', isActive: true } });
    const events = await this.ds
      .getRepository(StoreOpsEvent)
      .createQueryBuilder('e')
      .where('e.storeId IN (:...ids)', { ids })
      .andWhere('e.type IN (:...t)', { t: ['STORE_OPENED', 'STORE_CLOSED'] })
      .andWhere('e.date >= :from AND e.date <= :to', { from, to })
      .getMany();
    const snaps = await this.ds
      .getRepository(Snapshot)
      .createQueryBuilder('s')
      .where('s.storeId IN (:...ids)', { ids })
      .andWhere('s.kind IN (:...k)', { k: ['OPENING', 'CLOSING'] })
      .andWhere('s.date >= :from AND s.date <= :to', { from, to })
      .orderBy('s.ts', 'ASC')
      .getMany();
    const linked = await this.snapshots.urls(events.map((e) => e.snapshotId));
    const out: unknown[] = [];
    for (const s of stores) {
      const rule = rules.find((r) => r.storeIds?.includes(s.id)) ?? rules.find((r) => !r.storeIds?.length);
      const tol = Number(rule?.params?.toleranceMin ?? DEFAULT_AI_PARAMS.STORE_OPEN_CLOSE.toleranceMin);
      const nowP = localParts(now, s.timezone);
      const today = nowP.date;
      const nowMin = nowP.hour * 60 + nowP.minute;
      for (const date of eachDate(from, to).reverse()) {
        if (date > today) continue;
        const evs = events.filter((e) => e.storeId === s.id && e.date === date);
        const opened = evs.filter((e) => e.type === 'STORE_OPENED').sort((a, b) => a.ts.getTime() - b.ts.getTime())[0];
        const closed = evs.filter((e) => e.type === 'STORE_CLOSED').sort((a, b) => b.ts.getTime() - a.ts.getTime())[0];
        const status = (actual: Date | undefined, sched: string) => {
          if (!actual) return 'MISSING' as const;
          const diff = minutesOfDay(hhmm(actual, s.timezone)) - minutesOfDay(sched);
          return diff > tol ? ('LATE' as const) : diff < -tol ? ('EARLY' as const) : ('ON_TIME' as const);
        };
        // today, before the scheduled time (+ tolerance) and no event yet → PENDING (not a breach)
        const pending = (actual: Date | undefined, sched: string) => date === today && !actual && nowMin < minutesOfDay(sched) + tol;
        const openStatus = pending(opened?.ts, s.openTime) ? ('PENDING' as const) : status(opened?.ts, s.openTime);
        const closeStatus = pending(closed?.ts, s.closeTime) ? ('PENDING' as const) : status(closed?.ts, s.closeTime);
        const snapFor = (ev: StoreOpsEvent | undefined, kind: string) =>
          (ev?.snapshotId ? linked.get(ev.snapshotId) : null) ?? snapshotUrl(snaps.find((x) => x.storeId === s.id && x.date === date && x.kind === kind)) ?? null;
        // MISSING is only reported once the scheduled time + tolerance has passed (before that it is PENDING),
        // so a missing open/close is a breach on any day; a day with a PENDING half is not decided yet
        const breached = ['LATE', 'EARLY', 'MISSING'].includes(openStatus) || ['LATE', 'EARLY', 'MISSING'].includes(closeStatus);
        const pendingDay = !breached && (openStatus === 'PENDING' || closeStatus === 'PENDING');
        out.push({
          storeId: s.id, storeName: s.name, date, scheduledOpen: s.openTime, scheduledClose: s.closeTime,
          actualOpen: opened ? hhmm(opened.ts, s.timezone) : null, actualClose: closed ? hhmm(closed.ts, s.timezone) : null,
          openStatus, closeStatus, openingSnapUrl: snapFor(opened, 'OPENING'), closingSnapUrl: snapFor(closed, 'CLOSING'),
          detectionStatus: breached ? 'BREACHED' : pendingDay ? 'PENDING' : 'COMPLIED',
        });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ ingest
  /**
   * Edge detections. Same acceptance policy as visitor events (docs/qa/EDGE_CASE_PLAN.md): per-item
   * rejection of unknown/foreign cameras and out-of-window timestamps, natural dedupe on
   * type + cameraId + ruleId + ts (spool replays), 403 when the whole batch is another store's.
   */
  async ingest(edge: EdgeContext, dto: IngestDetectionsDto, now = new Date()) {
    const store = await this.ds.getRepository(Store).findOneByOrFail({ id: edge.storeId });
    const cams = new Map((await this.ds.getRepository(Camera).find({ where: { storeId: store.id } })).map((c) => [c.id, c]));
    const zones = new Set((await this.ds.getRepository(Zone).find({ where: { storeId: store.id } })).map((z) => z.id));
    const rules = new Map((await this.ds.getRepository(AiManagerRule).find()).map((r) => [r.id, r]));
    const snapIds = [...new Set(dto.detections.map((d) => d.snapshotId).filter((x): x is number => !!x))];
    const okSnaps = new Set<number>();
    for (let i = 0; i < snapIds.length; i += 500) {
      for (const s of await this.ds.getRepository(Snapshot).find({ select: { id: true }, where: { id: In(snapIds.slice(i, i + 500)), storeId: store.id } })) okSnaps.add(s.id);
    }
    const otherIds = [...new Set(dto.detections.filter((d) => !cams.has(d.cameraId)).map((d) => d.cameraId))];
    const known = new Set(otherIds.length ? (await this.ds.getRepository(Camera).find({ select: { id: true }, where: { id: In(otherIds.slice(0, 500)) } })).map((c) => c.id) : []);
    const tally = new IngestTally();
    const foreign: number[] = [];
    const repo = this.ds.getRepository(AiDetection);
    const valid: { index: number; d: (typeof dto.detections)[number]; ts: Date; rule?: AiManagerRule }[] = [];
    dto.detections.forEach((d, index) => {
      if (!cams.has(d.cameraId)) {
        if (known.has(d.cameraId)) foreign.push(d.cameraId);
        return tally.reject(index, known.has(d.cameraId) ? 'FOREIGN_CAMERA' : 'UNKNOWN_CAMERA');
      }
      const rule = d.ruleId ? rules.get(d.ruleId) : undefined;
      if (d.ruleId && (!rule || (rule.storeIds?.length && !rule.storeIds.includes(store.id)))) return tally.reject(index, 'UNKNOWN_RULE');
      const ts = new Date(d.ts);
      const problem = tsProblem(ts, now);
      if (problem) return tally.reject(index, problem);
      valid.push({ index, d, ts, rule });
    });
    if (dto.detections.length && foreign.length === dto.detections.length) throw new ForbiddenException(`cameraId ${[...new Set(foreign)].slice(0, 10).join(', ')} belongs to another store`);
    const key = (x: { type: string; cameraId: number; ruleId: number | null; ts: Date }) => `${x.type}|${x.cameraId}|${x.ruleId ?? ''}|${x.ts.getTime()}`;
    const seen = new Set<string>();
    if (valid.length) {
      const times = valid.map((v) => v.ts.getTime());
      const existing = await repo
        .createQueryBuilder('d')
        .select(['d.id', 'd.type', 'd.cameraId', 'd.ruleId', 'd.ts'])
        .where('d.storeId = :sid', { sid: store.id })
        .andWhere('d.ts >= :a AND d.ts <= :b', { a: new Date(Math.min(...times)), b: new Date(Math.max(...times)) })
        .getMany();
      for (const e of existing) seen.add(key(e));
    }
    let breached = false;
    for (const { index, d, ts, rule } of valid) {
      const type = rule?.type ?? d.type;
      const k = key({ type, cameraId: d.cameraId, ruleId: rule?.id ?? null, ts });
      if (seen.has(k)) {
        tally.reject(index, 'DUPLICATE');
        continue;
      }
      seen.add(k);
      const date = localParts(ts, store.timezone).date;
      // window rules (huddle, hygiene) report one verdict per store per window
      if (rule && WINDOW_RULE_TYPES.includes(rule.type) && (await repo.count({ where: { ruleId: rule.id, storeId: store.id, date } }))) {
        tally.reject(index, 'DUPLICATE');
        continue;
      }
      const det = await repo.save(
        repo.create({
          ruleId: rule?.id ?? null, type, storeId: store.id, cameraId: d.cameraId, zoneId: d.zoneId && zones.has(d.zoneId) ? d.zoneId : null,
          ts, date, status: d.status, details: d.details ?? null, confidence: d.confidence ?? null, snapshotId: d.snapshotId && okSnaps.has(d.snapshotId) ? d.snapshotId : null, reviewStatus: null,
        }),
      );
      tally.accepted++;
      if (det.status === 'BREACHED') {
        breached = true;
        await this.breach(det, rule ?? null, store, now);
      }
    }
    if (breached) await this.alerts.evaluate([store.id], now, ['AI_MANAGER_BREACH']).catch(() => 0);
    return tally.result();
  }

  /** Implicit AI_MANAGER_BREACH alert + "<Rule> breach detected for store <code>" notification. */
  async breach(det: AiDetection, rule: AiManagerRule | null, store: Store, now = new Date()) {
    try {
      const name = rule?.name ?? typeLabel(det.type);
      const alert = await this.alerts.raise(
        {
          id: null,
          name,
          metric: 'AI_MANAGER_BREACH',
          severity: rule?.severity ?? 'MEDIUM',
          channels: [...new Set(['IN_APP', ...(rule?.notifyChannels ?? [])])],
          emails: rule?.notifyEmails ?? null,
        },
        store,
        { value: det.confidence ?? 1, message: `${name}: ${det.details ?? typeLabel(det.type) + ' breach'} at ${store.name}`.slice(0, 1000) },
        now,
        { notificationTitle: `${name} breach detected for store ${store.code}` },
      );
      await this.ds.getRepository(AiDetection).update(det.id, { alertId: alert.id });
    } catch (e) {
      this.log.warn(`breach alert failed: ${(e as Error).message}`);
    }
  }
}
