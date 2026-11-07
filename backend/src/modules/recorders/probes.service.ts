import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In, LessThan, Not, IsNull } from 'typeorm';
import { toDate, toIso } from '../../common/db-types';
import { parseIntOpt } from '../../common/paging';
import { AuthUser, EdgeContext } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { uploadDir } from '../../config/database.config';
import { CAMERA_STALE_SEC } from '../cameras/camera-status.service';
import { Camera } from '../cameras/entities/camera.entity';
import { EdgeDevice } from '../edge-devices/entities/edge-device.entity';
import { DiscoveredDeviceDto, ProbeResultDto } from './dto/recorder.dto';
import { DiscoveredDevice } from './entities/discovered-device.entity';
import { Probe } from './entities/probe.entity';
import { Recorder } from './entities/recorder.entity';
import { onvifInfo, profileOf, realChannelUrl } from './recorder-links';

/** A PENDING or RUNNING probe older than this becomes EXPIRED. */
export const PROBE_EXPIRY_SEC = 60;
export const EDGE_OFFLINE_MESSAGE = "The store's AI box is offline";
export const EXPIRED_MESSAGE = `No result from the store's AI box within ${PROBE_EXPIRY_SEC} s`;

export function probeView(p: Probe) {
  return {
    id: p.id,
    storeId: p.storeId,
    cameraId: p.cameraId ?? null,
    recorderId: p.recorderId ?? null,
    channel: p.channel ?? null,
    status: p.status,
    requestedAt: toIso(p.requestedAt),
    completedAt: toIso(p.completedAt),
    width: p.width ?? null,
    height: p.height ?? null,
    fps: p.fps ?? null,
    codec: p.codec ?? null,
    latencyMs: p.latencyMs ?? null,
    error: p.error ?? null,
    errorCode: p.errorCode ?? null,
    snapshotUrl: p.snapshotPath ? `/uploads/${p.snapshotPath.replace(/\\/g, '/')}` : null,
  };
}

type ProbeSpec = { storeId: number; cameraId: number | null; recorderId: number | null; channel: number | null; streamProfile: string | null };

/** Masks credentials in free text coming back from the edge (ffmpeg errors can echo the URL). */
const redact = (s: string) => s.replace(/(rtsp|rtsps|http|https):\/\/([^\s/@:]*):([^\s/@]*)@/gi, '$1://$2:****@');

@Injectable()
export class ProbesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Probe);
  }

  /** The store's edge was seen within CAMERA_STALE_SEC (any of its devices). Never seen = offline. */
  async edgeOnline(storeId: number, now = new Date()): Promise<boolean> {
    const devices = await this.ds.getRepository(EdgeDevice).find({ where: { storeId, lastSeenAt: Not(IsNull()) } });
    if (!devices.length) return false;
    const stale = CAMERA_STALE_SEC();
    if (stale <= 0) return true;
    const newest = Math.max(...devices.map((d) => toDate(d.lastSeenAt)?.getTime() ?? 0));
    return newest >= now.getTime() - stale * 1000;
  }

  private async create(user: AuthUser, specs: ProbeSpec[]): Promise<Probe[]> {
    if (!specs.length) return [];
    const now = new Date();
    const online = await this.edgeOnline(specs[0].storeId, now);
    const rows = specs.map((s) =>
      this.repo.create({
        ...s,
        requestedAt: now,
        requestedById: user.id,
        ...(online
          ? { status: 'PENDING', completedAt: null, error: null, errorCode: null }
          : { status: 'FAILED', completedAt: now, error: EDGE_OFFLINE_MESSAGE, errorCode: 'EDGE_OFFLINE' }),
      }),
    );
    return this.repo.save(rows);
  }

  async testCamera(user: AuthUser, cameraId: number) {
    const c = await this.ds.getRepository(Camera).findOne({ where: { id: cameraId } });
    if (!c) throw new NotFoundException('Camera not found');
    this.scope.assert(user, c.storeId);
    let recorder: Recorder | null = null;
    if (c.recorderId) recorder = await this.ds.getRepository(Recorder).findOne({ where: { id: c.recorderId } });
    if (!recorder && !c.rtspUrl) throw new BadRequestException('The camera has no RTSP URL and is not linked to a recorder');
    const [p] = await this.create(user, [
      {
        storeId: c.storeId, cameraId: c.id, recorderId: recorder?.id ?? null, channel: recorder ? c.channel : null,
        streamProfile: recorder ? profileOf(c, recorder) : null,
      },
    ]);
    return probeView(p);
  }

  async testRecorder(user: AuthUser, recorder: Recorder, channels?: number[]) {
    const list = channels?.length ? [...new Set(channels)] : Array.from({ length: recorder.channels }, (_, i) => i + 1);
    const bad = list.filter((ch) => ch > recorder.channels);
    if (bad.length) throw new BadRequestException([`channel numbers must be ≤ ${recorder.channels} (got ${bad.join(', ')})`]);
    const cams = new Map(
      (await this.ds.getRepository(Camera).find({ where: { recorderId: recorder.id, isActive: true } })).map((c) => [c.channel, c]),
    );
    const probes = await this.create(
      user,
      list.map((ch) => ({
        storeId: recorder.storeId, cameraId: cams.get(ch)?.id ?? null, recorderId: recorder.id, channel: ch,
        streamProfile: profileOf(cams.get(ch), recorder),
      })),
    );
    return probes.map(probeView);
  }

  /** PENDING / RUNNING probes requested more than 60 s ago become EXPIRED (on read and every minute). */
  async expireStale(now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - PROBE_EXPIRY_SEC * 1000);
    const res = await this.repo.update(
      { status: In(['PENDING', 'RUNNING']), requestedAt: LessThan(cutoff) },
      { status: 'EXPIRED', completedAt: now, error: EXPIRED_MESSAGE },
    );
    return res.affected ?? 0;
  }

  async get(user: AuthUser, id: number) {
    await this.expireStale();
    const p = await this.repo.findOne({ where: { id } });
    if (!p) throw new NotFoundException('Probe not found');
    this.scope.assert(user, p.storeId);
    return probeView(p);
  }

  async list(user: AuthUser, q: Record<string, unknown>) {
    await this.expireStale();
    const sid = parseIntOpt(q.storeId);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    const where: Record<string, unknown> = { storeId: In(ids) };
    const rid = parseIntOpt(q.recorderId);
    const cid = parseIntOpt(q.cameraId);
    if (rid) where.recorderId = rid;
    if (cid) where.cameraId = cid;
    const rows = await this.repo.find({ where, order: { requestedAt: 'DESC', id: 'DESC' }, take: 50 });
    return rows.map(probeView);
  }

  // ------------------------------------------------------------------ edge
  /** GET /api/ingest/probes: pending probes of the edge's store, marked RUNNING, with the real URL. */
  async claim(edge: EdgeContext) {
    await this.expireStale();
    const pending = await this.repo.find({ where: { storeId: edge.storeId, status: 'PENDING' }, order: { id: 'ASC' }, take: 64 });
    if (!pending.length) return [];
    const recIds = [...new Set(pending.map((p) => p.recorderId).filter((x): x is number => !!x))];
    const camIds = [...new Set(pending.map((p) => p.cameraId).filter((x): x is number => !!x))];
    const recorders = new Map((recIds.length ? await this.ds.getRepository(Recorder).find({ where: { id: In(recIds) } }) : []).map((r) => [r.id, r]));
    const cameras = new Map((camIds.length ? await this.ds.getRepository(Camera).find({ where: { id: In(camIds) } }) : []).map((c) => [c.id, c]));
    const now = new Date();
    const out: unknown[] = [];
    for (const p of pending) {
      const r = p.recorderId ? recorders.get(p.recorderId) : undefined;
      const c = p.cameraId ? cameras.get(p.cameraId) : undefined;
      let rtspUrl: string | null = null;
      if (r && p.channel) rtspUrl = realChannelUrl(r, p.channel, p.streamProfile || profileOf(c, r));
      else if (c && !c.recorderId && c.rtspUrl) rtspUrl = c.rtspUrl;
      // claim atomically: only the request that flips PENDING → RUNNING hands the probe out
      if (!rtspUrl) {
        await this.repo.update({ id: p.id, status: 'PENDING' }, { status: 'FAILED', completedAt: now, errorCode: 'OTHER', error: 'The camera or recorder no longer exists' });
        continue;
      }
      const res = await this.repo.update({ id: p.id, status: 'PENDING' }, { status: 'RUNNING', claimedAt: now });
      if (!res.affected) continue;
      out.push({
        id: p.id, rtspUrl, cameraId: p.cameraId ?? null, recorderId: p.recorderId ?? null, channel: p.channel ?? null,
        brand: r?.brand ?? null, streamProfile: r ? p.streamProfile || profileOf(c, r) : null, onvif: r ? onvifInfo(r) : null,
      });
    }
    return out;
  }

  /** POST /api/ingest/probes/:id — multipart `result` (JSON string) + optional `file` (JPEG), or a plain JSON body. */
  async result(edge: EdgeContext, id: number, body: Record<string, unknown>, file?: Express.Multer.File) {
    let raw: unknown = body?.result !== undefined ? body.result : body;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch {
        throw new BadRequestException('result must be a JSON string');
      }
    }
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new BadRequestException('result is required');
    const dto = plainToInstance(ProbeResultDto, raw);
    const errors = await validate(dto, { whitelist: true });
    if (errors.length) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
    if (file?.buffer?.length && file.mimetype && !/^image\/(jpeg|jpg|pjpeg)$/.test(file.mimetype)) throw new BadRequestException('file must be image/jpeg');

    await this.expireStale();
    const p = await this.repo.findOne({ where: { id } });
    if (!p || p.storeId !== edge.storeId) throw new NotFoundException('Probe not found');
    if (!['PENDING', 'RUNNING'].includes(p.status)) throw new ConflictException(`Probe is already ${p.status}`);
    const ok = dto.status === 'OK';
    Object.assign(p, {
      status: dto.status,
      completedAt: new Date(),
      width: dto.width ?? null,
      height: dto.height ?? null,
      fps: dto.fps ?? null,
      codec: dto.codec ? dto.codec.slice(0, 30) : null,
      latencyMs: dto.latencyMs ?? null,
      error: ok ? null : redact(dto.error || 'Connection test failed').slice(0, 500),
      errorCode: ok ? null : dto.errorCode || 'OTHER',
    });
    if (file?.buffer?.length) {
      const rel = path.join('probes', String(p.storeId), `probe-${p.id}-${randomBytes(3).toString('hex')}.jpg`);
      const abs = path.join(uploadDir(), rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, file.buffer);
      p.snapshotPath = rel.split(path.sep).join('/');
    }
    await this.repo.save(p);
    if (p.recorderId) await this.recomputeRecorderStatus(p.recorderId);
    return probeView(p);
  }

  /**
   * Recorder status from the latest edge-reported result (OK / FAILED, not EDGE_OFFLINE or EXPIRED) of each channel:
   * all OK → ONLINE, none OK → OFFLINE, a mix → PARTIAL, nothing tested → UNKNOWN.
   */
  async recomputeRecorderStatus(recorderId: number, manager = this.ds.manager) {
    const r = await manager.getRepository(Recorder).findOne({ where: { id: recorderId } });
    if (!r) return null;
    const rows = await manager.getRepository(Probe).find({
      where: { recorderId, status: In(['OK', 'FAILED']) },
      order: { completedAt: 'DESC', id: 'DESC' },
      take: 5000,
    });
    const latest = new Map<number, Probe>();
    for (const p of rows) {
      if (!p.channel || p.channel > r.channels || p.errorCode === 'EDGE_OFFLINE') continue;
      if (!latest.has(p.channel)) latest.set(p.channel, p);
    }
    const results = [...latest.values()];
    const ok = results.filter((p) => p.status === 'OK').length;
    const status = !results.length ? 'UNKNOWN' : ok === results.length ? 'ONLINE' : ok === 0 ? 'OFFLINE' : 'PARTIAL';
    const last = results.reduce<Date | null>((m, p) => {
      const d = toDate(p.completedAt);
      return d && (!m || d > m) ? d : m;
    }, null);
    await manager.getRepository(Recorder).update(r.id, { status, lastCheckedAt: last });
    return status;
  }

  /** POST /api/ingest/discovered: `{ devices: [...] }` or a bare array; upsert by store + host + RTSP port. */
  async ingestDiscovered(edge: EdgeContext, body: unknown) {
    const list = Array.isArray(body) ? body : body && typeof body === 'object' ? (body as { devices?: unknown }).devices : undefined;
    if (!Array.isArray(list)) throw new BadRequestException('devices must be an array');
    if (list.length > 1024) throw new BadRequestException('at most 1024 devices');
    const repo = this.ds.getRepository(DiscoveredDevice);
    const now = new Date();
    let accepted = 0;
    for (const item of list) {
      const dto = plainToInstance(DiscoveredDeviceDto, item);
      const errors = await validate(dto ?? {}, { whitelist: true });
      if (errors.length) throw new BadRequestException(errors.flatMap((e) => Object.values(e.constraints ?? {})));
      const host = dto.host.trim().toLowerCase();
      const rtspPort = dto.rtspPort ?? dto.port ?? 554;
      const existing = await repo.findOne({ where: { storeId: edge.storeId, host, rtspPort } });
      const patch = { httpPort: dto.httpPort ?? existing?.httpPort ?? null, brandGuess: dto.brandGuess ?? existing?.brandGuess ?? null, onvif: !!dto.onvif || !!existing?.onvif, seenAt: now };
      if (existing) await repo.update(existing.id, patch);
      else await repo.insert({ storeId: edge.storeId, host, rtspPort, ...patch });
      accepted++;
    }
    return { accepted };
  }
}
