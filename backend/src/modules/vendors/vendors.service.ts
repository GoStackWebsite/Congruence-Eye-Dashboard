import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { parseIds, parseIntOpt } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { isDateStr, zonedToUtc } from '../../common/time.util';
import { CheckOutDto, CreateVendorDto, CreateVendorVisitDto, UpdateVendorDto, UpdateVendorVisitDto } from './dto/vendor.dto';
import { VendorVisit } from './entities/vendor-visit.entity';
import { Vendor } from './entities/vendor.entity';

@Injectable()
export class VendorsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
  ) {}

  static view(v: Vendor) {
    return { id: v.id, name: v.name, category: v.category, contactName: v.contactName, phone: v.phone, email: v.email, isActive: v.isActive };
  }

  async list() {
    return (await this.ds.getRepository(Vendor).find({ order: { name: 'ASC' } })).map(VendorsService.view);
  }
  async create(dto: CreateVendorDto) {
    const repo = this.ds.getRepository(Vendor);
    return VendorsService.view(await repo.save(repo.create({ ...dto, contactName: dto.contactName ?? '', phone: dto.phone ?? '', email: dto.email ?? '' })));
  }
  async update(id: number, dto: UpdateVendorDto) {
    const repo = this.ds.getRepository(Vendor);
    const v = await repo.findOne({ where: { id } });
    if (!v) throw new NotFoundException('Vendor not found');
    Object.assign(v, dto);
    return VendorsService.view(await repo.save(v));
  }
  async remove(id: number) {
    const repo = this.ds.getRepository(Vendor);
    const v = await repo.findOne({ where: { id } });
    if (!v) throw new NotFoundException('Vendor not found');
    if (await this.ds.getRepository(VendorVisit).count({ where: { vendorId: id } })) {
      v.isActive = false;
      await repo.save(v);
    } else await repo.delete(id);
    return { ok: true };
  }

  // ---- visits
  async visitViews(rows: VendorVisit[]) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const vendors = new Map((await this.ds.getRepository(Vendor).find()).map((v) => [v.id, v.name]));
    return rows.map((v) => ({
      id: v.id,
      vendorId: v.vendorId,
      vendorName: vendors.get(v.vendorId) ?? '',
      storeId: v.storeId,
      storeName: stores.get(v.storeId) ?? '',
      purpose: v.purpose,
      scheduledAt: toIso(v.scheduledAt),
      checkInAt: toIso(v.checkInAt),
      checkOutAt: toIso(v.checkOutAt),
      status: v.status,
      rating: v.rating ?? null,
      notes: v.notes ?? null,
    }));
  }

  async listVisits(user: AuthUser, q: Record<string, unknown>) {
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return [];
    const qb = this.ds.getRepository(VendorVisit).createQueryBuilder('v').where('v.storeId IN (:...ids)', { ids });
    const vid = parseIntOpt(q.vendorId);
    if (vid) qb.andWhere('v.vendorId = :vid', { vid });
    if (q.status) qb.andWhere('v.status IN (:...st)', { st: String(q.status).split(',') });
    if (isDateStr(q.from)) qb.andWhere('v.scheduledAt >= :from', { from: zonedToUtc(q.from, '00:00') });
    if (isDateStr(q.to)) qb.andWhere('v.scheduledAt < :to', { to: new Date(zonedToUtc(q.to, '00:00').getTime() + 86400_000) });
    qb.orderBy('v.scheduledAt', 'DESC').addOrderBy('v.id', 'DESC').take(1000);
    return this.visitViews(await qb.getMany());
  }

  private async findVisit(user: AuthUser, id: number) {
    const v = await this.ds.getRepository(VendorVisit).findOne({ where: { id } });
    if (!v) throw new NotFoundException('Vendor visit not found');
    this.scope.assert(user, v.storeId);
    return v;
  }

  async createVisit(user: AuthUser, dto: CreateVendorVisitDto) {
    await this.scope.assertStore(user, dto.storeId);
    if (!(await this.ds.getRepository(Vendor).findOne({ where: { id: dto.vendorId } }))) throw new BadRequestException('Unknown vendorId');
    const repo = this.ds.getRepository(VendorVisit);
    const v = await repo.save(
      repo.create({ vendorId: dto.vendorId, storeId: dto.storeId, purpose: dto.purpose ?? '', scheduledAt: new Date(dto.scheduledAt), notes: dto.notes ?? null, status: 'SCHEDULED', createdById: user.id }),
    );
    return (await this.visitViews([v]))[0];
  }

  async updateVisit(user: AuthUser, id: number, dto: UpdateVendorVisitDto) {
    const v = await this.findVisit(user, id);
    if (dto.purpose !== undefined) v.purpose = dto.purpose;
    if (dto.scheduledAt) v.scheduledAt = new Date(dto.scheduledAt);
    if (dto.status) v.status = dto.status;
    if (dto.rating !== undefined) v.rating = dto.rating;
    if (dto.notes !== undefined) v.notes = dto.notes;
    await this.ds.getRepository(VendorVisit).save(v);
    return (await this.visitViews([v]))[0];
  }

  async checkIn(user: AuthUser, id: number) {
    const v = await this.findVisit(user, id);
    if (v.status !== 'SCHEDULED' && v.status !== 'MISSED') throw new ConflictException(`Cannot check in a ${v.status} visit`);
    v.status = 'CHECKED_IN';
    v.checkInAt = new Date();
    await this.ds.getRepository(VendorVisit).save(v);
    return (await this.visitViews([v]))[0];
  }

  async checkOut(user: AuthUser, id: number, dto: CheckOutDto) {
    const v = await this.findVisit(user, id);
    if (v.status !== 'CHECKED_IN') throw new ConflictException('Visit is not checked in');
    v.status = 'COMPLETED';
    v.checkOutAt = new Date();
    if (dto.rating !== undefined) v.rating = dto.rating;
    if (dto.notes !== undefined) v.notes = dto.notes;
    await this.ds.getRepository(VendorVisit).save(v);
    return (await this.visitViews([v]))[0];
  }
}
