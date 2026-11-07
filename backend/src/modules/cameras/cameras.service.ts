import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In, Not } from 'typeorm';
import { toIso } from '../../common/db-types';
import { parseIntOpt } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { uploadDir } from '../../config/database.config';
import { CreateCameraDto, UpdateCameraDto } from './dto/camera.dto';
import { Camera } from './entities/camera.entity';
import { Snapshot } from '../media/entities/snapshot.entity';
import { Recorder } from '../recorders/entities/recorder.entity';
import { maskedChannelUrl } from '../recorders/recorder-links';

type LinkInput = { recorderId?: number | null; channel?: number | null; streamProfile?: string | null; rtspUrl?: string };

@Injectable()
export class CamerasService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Camera);
  }

  static view(c: Camera) {
    return {
      id: c.id,
      storeId: c.storeId,
      name: c.name,
      rtspUrl: c.rtspUrl,
      type: c.type,
      status: c.status,
      lastHeartbeatAt: toIso(c.lastHeartbeatAt),
      isActive: c.isActive,
      fps: c.fps ?? null,
      recorderId: c.recorderId ?? null,
      channel: c.channel ?? null,
      streamProfile: c.streamProfile ?? null,
    };
  }

  /**
   * Applies recorderId / channel / streamProfile from a create or update body to the camera.
   * A linked camera's rtspUrl is the masked recorder URL (the real one only goes to the edge).
   */
  private async applyLink(c: Camera, dto: LinkInput) {
    const touched = dto.recorderId !== undefined || dto.channel !== undefined || dto.streamProfile !== undefined;
    if (!touched && !c.recorderId) return;
    const recorderId = dto.recorderId !== undefined ? dto.recorderId : c.recorderId;
    if (!recorderId) {
      if (c.recorderId && dto.rtspUrl === undefined) c.rtspUrl = '';
      c.recorderId = null;
      c.channel = null;
      c.streamProfile = null;
      return;
    }
    const r = await this.ds.getRepository(Recorder).findOne({ where: { id: recorderId } });
    if (!r) throw new BadRequestException('Unknown recorderId');
    if (r.storeId !== c.storeId) throw new BadRequestException('The recorder belongs to another store');
    const channel = dto.channel !== undefined ? dto.channel : c.channel;
    if (!channel) throw new BadRequestException('channel is required for a camera on a recorder');
    if (channel > r.channels) throw new BadRequestException(`channel must be ≤ ${r.channels} (the recorder's channel count)`);
    const clash = await this.repo.findOne({ where: { recorderId: r.id, channel, isActive: true, ...(c.id ? { id: Not(c.id) } : {}) } });
    if (clash) throw new ConflictException(`Channel ${channel} is already linked to camera "${clash.name}"`);
    c.recorderId = r.id;
    c.channel = channel;
    c.streamProfile = (dto.streamProfile !== undefined ? dto.streamProfile : c.streamProfile) || r.stream || 'MAIN';
    c.rtspUrl = maskedChannelUrl(r, channel, c.streamProfile);
  }

  static snapshotPath(cameraId: number) {
    return path.join(uploadDir(), 'snapshots', `camera-${cameraId}.jpg`);
  }

  async list(user: AuthUser, storeId?: unknown) {
    const sid = parseIntOpt(storeId);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    const rows = await this.repo.find({ where: { storeId: In(ids) }, order: { storeId: 'ASC', id: 'ASC' } });
    return rows.map(CamerasService.view);
  }

  async find(user: AuthUser, id: number): Promise<Camera> {
    const c = await this.repo.findOne({ where: { id } });
    if (!c) throw new NotFoundException('Camera not found');
    this.scope.assert(user, c.storeId);
    return c;
  }

  async get(user: AuthUser, id: number) {
    return CamerasService.view(await this.find(user, id));
  }

  async create(user: AuthUser, dto: CreateCameraDto) {
    await this.scope.assertStore(user, dto.storeId);
    const { recorderId, channel, streamProfile, ...rest } = dto;
    const c = this.repo.create({ ...rest, rtspUrl: dto.rtspUrl ?? '', status: 'UNKNOWN', recorderId: null, channel: null, streamProfile: null });
    await this.applyLink(c, { recorderId, channel, streamProfile, rtspUrl: dto.rtspUrl });
    return CamerasService.view(await this.repo.save(c));
  }

  async update(user: AuthUser, id: number, dto: UpdateCameraDto) {
    const c = await this.find(user, id);
    const { recorderId, channel, streamProfile, ...rest } = dto;
    Object.assign(c, rest);
    await this.applyLink(c, { recorderId, channel, streamProfile, rtspUrl: dto.rtspUrl });
    return CamerasService.view(await this.repo.save(c));
  }

  /** Soft delete (deactivate) to keep the event history consistent. */
  async remove(user: AuthUser, id: number) {
    const c = await this.find(user, id);
    c.isActive = false;
    // frees the DVR channel (the masked URL is kept for reference)
    c.recorderId = null;
    c.channel = null;
    await this.repo.save(c);
    return { ok: true };
  }

  /** Latest snapshot file of the camera, or null when it has none yet (the controller answers 204). */
  async snapshot(user: AuthUser, id: number): Promise<string | null> {
    await this.find(user, id);
    const latest = await this.ds.getRepository(Snapshot).findOne({ where: { cameraId: id }, order: { ts: 'DESC', id: 'DESC' } });
    if (latest && fs.existsSync(path.join(uploadDir(), latest.filePath))) return path.join(uploadDir(), latest.filePath);
    const p = CamerasService.snapshotPath(id);
    return fs.existsSync(p) ? p : null;
  }
}
