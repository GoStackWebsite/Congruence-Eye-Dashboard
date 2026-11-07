import { Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { parseIntOpt } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { CreateEdgeDeviceDto } from './dto/edge-device.dto';
import { EdgeDevice } from './entities/edge-device.entity';

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');
export const keyPrefix = (key: string) => key.slice(0, 8);
/** Deterministic development key seeded for every store. */
export const devKeyFor = (storeId: number) => `dev-edge-key-store-${storeId}`;

@Injectable()
export class EdgeDevicesService {
  private lastSeenWrite = new Map<number, number>();
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
  ) {}
  private get repo() {
    return this.ds.getRepository(EdgeDevice);
  }

  static view(d: EdgeDevice, apiKey?: string) {
    const v: Record<string, unknown> = {
      id: d.id,
      storeId: d.storeId,
      name: d.name,
      lastSeenAt: toIso(d.lastSeenAt),
      version: d.version ?? null,
      apiKeyPrefix: d.apiKeyPrefix,
      createdAt: toIso(d.createdAt),
    };
    if (apiKey) v.apiKey = apiKey;
    return v;
  }

  static newKey() {
    return 'ce_' + randomBytes(24).toString('hex');
  }

  async authenticate(key: string): Promise<EdgeDevice | null> {
    const d = await this.repo.findOne({ where: { apiKeyHash: hashKey(key) } });
    if (!d) return null;
    const now = Date.now();
    // throttle lastSeenAt writes to once per 30s per device
    if ((this.lastSeenWrite.get(d.id) ?? 0) < now - 30000) {
      this.lastSeenWrite.set(d.id, now);
      await this.repo.update(d.id, { lastSeenAt: new Date(now) });
    }
    return d;
  }

  async touch(id: number, version?: string) {
    const patch: Partial<EdgeDevice> = { lastSeenAt: new Date() };
    if (version) patch.version = version;
    await this.repo.update(id, patch);
  }

  async list(user: AuthUser, storeId?: unknown) {
    const sid = parseIntOpt(storeId);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    const rows = await this.repo.find({ where: { storeId: In(ids) }, order: { id: 'ASC' } });
    return rows.map((d) => EdgeDevicesService.view(d));
  }

  async create(user: AuthUser, dto: CreateEdgeDeviceDto, presetKey?: string) {
    await this.scope.assertStore(user, dto.storeId);
    const apiKey = presetKey ?? EdgeDevicesService.newKey();
    const d = await this.repo.save(
      this.repo.create({ storeId: dto.storeId, name: dto.name, apiKeyHash: hashKey(apiKey), apiKeyPrefix: keyPrefix(apiKey) }),
    );
    return EdgeDevicesService.view(d, apiKey);
  }

  private async find(user: AuthUser, id: number) {
    const d = await this.repo.findOne({ where: { id } });
    if (!d) throw new NotFoundException('Edge device not found');
    this.scope.assert(user, d.storeId);
    return d;
  }

  async remove(user: AuthUser, id: number) {
    await this.find(user, id);
    await this.repo.delete(id);
    return { ok: true };
  }

  async rotate(user: AuthUser, id: number) {
    const d = await this.find(user, id);
    const apiKey = EdgeDevicesService.newKey();
    d.apiKeyHash = hashKey(apiKey);
    d.apiKeyPrefix = keyPrefix(apiKey);
    await this.repo.save(d);
    return { apiKey };
  }
}
