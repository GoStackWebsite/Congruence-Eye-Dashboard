import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Store } from '../modules/stores/entities/store.entity';
import { AuthUser, isAdmin } from './roles';

/**
 * Store scoping used by every service: admins see all stores, everyone else only user.storeIds.
 * Lists silently drop out-of-scope ids; single-store requests get 403.
 */
@Injectable()
export class StoreScopeService {
  constructor(private readonly ds: DataSource) {}

  async allStoreIds(activeOnly = true): Promise<number[]> {
    const rows = await this.ds.getRepository(Store).find({
      select: { id: true },
      where: activeOnly ? { isActive: true } : {},
      order: { id: 'ASC' },
    });
    return rows.map((r) => r.id);
  }

  /** Store ids the user may see, intersected with the requested ids (if any). */
  async resolve(user: AuthUser, requested?: number[], activeOnly = true): Promise<number[]> {
    const base = isAdmin(user.role) ? await this.allStoreIds(activeOnly) : [...user.storeIds].sort((a, b) => a - b);
    if (!requested || !requested.length) return base;
    const set = new Set(requested);
    return base.filter((id) => set.has(id));
  }

  canAccess(user: AuthUser, storeId: number | null | undefined): boolean {
    if (storeId === null || storeId === undefined) return true;
    return isAdmin(user.role) || user.storeIds.includes(Number(storeId));
  }

  assert(user: AuthUser, storeId: number | null | undefined): void {
    if (!this.canAccess(user, storeId)) throw new ForbiddenException('Store is outside your scope');
  }

  /** Asserts scope and that the store exists; returns it. */
  async assertStore(user: AuthUser, storeId: number): Promise<Store> {
    this.assert(user, storeId);
    const s = await this.ds.getRepository(Store).findOne({ where: { id: storeId } });
    if (!s) throw new NotFoundException('Store not found');
    return s;
  }

  async storeMap(ids?: number[]): Promise<Map<number, Store>> {
    const repo = this.ds.getRepository(Store);
    const stores = await repo.find({ relations: { region: true } });
    const m = new Map<number, Store>();
    for (const s of stores) if (!ids || ids.includes(s.id)) m.set(s.id, s);
    return m;
  }
}
