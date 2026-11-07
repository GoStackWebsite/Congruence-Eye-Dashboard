import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { AuthUser, isAdmin } from '../../common/roles';
import { Store } from '../stores/entities/store.entity';
import { Region } from './entities/region.entity';

@Injectable()
export class RegionsService {
  constructor(private readonly ds: DataSource) {}
  private get repo() {
    return this.ds.getRepository(Region);
  }
  private view = (r: Region) => ({ id: r.id, name: r.name });

  async list(user: AuthUser) {
    const rows = await this.repo.find({ order: { name: 'ASC' } });
    if (isAdmin(user.role)) return rows.map(this.view);
    const stores = await this.ds.getRepository(Store).find({ select: { id: true, regionId: true } });
    const regionIds = new Set(stores.filter((s) => user.storeIds.includes(s.id)).map((s) => s.regionId));
    return rows.filter((r) => regionIds.has(r.id)).map(this.view);
  }

  async create(name: string) {
    if (await this.repo.findOne({ where: { name } })) throw new ConflictException('Region already exists');
    return this.view(await this.repo.save(this.repo.create({ name })));
  }

  async update(id: number, name: string) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Region not found');
    r.name = name;
    return this.view(await this.repo.save(r));
  }

  async remove(id: number) {
    const r = await this.repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Region not found');
    if (await this.ds.getRepository(Store).count({ where: { regionId: id } })) {
      throw new ConflictException('Region has stores; move or delete them first');
    }
    await this.repo.delete(id);
    return { ok: true };
  }
}
