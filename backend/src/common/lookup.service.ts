import { Injectable } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { chunks } from './bulk';
import { Region } from '../modules/regions/entities/region.entity';
import { Store } from '../modules/stores/entities/store.entity';
import { User } from '../modules/users/entities/user.entity';

/** Batched name lookups for response mapping (storeName, regionName, assigneeName, ...). */
@Injectable()
export class LookupService {
  constructor(private readonly ds: DataSource) {}

  async storeNames(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((x): x is number => !!x))];
    const m = new Map<number, string>();
    if (!uniq.length) return m;
    for (const part of chunks(uniq, 1000)) for (const s of await this.ds.getRepository(Store).find({ select: { id: true, name: true }, where: { id: In(part) } })) m.set(s.id, s.name);
    return m;
  }

  async stores(ids?: number[]): Promise<Map<number, Store & { regionName: string }>> {
    const stores: Store[] = [];
    if (!ids) stores.push(...(await this.ds.getRepository(Store).find()));
    else for (const part of chunks(ids.length ? ids : [-1], 1000)) stores.push(...(await this.ds.getRepository(Store).find({ where: { id: In(part) } })));
    const regions = new Map((await this.ds.getRepository(Region).find()).map((r) => [r.id, r.name]));
    return new Map(stores.map((s) => [s.id, Object.assign(s, { regionName: regions.get(s.regionId) ?? '' })]));
  }

  async userNames(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((x): x is number => !!x))];
    const m = new Map<number, string>();
    if (!uniq.length) return m;
    // SQL Server allows at most 2100 parameters per statement: chunk id lists
    for (const part of chunks(uniq, 1000)) for (const u of await this.ds.getRepository(User).find({ select: { id: true, name: true }, where: { id: In(part) } })) m.set(u.id, u.name);
    return m;
  }
}
