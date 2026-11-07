import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, FindOptionsWhere, In } from 'typeorm';
import { parseIntOpt } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { Camera } from '../cameras/entities/camera.entity';
import { CreateZoneDto, UpdateZoneDto } from './dto/zone.dto';
import { Zone } from './entities/zone.entity';
import { Snapshot } from '../media/entities/snapshot.entity';

@Injectable()
export class ZonesService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Zone);
  }

  static view(z: Zone) {
    return {
      id: z.id,
      storeId: z.storeId,
      cameraId: z.cameraId,
      name: z.name,
      type: z.type,
      polygon: z.polygon,
      inDirection: z.inDirection ?? null,
      engagedDwellSec: z.engagedDwellSec,
      queueAlertLength: z.queueAlertLength ?? null,
      queueAlertWaitSec: z.queueAlertWaitSec ?? null,
      referenceSnapshotId: z.referenceSnapshotId ?? null,
      isActive: z.isActive,
    };
  }

  static validatePolygon(type: string, polygon: unknown) {
    if (!Array.isArray(polygon)) throw new BadRequestException('polygon must be an array of [x,y] points');
    for (const p of polygon) {
      if (!Array.isArray(p) || p.length !== 2 || p.some((v) => typeof v !== 'number' || v < 0 || v > 1 || !isFinite(v))) {
        throw new BadRequestException('polygon points must be [x,y] with normalised coordinates 0..1');
      }
    }
    if (type === 'ENTRY_LINE' && polygon.length !== 2) throw new BadRequestException('ENTRY_LINE requires exactly 2 points');
    if (type !== 'ENTRY_LINE' && polygon.length < 3) throw new BadRequestException('polygon requires at least 3 points');
  }

  async list(user: AuthUser, storeId?: unknown, cameraId?: unknown) {
    const sid = parseIntOpt(storeId);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    const where: FindOptionsWhere<Zone> = { storeId: In(ids) };
    const cid = parseIntOpt(cameraId);
    if (cid) where.cameraId = cid;
    const rows = await this.repo.find({ where, order: { storeId: 'ASC', id: 'ASC' } });
    return rows.map(ZonesService.view);
  }

  private async find(user: AuthUser, id: number) {
    const z = await this.repo.findOne({ where: { id } });
    if (!z) throw new NotFoundException('Zone not found');
    this.scope.assert(user, z.storeId);
    return z;
  }

  private async checkCamera(storeId: number, cameraId: number) {
    const c = await this.ds.getRepository(Camera).findOne({ where: { id: cameraId } });
    if (!c || c.storeId !== storeId) throw new BadRequestException('cameraId does not belong to the store');
  }

  private async checkSnapshot(storeId: number, snapshotId?: number | null) {
    if (!snapshotId) return;
    const s = await this.ds.getRepository(Snapshot).findOne({ where: { id: snapshotId } });
    if (!s || s.storeId !== storeId) throw new BadRequestException('referenceSnapshotId does not belong to the store');
  }

  async create(user: AuthUser, dto: CreateZoneDto) {
    await this.scope.assertStore(user, dto.storeId);
    await this.checkSnapshot(dto.storeId, dto.referenceSnapshotId);
    await this.checkCamera(dto.storeId, dto.cameraId);
    ZonesService.validatePolygon(dto.type, dto.polygon);
    const z = await this.repo.save(
      this.repo.create({ ...dto, inDirection: dto.type === 'ENTRY_LINE' ? (dto.inDirection ?? 'UP') : null, engagedDwellSec: dto.engagedDwellSec ?? 30 }),
    );
    return ZonesService.view(z);
  }

  async update(user: AuthUser, id: number, dto: UpdateZoneDto) {
    const z = await this.find(user, id);
    if (dto.cameraId) await this.checkCamera(z.storeId, dto.cameraId);
    await this.checkSnapshot(z.storeId, dto.referenceSnapshotId);
    const type = dto.type ?? z.type;
    if (dto.polygon || dto.type) ZonesService.validatePolygon(type, dto.polygon ?? z.polygon);
    Object.assign(z, dto);
    return ZonesService.view(await this.repo.save(z));
  }

  async remove(user: AuthUser, id: number) {
    const z = await this.find(user, id);
    z.isActive = false;
    await this.repo.save(z);
    return { ok: true };
  }
}
