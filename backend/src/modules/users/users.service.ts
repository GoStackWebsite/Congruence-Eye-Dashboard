import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { DataSource, In } from 'typeorm';
import { chunks } from '../../common/bulk';
import { toIso } from '../../common/db-types';
import { AuthUser, isAdmin, Role } from '../../common/roles';
import { Store } from '../stores/entities/store.entity';
import { CreateUserDto, UpdateUserDto } from './dto/user.dto';
import { UserStore } from './entities/user-store.entity';
import { User } from './entities/user.entity';

export interface UserView {
  id: number;
  email: string;
  name: string;
  role: string;
  isActive: boolean;
  storeIds: number[];
  createdAt: string;
}

@Injectable()
export class UsersService {
  constructor(private readonly ds: DataSource) {}

  private get repo() {
    return this.ds.getRepository(User);
  }

  async storeIdsOf(userIds: number[]): Promise<Map<number, number[]>> {
    const m = new Map<number, number[]>();
    if (!userIds.length) return m;
    const rows: UserStore[] = [];
    for (const part of chunks(userIds, 1000)) rows.push(...(await this.ds.getRepository(UserStore).find({ where: { userId: In(part) } })));
    for (const r of rows) {
      if (!m.has(r.userId)) m.set(r.userId, []);
      m.get(r.userId).push(r.storeId);
    }
    for (const v of m.values()) v.sort((a, b) => a - b);
    return m;
  }

  toView(u: User, storeIds: number[]): UserView {
    return {
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      isActive: u.isActive,
      storeIds,
      createdAt: toIso(u.createdAt),
    };
  }

  async findAuthUser(id: number): Promise<AuthUser | null> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u || !u.isActive) return null;
    const ids = (await this.storeIdsOf([id])).get(id) ?? [];
    return { id: u.id, email: u.email, name: u.name, role: u.role as Role, storeIds: ids };
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.repo.findOne({ where: { email: email.trim().toLowerCase() } });
  }

  async view(id: number): Promise<UserView> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    return this.toView(u, (await this.storeIdsOf([id])).get(id) ?? []);
  }

  async list(current: AuthUser): Promise<UserView[]> {
    const users = await this.repo.find({ order: { id: 'ASC' } });
    const map = await this.storeIdsOf(users.map((u) => u.id));
    let views = users.map((u) => this.toView(u, map.get(u.id) ?? []));
    if (!isAdmin(current.role)) {
      const mine = new Set(current.storeIds);
      views = views.filter((v) => v.id === current.id || v.storeIds.some((s) => mine.has(s)));
    }
    return views;
  }

  async get(current: AuthUser, id: number): Promise<UserView> {
    const v = await this.view(id);
    if (!isAdmin(current.role) && v.id !== current.id && !v.storeIds.some((s) => current.storeIds.includes(s))) {
      throw new NotFoundException('User not found');
    }
    return v;
  }

  private async validateStores(ids: number[]) {
    if (!ids.length) return;
    const count = await this.ds.getRepository(Store).count({ where: { id: In(ids) } });
    if (count !== ids.length) throw new BadRequestException('Unknown storeIds');
  }

  private async setStores(userId: number, storeIds: number[]) {
    await this.ds.getRepository(UserStore).delete({ userId });
    if (storeIds.length) await this.ds.getRepository(UserStore).insert(storeIds.map((storeId) => ({ userId, storeId })));
  }

  async create(dto: CreateUserDto): Promise<UserView> {
    const email = dto.email.trim().toLowerCase();
    if (await this.findByEmail(email)) throw new ConflictException('Email already exists');
    const storeIds = dto.storeIds ?? [];
    await this.validateStores(storeIds);
    const u = await this.repo.save(
      this.repo.create({
        email,
        name: dto.name,
        role: dto.role,
        passwordHash: await bcrypt.hash(dto.password, 10),
        isActive: dto.isActive ?? true,
      }),
    );
    await this.setStores(u.id, storeIds);
    return this.view(u.id);
  }

  async update(id: number, dto: UpdateUserDto): Promise<UserView> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    if (dto.email && dto.email.trim().toLowerCase() !== u.email) {
      const email = dto.email.trim().toLowerCase();
      if (await this.findByEmail(email)) throw new ConflictException('Email already exists');
      u.email = email;
    }
    if (dto.name !== undefined) u.name = dto.name;
    if (dto.role !== undefined) u.role = dto.role;
    if (dto.isActive !== undefined) u.isActive = dto.isActive;
    if (dto.password) u.passwordHash = await bcrypt.hash(dto.password, 10);
    await this.repo.save(u);
    if (dto.storeIds) {
      await this.validateStores(dto.storeIds);
      await this.setStores(id, dto.storeIds);
    }
    return this.view(id);
  }

  async deactivate(id: number): Promise<UserView> {
    const u = await this.repo.findOne({ where: { id } });
    if (!u) throw new NotFoundException('User not found');
    u.isActive = false;
    await this.repo.save(u);
    return this.view(id);
  }

  async names(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((x): x is number => !!x))];
    const m = new Map<number, string>();
    if (!uniq.length) return m;
    for (const part of chunks(uniq, 1000)) for (const r of await this.repo.find({ select: { id: true, name: true }, where: { id: In(part) } })) m.set(r.id, r.name);
    return m;
  }
}
