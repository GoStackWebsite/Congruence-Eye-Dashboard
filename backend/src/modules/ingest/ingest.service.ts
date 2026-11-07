import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { bulkInsert, chunks } from '../../common/bulk';
import { EventBusService } from '../../common/event-bus.service';
import { sniff } from '../../common/file-magic';
import { EdgeContext } from '../../common/roles';
import { localParts } from '../../common/time.util';
import { AlertEngineService } from '../alerts/alert-engine.service';
import { CameraStatusService } from '../cameras/camera-status.service';
import { CamerasService } from '../cameras/cameras.service';
import { Camera } from '../cameras/entities/camera.entity';
import { EdgeDevicesService } from '../edge-devices/edge-devices.service';
import { AggregationService } from '../pipeline/aggregation.service';
import { addAffected, AffectedHours, VisitBuilderService } from '../pipeline/visit-builder.service';
import { SettingsService } from '../settings/settings.service';
import { Store } from '../stores/entities/store.entity';
import { storeView } from '../stores/stores.service';
import { Zone } from '../zones/entities/zone.entity';
import { ZonesService } from '../zones/zones.service';
import { AiManagerRule } from '../ai-manager/entities/ai-manager-rule.entity';
import { aiRuleView } from '../ai-manager/ai-manager.views';
import { Snapshot } from '../media/entities/snapshot.entity';
import { SNAPSHOT_KINDS, SnapshotsService, snapshotUrl } from '../media/snapshots.service';
import { HeartbeatDto, HeatmapDto, IngestEventsDto, IngestQueueDto, IngestStoreOpsDto } from './dto/ingest.dto';
import { HeatmapFrame } from './entities/heatmap-frame.entity';
import { QueueSnapshot } from './entities/queue-snapshot.entity';
import { StoreOpsEvent } from './entities/storeops-event.entity';
import { VisitorEvent } from './entities/visitor-event.entity';
import { Recorder } from '../recorders/entities/recorder.entity';
import { edgeCameraFields } from '../recorders/recorder-links';
import { IngestTally, tsProblem } from './ingest-policy';

const parseTs = (s: string): Date => {
  const d = new Date(s);
  if (isNaN(d.getTime())) throw new BadRequestException(`Invalid timestamp ${s}`);
  return d;
};

/** Natural dedupe key of a visitor event (edge spool replays without a batchId). */
export const eventKey = (e: Pick<VisitorEvent, 'cameraId' | 'trackId' | 'type' | 'ts'>) => `${e.cameraId}|${e.trackId}|${e.type}|${e.ts.getTime()}`;

const tsMessage = (p: 'FUTURE_TS' | 'STALE_TS') => (p === 'FUTURE_TS' ? 'ts is too far in the future (check the edge clock)' : 'ts is older than the ingest window');

@Injectable()
export class IngestService {
  private readonly log = new Logger(IngestService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly visits: VisitBuilderService,
    private readonly aggregation: AggregationService,
    private readonly alerts: AlertEngineService,
    private readonly bus: EventBusService,
    private readonly settings: SettingsService,
    private readonly cameraStatus: CameraStatusService,
    private readonly devices: EdgeDevicesService,
    private readonly snapshots: SnapshotsService,
  ) {}

  private async storeCtx(storeId: number) {
    const store = await this.ds.getRepository(Store).findOne({ where: { id: storeId }, relations: { region: true } });
    if (!store) throw new NotFoundException('Store not found');
    const cameras = await this.ds.getRepository(Camera).find({ where: { storeId }, order: { id: 'ASC' } });
    const zones = await this.ds.getRepository(Zone).find({ where: { storeId }, order: { id: 'ASC' } });
    return { store, cameras, zones, cameraMap: new Map(cameras.map((c) => [c.id, c])), zoneMap: new Map(zones.map((z) => [z.id, z])) };
  }

  async config(edge: EdgeContext) {
    const { store, cameras, zones } = await this.storeCtx(edge.storeId);
    // contract v3: recorder-linked cameras get the real URL (with the password) — edge only
    const recorders = new Map((await this.ds.getRepository(Recorder).find({ where: { storeId: store.id } })).map((r) => [r.id, r]));
    return {
      store: storeView(store),
      cameras: cameras.filter((c) => c.isActive).map((c) => ({ ...CamerasService.view(c), ...edgeCameraFields(c, recorders) })),
      zones: zones.filter((z) => z.isActive).map(ZonesService.view),
      settings: await this.settings.get(),
      aiManagerRules: (await this.ds.getRepository(AiManagerRule).find({ where: { isActive: true }, order: { id: 'ASC' } }))
        .filter((r) => !r.storeIds?.length || r.storeIds.includes(store.id))
        .map(aiRuleView),
    };
  }

  /** Runs after each ingest batch: alert evaluation + live SSE nudge. Never throws. */
  private async after(storeId: number, evaluate = true) {
    if (evaluate) {
      try {
        await this.alerts.evaluate([storeId]);
      } catch (e) {
        this.log.warn(`alert evaluation failed: ${(e as Error).message}`);
      }
    }
    this.bus.emit({ type: 'live', storeId, data: { storeId } });
  }

  /** Ids (of `ids`) that exist as cameras at all — i.e. belong to some store. */
  private async existingCameras(ids: number[]): Promise<Set<number>> {
    const uniq = [...new Set(ids)];
    const found = new Set<number>();
    for (const part of chunks(uniq, 500)) for (const c of await this.ds.getRepository(Camera).find({ select: { id: true }, where: { id: In(part) } })) found.add(c.id);
    return found;
  }

  /** A batch made only of another store's cameras means a wrong API key / misconfigured edge → 403. */
  private forbidIfAllForeign(total: number, foreign: number[]) {
    if (total > 0 && foreign.length === total) throw new ForbiddenException(`cameraId ${[...new Set(foreign)].slice(0, 10).join(', ')} belongs to another store`);
  }

  async events(edge: EdgeContext, dto: IngestEventsDto, opts: { evaluate?: boolean; now?: Date } = {}) {
    const { store, cameraMap, zoneMap } = await this.storeCtx(edge.storeId);
    const now = opts.now ?? new Date();
    const tally = new IngestTally();
    const repo = this.ds.getRepository(VisitorEvent);
    const known = await this.existingCameras(dto.events.filter((e) => !cameraMap.has(e.cameraId)).map((e) => e.cameraId));
    const foreign: number[] = [];
    const candidates: { index: number; row: VisitorEvent }[] = [];
    dto.events.forEach((e, index) => {
      if (!cameraMap.has(e.cameraId)) {
        if (known.has(e.cameraId)) foreign.push(e.cameraId);
        return tally.reject(index, known.has(e.cameraId) ? 'FOREIGN_CAMERA' : 'UNKNOWN_CAMERA');
      }
      if (e.zoneId && !zoneMap.has(e.zoneId)) return tally.reject(index, 'UNKNOWN_ZONE');
      if ((e.type === 'ZONE_ENTER' || e.type === 'ZONE_EXIT') && !e.zoneId) return tally.reject(index, 'ZONE_REQUIRED');
      const ts = parseTs(e.ts);
      const problem = tsProblem(ts, now);
      if (problem) return tally.reject(index, problem);
      const p = localParts(ts, store.timezone);
      const zone = e.zoneId ? zoneMap.get(e.zoneId) : undefined;
      candidates.push({
        index,
        row: repo.create({
          storeId: store.id,
          cameraId: e.cameraId,
          zoneId: e.zoneId ?? null,
          type: e.type,
          ts,
          date: p.date,
          hour: p.hour,
          trackId: e.trackId,
          visitorId: e.visitorId,
          isStaff: !!e.isStaff || zone?.type === 'STAFF_ONLY',
          groupId: e.groupId || null,
          gender: e.gender || 'U',
          ageBand: e.ageBand || 'U',
          dwellSec: e.dwellSec ?? null,
        }),
      });
    });
    this.forbidIfAllForeign(dto.events.length, foreign);
    if (candidates.length) {
      await this.aggregation.lock.run(this.aggregation.lockKey(store.id), async () => {
        const seen = await this.existingEventKeys(store.id, candidates.map((c) => c.row));
        const rows: VisitorEvent[] = [];
        for (const c of candidates) {
          const k = eventKey(c.row);
          if (seen.has(k)) {
            tally.reject(c.index, 'DUPLICATE');
            continue;
          }
          seen.add(k);
          rows.push(c.row);
        }
        tally.accepted = rows.length;
        if (!rows.length) return;
        await bulkInsert(this.ds.manager, VisitorEvent, rows);
        const settings = await this.settings.get();
        const affected = await this.visits.process(store.id, rows, zoneMap, settings);
        for (const r of rows) addAffected(affected, r.date, r.hour);
        await this.aggregation.recomputeAffected(store.id, affected);
      });
    }
    await this.after(store.id, opts.evaluate !== false && tally.accepted > 0);
    return tally.result();
  }

  /** Dedupe keys of stored events of the same tracks within the batch's time span. */
  private async existingEventKeys(storeId: number, rows: VisitorEvent[]): Promise<Set<string>> {
    const out = new Set<string>();
    if (!rows.length) return out;
    let min = rows[0].ts.getTime();
    let max = min;
    for (const r of rows) {
      min = Math.min(min, r.ts.getTime());
      max = Math.max(max, r.ts.getTime());
    }
    for (const part of chunks([...new Set(rows.map((r) => r.trackId))], 500)) {
      const found = await this.ds
        .getRepository(VisitorEvent)
        .createQueryBuilder('e')
        .select(['e.id', 'e.cameraId', 'e.trackId', 'e.type', 'e.ts'])
        .where('e.storeId = :storeId', { storeId })
        .andWhere('e.ts >= :a AND e.ts <= :b', { a: new Date(min), b: new Date(max) })
        .andWhere('e.trackId IN (:...part)', { part })
        .getMany();
      for (const f of found) out.add(eventKey(f));
    }
    return out;
  }

  async queue(edge: EdgeContext, dto: IngestQueueDto, opts: { evaluate?: boolean; now?: Date } = {}) {
    const { store, zoneMap } = await this.storeCtx(edge.storeId);
    const now = opts.now ?? new Date();
    const tally = new IngestTally();
    const cand: { index: number; row: Partial<QueueSnapshot> & { ts: Date; date: string; hour: number } }[] = [];
    dto.snapshots.forEach((s, index) => {
      if (!zoneMap.has(s.zoneId)) return tally.reject(index, 'UNKNOWN_ZONE');
      const ts = parseTs(s.ts);
      const problem = tsProblem(ts, now);
      if (problem) return tally.reject(index, problem);
      const p = localParts(ts, store.timezone);
      cand.push({ index, row: { storeId: store.id, zoneId: s.zoneId, ts, date: p.date, hour: p.hour, queueLength: s.queueLength, avgWaitSec: s.avgWaitSec, counterStaffed: s.counterStaffed } });
    });
    if (cand.length) {
      await this.aggregation.lock.run(this.aggregation.lockKey(store.id), async () => {
        const times = cand.map((c) => c.row.ts.getTime());
        const existing = await this.ds
          .getRepository(QueueSnapshot)
          .createQueryBuilder('q')
          .select(['q.id', 'q.zoneId', 'q.ts'])
          .where('q.storeId = :sid', { sid: store.id })
          .andWhere('q.ts >= :a AND q.ts <= :b', { a: new Date(Math.min(...times)), b: new Date(Math.max(...times)) })
          .getMany();
        const seen = new Set(existing.map((q) => `${q.zoneId}|${q.ts.getTime()}`));
        const rows: Partial<QueueSnapshot>[] = [];
        const affected: AffectedHours = new Map();
        for (const c of cand) {
          const k = `${c.row.zoneId}|${c.row.ts.getTime()}`;
          if (seen.has(k)) {
            tally.reject(c.index, 'DUPLICATE');
            continue;
          }
          seen.add(k);
          rows.push(c.row);
          addAffected(affected, c.row.date, c.row.hour);
        }
        tally.accepted = rows.length;
        if (!rows.length) return;
        await bulkInsert(this.ds.manager, QueueSnapshot, rows);
        await this.aggregation.recomputeAffected(store.id, affected);
      });
    }
    await this.after(store.id, opts.evaluate !== false && tally.accepted > 0);
    return tally.result();
  }

  private async assertCamera(cameraMap: Map<number, Camera>, cameraId: number) {
    if (cameraMap.has(cameraId)) return;
    if ((await this.existingCameras([cameraId])).size) throw new ForbiddenException(`cameraId ${cameraId} belongs to another store`);
    throw new BadRequestException('cameraId does not belong to this store');
  }

  async heatmap(edge: EdgeContext, dto: HeatmapDto, now = new Date()) {
    const { store, cameraMap } = await this.storeCtx(edge.storeId);
    await this.assertCamera(cameraMap, dto.cameraId);
    if (dto.grid.length !== dto.width * dto.height) throw new BadRequestException('grid length must equal width*height');
    if (dto.grid.some((v) => !isFinite(Number(v)) || Number(v) < 0)) throw new BadRequestException('grid values must be finite numbers >= 0');
    const ts = parseTs(dto.ts);
    const problem = tsProblem(ts, now);
    if (problem) throw new BadRequestException(tsMessage(problem));
    const p = localParts(ts, store.timezone);
    await this.aggregation.lock.run(this.aggregation.lockKey(store.id), async () => {
      const repo = this.ds.getRepository(HeatmapFrame);
      const existing = await repo.findOne({ where: { cameraId: dto.cameraId, date: p.date, hour: p.hour } });
      if (existing && existing.width === dto.width && existing.height === dto.height && existing.grid.length === dto.grid.length) {
        existing.grid = existing.grid.map((v, i) => v + (Number(dto.grid[i]) || 0));
        existing.samples += 1;
        await repo.save(existing);
      } else if (existing) {
        Object.assign(existing, { width: dto.width, height: dto.height, grid: dto.grid.map((v) => Number(v) || 0), samples: 1 });
        await repo.save(existing);
      } else {
        await repo.insert({ storeId: store.id, cameraId: dto.cameraId, date: p.date, hour: p.hour, width: dto.width, height: dto.height, grid: dto.grid.map((v) => Number(v) || 0), samples: 1 });
      }
    });
    return { ok: true };
  }

  async heartbeat(edge: EdgeContext, dto: HeartbeatDto, at = new Date()) {
    const { store, cameraMap } = await this.storeCtx(edge.storeId);
    await this.devices.touch(edge.deviceId, dto.version);
    let changed = false;
    // last status per camera wins when a payload repeats a camera (flapping within one heartbeat)
    const last = new Map<number, (typeof dto.cameras)[number]>();
    for (const c of dto.cameras) last.set(c.cameraId, c);
    for (const c of last.values()) {
      const cam = cameraMap.get(c.cameraId);
      if (!cam) continue;
      changed = (await this.cameraStatus.apply(cam, c.status, at, { fps: c.fps, reason: c.reason })) || changed;
    }
    await this.after(store.id, changed);
    return { ok: true };
  }

  async storeops(edge: EdgeContext, dto: IngestStoreOpsDto, opts: { evaluate?: boolean; now?: Date } = {}) {
    const { store, cameraMap } = await this.storeCtx(edge.storeId);
    const now = opts.now ?? new Date();
    const tally = new IngestTally();
    const snapIds = dto.events.map((e) => e.snapshotId).filter((x): x is number => !!x);
    const validSnaps = new Set<number>();
    for (const part of chunks([...new Set(snapIds)], 500)) {
      for (const s of await this.ds.getRepository(Snapshot).find({ select: { id: true, storeId: true }, where: { id: In(part) } })) if (s.storeId === store.id) validSnaps.add(s.id);
    }
    const cand: { index: number; row: Partial<StoreOpsEvent> & { ts: Date } }[] = [];
    dto.events.forEach((e, index) => {
      const ts = parseTs(e.ts);
      const problem = tsProblem(ts, now);
      if (problem) return tally.reject(index, problem);
      const p = localParts(ts, store.timezone);
      cand.push({
        index,
        row: {
          storeId: store.id,
          cameraId: e.cameraId && cameraMap.has(e.cameraId) ? e.cameraId : null,
          type: e.type,
          ts,
          date: p.date,
          hour: p.hour,
          details: e.details ?? null,
          snapshotId: e.snapshotId && validSnaps.has(e.snapshotId) ? e.snapshotId : null,
        },
      });
    });
    if (cand.length) {
      const times = cand.map((c) => c.row.ts.getTime());
      const existing = await this.ds
        .getRepository(StoreOpsEvent)
        .createQueryBuilder('e')
        .select(['e.id', 'e.type', 'e.ts', 'e.cameraId'])
        .where('e.storeId = :sid', { sid: store.id })
        .andWhere('e.ts >= :a AND e.ts <= :b', { a: new Date(Math.min(...times)), b: new Date(Math.max(...times)) })
        .getMany();
      const key = (r: { type: string; ts: Date; cameraId?: number | null }) => `${r.type}|${r.ts.getTime()}|${r.cameraId ?? ''}`;
      const seen = new Set(existing.map(key));
      const rows: Partial<StoreOpsEvent>[] = [];
      for (const c of cand) {
        const k = key(c.row as StoreOpsEvent);
        if (seen.has(k)) {
          tally.reject(c.index, 'DUPLICATE');
          continue;
        }
        seen.add(k);
        rows.push(c.row);
      }
      tally.accepted = rows.length;
      await bulkInsert(this.ds.manager, StoreOpsEvent, rows);
    }
    await this.after(store.id, opts.evaluate !== false && tally.accepted > 0);
    return tally.result();
  }

  async snapshot(edge: EdgeContext, cameraId: number, file?: Express.Multer.File, kind?: string, ts?: string, now = new Date()) {
    if (!file?.buffer?.length) throw new BadRequestException('file is required');
    // the bytes decide, not the declared Content-Type (MIME spoofing)
    if (sniff(file.buffer) !== 'image/jpeg') throw new BadRequestException('file must be a JPEG image');
    const cam = await this.ds.getRepository(Camera).findOne({ where: { id: cameraId } });
    if (!cam) throw new BadRequestException('cameraId does not belong to this store');
    if (cam.storeId !== edge.storeId) throw new ForbiddenException(`cameraId ${cameraId} belongs to another store`);
    const k = (kind || 'PERIODIC').toUpperCase();
    if (!SNAPSHOT_KINDS.includes(k)) throw new BadRequestException(`kind must be one of ${SNAPSHOT_KINDS.join(', ')}`);
    const at = ts ? parseTs(ts) : now;
    const problem = tsProblem(at, now);
    if (problem) throw new BadRequestException(tsMessage(problem));
    const store = await this.ds.getRepository(Store).findOneByOrFail({ id: cam.storeId });
    const snap = await this.snapshots.save({ storeId: cam.storeId, cameraId, buffer: file.buffer, kind: k, ts: at, tz: store.timezone });
    return { ok: true, snapshotId: snap.id, url: snapshotUrl(snap) };
  }
}
