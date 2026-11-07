import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { CamerasService } from '../cameras/cameras.service';
import { Camera } from '../cameras/entities/camera.entity';
import { Region } from '../regions/entities/region.entity';
import { Zone } from '../zones/entities/zone.entity';
import { ZonesService } from '../zones/zones.service';
import { CreateStoreDto, UpdateStoreDto } from './dto/store.dto';
import { Store } from './entities/store.entity';

export function storeView(s: Store, regionName?: string) {
  return {
    id: s.id,
    code: s.code,
    name: s.name,
    regionId: s.regionId,
    regionName: regionName ?? s.region?.name ?? '',
    city: s.city,
    address: s.address,
    timezone: s.timezone,
    openTime: s.openTime,
    closeTime: s.closeTime,
    areaSqft: s.areaSqft,
    format: s.format ?? 'HIGH_STREET',
    isActive: s.isActive,
    latitude: s.latitude ?? null,
    longitude: s.longitude ?? null,
    createdAt: toIso(s.createdAt),
  };
}

@Injectable()
export class StoresService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Store);
  }

  async list(user: AuthUser) {
    const ids = await this.scope.resolve(user, undefined, false);
    if (!ids.length) return [];
    const rows = await this.repo.find({ where: { id: In(ids) }, relations: { region: true }, order: { id: 'ASC' } });
    return rows.map((s) => storeView(s));
  }

  async get(user: AuthUser, id: number) {
    this.scope.assert(user, id);
    const s = await this.repo.findOne({ where: { id }, relations: { region: true } });
    if (!s) throw new NotFoundException('Store not found');
    const cameras = await this.ds.getRepository(Camera).find({ where: { storeId: id }, order: { id: 'ASC' } });
    const zones = await this.ds.getRepository(Zone).find({ where: { storeId: id }, order: { id: 'ASC' } });
    return { ...storeView(s), cameras: cameras.map(CamerasService.view), zones: zones.map(ZonesService.view) };
  }

  private async checkRegion(regionId?: number) {
    if (regionId === undefined) return;
    if (!(await this.ds.getRepository(Region).findOne({ where: { id: regionId } }))) throw new BadRequestException('Unknown regionId');
  }

  private checkTz(tz?: string) {
    if (!tz) return;
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz });
    } catch {
      throw new BadRequestException('Invalid timezone');
    }
  }

  async create(dto: CreateStoreDto) {
    await this.checkRegion(dto.regionId);
    this.checkTz(dto.timezone);
    if (await this.repo.findOne({ where: { code: dto.code } })) throw new ConflictException('Store code already exists');
    const s = await this.repo.save(this.repo.create({ ...dto, timezone: dto.timezone || 'Asia/Kolkata' }));
    return storeView((await this.repo.findOne({ where: { id: s.id }, relations: { region: true } }))!);
  }

  async update(id: number, dto: UpdateStoreDto) {
    const s = await this.repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Store not found');
    await this.checkRegion(dto.regionId);
    this.checkTz(dto.timezone);
    if (dto.code && dto.code !== s.code && (await this.repo.findOne({ where: { code: dto.code } }))) {
      throw new ConflictException('Store code already exists');
    }
    Object.assign(s, dto);
    await this.repo.save(s);
    return storeView((await this.repo.findOne({ where: { id }, relations: { region: true } }))!);
  }

  /** Soft delete: deactivates the store (history is kept). */
  async remove(id: number) {
    const s = await this.repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Store not found');
    s.isActive = false;
    await this.repo.save(s);
    return { ok: true };
  }
}
