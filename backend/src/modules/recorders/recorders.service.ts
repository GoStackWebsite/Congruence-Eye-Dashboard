import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DataSource, In, IsNull, Not } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { parseIntOpt } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { CamerasService } from '../cameras/cameras.service';
import { Camera } from '../cameras/entities/camera.entity';
import { CreateRecorderDto, GenerateCamerasDto, UpdateRecorderDto } from './dto/recorder.dto';
import { DiscoveredDevice } from './entities/discovered-device.entity';
import { Probe } from './entities/probe.entity';
import { Recorder } from './entities/recorder.entity';
import { encryptSecret, recorderSecretIsDefault } from './recorder-crypto';
import { maskedChannelUrl, profileOf } from './recorder-links';
import { BRANDS, brandInfo, customTemplateError } from './recorder-url';

export function recorderView(r: Recorder, storeName: string, camerasLinked: number) {
  return {
    id: r.id,
    storeId: r.storeId,
    storeName,
    name: r.name,
    kind: r.kind,
    brand: r.brand,
    host: r.host,
    rtspPort: r.rtspPort,
    httpPort: r.httpPort,
    username: r.username,
    hasPassword: !!r.passwordEnc,
    channels: r.channels,
    stream: r.stream,
    urlTemplate: r.urlTemplate ?? null,
    status: r.status || 'UNKNOWN',
    lastCheckedAt: toIso(r.lastCheckedAt),
    camerasLinked,
    createdAt: toIso(r.createdAt),
  };
}

@Injectable()
export class RecordersService implements OnModuleInit {
  private readonly log = new Logger(RecordersService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
  ) {}

  onModuleInit() {
    if (recorderSecretIsDefault() && process.env.NODE_ENV !== 'test') {
      this.log.warn('RECORDER_SECRET is not set: recorder passwords are encrypted with the development key. Set RECORDER_SECRET in production.');
    }
  }

  private get repo() {
    return this.ds.getRepository(Recorder);
  }

  brands() {
    return BRANDS.map((b) => ({ ...b }));
  }

  private async linkedCounts(ids: number[]): Promise<Map<number, number>> {
    const m = new Map<number, number>();
    if (!ids.length) return m;
    const cams = await this.ds.getRepository(Camera).find({ select: { id: true, recorderId: true }, where: { recorderId: In(ids), isActive: true } });
    for (const c of cams) m.set(c.recorderId!, (m.get(c.recorderId!) ?? 0) + 1);
    return m;
  }

  async views(rows: Recorder[]) {
    const names = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const counts = await this.linkedCounts(rows.map((r) => r.id));
    return rows.map((r) => recorderView(r, names.get(r.storeId) ?? '', counts.get(r.id) ?? 0));
  }

  async list(user: AuthUser, storeId?: unknown) {
    const sid = parseIntOpt(storeId);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    return this.views(await this.repo.find({ where: { storeId: In(ids) }, order: { storeId: 'ASC', id: 'ASC' } }));
  }

  async find(user: AuthUser, id: number): Promise<Recorder> {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Recorder not found');
    this.scope.assert(user, r.storeId);
    return r;
  }

  async get(user: AuthUser, id: number) {
    return (await this.views([await this.find(user, id)]))[0];
  }

  /** Cross-field rules shared by create and update (on the merged record). */
  private async check(r: Recorder) {
    if (r.brand === 'CUSTOM') {
      const err = customTemplateError(r.urlTemplate);
      if (err) throw new BadRequestException([err]);
      r.urlTemplate = r.urlTemplate!.trim();
    } else {
      r.urlTemplate = null;
    }
    r.host = r.host.trim().toLowerCase();
    const dup = await this.repo.findOne({ where: { storeId: r.storeId, host: r.host, rtspPort: r.rtspPort, ...(r.id ? { id: Not(r.id) } : {}) } });
    if (dup) throw new ConflictException(`Recorder "${dup.name}" already uses ${r.host}:${r.rtspPort} in this store`);
    if (r.id) {
      const over = await this.ds.getRepository(Camera).findOne({ where: { recorderId: r.id, isActive: true, channel: Not(IsNull()) }, order: { channel: 'DESC' } });
      if (over && over.channel! > r.channels) {
        throw new BadRequestException([`channels must be ≥ ${over.channel}: channel ${over.channel} is linked to camera "${over.name}"`]);
      }
    }
  }

  async create(user: AuthUser, dto: CreateRecorderDto) {
    await this.scope.assertStore(user, dto.storeId);
    const r = this.repo.create({
      storeId: dto.storeId,
      name: dto.name,
      kind: dto.kind,
      brand: dto.brand,
      host: dto.host,
      rtspPort: dto.rtspPort ?? brandInfo(dto.brand)?.defaultRtspPort ?? 554,
      httpPort: dto.httpPort ?? 80,
      username: dto.username ?? '',
      passwordEnc: dto.password ? encryptSecret(dto.password) : null,
      channels: dto.channels,
      stream: dto.stream ?? 'MAIN',
      urlTemplate: dto.urlTemplate ?? null,
      status: 'UNKNOWN',
      lastCheckedAt: null,
    });
    await this.check(r);
    return (await this.views([await this.repo.save(r)]))[0];
  }

  async update(user: AuthUser, id: number, dto: UpdateRecorderDto) {
    const r = await this.find(user, id);
    const { password, ...rest } = dto;
    for (const [k, v] of Object.entries(rest)) if (v !== undefined) (r as unknown as Record<string, unknown>)[k] = v;
    // password: omitted or "" keeps it, null clears it, a value replaces it
    if (password === null) r.passwordEnc = null;
    else if (password) r.passwordEnc = encryptSecret(password);
    await this.check(r);
    await this.repo.save(r);
    await this.refreshCameraUrls(r);
    return (await this.views([r]))[0];
  }

  /** Recomputes the masked rtspUrl of every camera linked to the recorder (after host / brand / login changes). */
  async refreshCameraUrls(r: Recorder) {
    const cams = await this.ds.getRepository(Camera).find({ where: { recorderId: r.id } });
    for (const c of cams) {
      if (!c.channel) continue;
      const url = maskedChannelUrl(r, c.channel, profileOf(c, r));
      if (url !== c.rtspUrl) await this.ds.getRepository(Camera).update(c.id, { rtspUrl: url });
    }
  }

  async remove(user: AuthUser, id: number, unlinkCameras: boolean) {
    const r = await this.find(user, id);
    const cams = await this.ds.getRepository(Camera).find({ where: { recorderId: r.id } });
    const active = cams.filter((c) => c.isActive);
    if (active.length && !unlinkCameras) {
      throw new ConflictException(`${active.length} camera(s) are linked to this recorder. Unlink them first or delete with ?unlinkCameras=true`);
    }
    await this.ds.transaction(async (m) => {
      for (const c of cams) {
        // the masked URL is meaningless without the recorder; an active camera is left without a URL
        await m.getRepository(Camera).update(c.id, { recorderId: null, channel: null, streamProfile: null, ...(c.isActive ? { rtspUrl: '' } : {}) });
      }
      await m.getRepository(Probe).delete({ recorderId: r.id });
      await m.getRepository(Recorder).delete(r.id);
    });
    return { ok: true };
  }

  /** Idempotent per channel: an already-linked channel returns its camera instead of a duplicate. */
  async generateCameras(user: AuthUser, id: number, dto: GenerateCamerasDto) {
    const r = await this.find(user, id);
    const channels = [...new Set(dto.channels)];
    const bad = channels.filter((ch) => ch > r.channels);
    if (bad.length) throw new BadRequestException([`channel numbers must be ≤ ${r.channels} (got ${bad.join(', ')})`]);
    const repo = this.ds.getRepository(Camera);
    const existing = new Map((await repo.find({ where: { recorderId: r.id, isActive: true } })).map((c) => [c.channel, c]));
    const out: Camera[] = [];
    const prefix = (dto.namePrefix ?? '').trim() || 'Channel';
    for (const ch of channels) {
      const have = existing.get(ch);
      if (have) {
        out.push(have);
        continue;
      }
      const profile = r.stream || 'MAIN';
      const c = await repo.save(
        repo.create({
          storeId: r.storeId, name: `${prefix} ${ch}`.slice(0, 150), type: dto.type ?? 'GENERAL', status: 'UNKNOWN', isActive: true,
          recorderId: r.id, channel: ch, streamProfile: profile, rtspUrl: maskedChannelUrl(r, ch, profile),
        }),
      );
      existing.set(ch, c);
      out.push(c);
    }
    return out.map(CamerasService.view);
  }

  async discovered(user: AuthUser, storeId?: unknown) {
    const sid = parseIntOpt(storeId);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    const rows = await this.ds.getRepository(DiscoveredDevice).find({ where: { storeId: In(ids) }, order: { seenAt: 'DESC', id: 'DESC' } });
    return rows.map((d) => ({ host: d.host, rtspPort: d.rtspPort, httpPort: d.httpPort ?? null, brandGuess: d.brandGuess ?? null, onvif: !!d.onvif, seenAt: toIso(d.seenAt) }));
  }
}
