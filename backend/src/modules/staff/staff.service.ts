import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { parseIntOpt } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { CreateStaffDto, UpdateStaffDto } from './dto/staff.dto';
import { Staff } from './entities/staff.entity';

@Injectable()
export class StaffService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Staff);
  }
  static view(s: Staff) {
    return {
      id: s.id,
      storeId: s.storeId,
      code: s.code,
      name: s.name,
      designation: s.designation,
      shiftStart: s.shiftStart,
      shiftEnd: s.shiftEnd,
      isActive: s.isActive,
    };
  }

  async list(user: AuthUser, storeId?: unknown) {
    const sid = parseIntOpt(storeId);
    if (sid) this.scope.assert(user, sid);
    const ids = await this.scope.resolve(user, sid ? [sid] : undefined, false);
    if (!ids.length) return [];
    return (await this.repo.find({ where: { storeId: In(ids) }, order: { storeId: 'ASC', code: 'ASC' } })).map(StaffService.view);
  }

  async create(user: AuthUser, dto: CreateStaffDto) {
    await this.scope.assertStore(user, dto.storeId);
    if (await this.repo.findOne({ where: { storeId: dto.storeId, code: dto.code } })) throw new ConflictException('Staff code exists');
    return StaffService.view(await this.repo.save(this.repo.create(dto)));
  }

  private async find(user: AuthUser, id: number) {
    const s = await this.repo.findOne({ where: { id } });
    if (!s) throw new NotFoundException('Staff not found');
    this.scope.assert(user, s.storeId);
    return s;
  }

  async update(user: AuthUser, id: number, dto: UpdateStaffDto) {
    const s = await this.find(user, id);
    Object.assign(s, dto);
    return StaffService.view(await this.repo.save(s));
  }

  async remove(user: AuthUser, id: number) {
    await this.find(user, id);
    await this.repo.delete(id);
    return { ok: true };
  }
}
