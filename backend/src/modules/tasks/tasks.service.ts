import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { parseBool, parseIds, parseIntOpt, qstr } from '../../common/paging';
import { AuthUser, isManagerPlus } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { User } from '../users/entities/user.entity';
import { Zone } from '../zones/entities/zone.entity';
import { BulkTaskDto, CreateTaskDto, UpdateTaskDto } from './dto/task.dto';
import { UserStore } from '../users/entities/user-store.entity';
import { Task } from './entities/task.entity';

/** Assignee must exist, be active and work at the store (admins work everywhere). 400 otherwise. */
export async function assertAssignee(ds: DataSource, assigneeId: number, storeId: number) {
  const u = await ds.getRepository(User).findOne({ where: { id: assigneeId } });
  if (!u) throw new BadRequestException('Unknown assigneeId');
  if (!u.isActive) throw new BadRequestException('Assignee is inactive');
  if (u.role === 'SUPER_ADMIN' || u.role === 'ADMIN') return;
  if (!(await ds.getRepository(UserStore).findOne({ where: { userId: assigneeId, storeId } }))) throw new BadRequestException('Assignee is not assigned to this store');
}

@Injectable()
export class TasksService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Task);
  }

  async views(rows: Task[]) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const users = await this.lookup.userNames(rows.flatMap((r) => [r.assigneeId, r.createdById]));
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      description: t.description,
      storeId: t.storeId,
      storeName: stores.get(t.storeId) ?? '',
      zoneId: t.zoneId ?? null,
      type: t.type,
      priority: t.priority,
      status: t.status,
      assigneeId: t.assigneeId ?? null,
      assigneeName: t.assigneeId ? (users.get(t.assigneeId) ?? '') : null,
      createdById: t.createdById,
      createdByName: users.get(t.createdById) ?? '',
      dueAt: toIso(t.dueAt),
      completedAt: toIso(t.completedAt),
      verifiedAt: toIso(t.verifiedAt),
      createdAt: toIso(t.createdAt),
      startAt: toIso(t.startAt),
      checklistAnswerId: t.checklistAnswerId ?? null,
      proofUrl: t.proofUrl ?? null,
      remark: t.remark ?? null,
    }));
  }

  async list(user: AuthUser, q: Record<string, unknown>) {
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return [];
    const qb = this.repo.createQueryBuilder('t').where('t.storeId IN (:...ids)', { ids });
    if (q.status) qb.andWhere('t.status IN (:...st)', { st: String(q.status).split(',') });
    const aid = parseIntOpt(q.assigneeId);
    if (aid) qb.andWhere('t.assigneeId = :aid', { aid });
    if (parseBool(q.mine)) {
      // scheduled visibility: the assignee sees a task from its startAt
      qb.andWhere('t.assigneeId = :me', { me: user.id }).andWhere('(t.startAt IS NULL OR t.startAt <= :now)', { now: new Date() });
    }
    if (q.type) qb.andWhere('t.type = :type', { type: qstr(q.type) });
    qb.orderBy('t.id', 'DESC').take(1000);
    return this.views(await qb.getMany());
  }

  private async find(user: AuthUser, id: number) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Task not found');
    this.scope.assert(user, t.storeId);
    return t;
  }

  async get(user: AuthUser, id: number) {
    return (await this.views([await this.find(user, id)]))[0];
  }

  private async validateRefs(storeId: number, zoneId?: number | null, assigneeId?: number | null) {
    if (zoneId) {
      const z = await this.ds.getRepository(Zone).findOne({ where: { id: zoneId } });
      if (!z || z.storeId !== storeId) throw new BadRequestException('zoneId does not belong to the store');
    }
    if (assigneeId) await assertAssignee(this.ds, assigneeId, storeId);
  }

  async create(user: AuthUser, dto: CreateTaskDto, createdAt?: Date) {
    await this.scope.assertStore(user, dto.storeId);
    await this.validateRefs(dto.storeId, dto.zoneId, dto.assigneeId);
    if (dto.type === 'ZONE_ALLOCATION' && !dto.zoneId) throw new BadRequestException('ZONE_ALLOCATION tasks require zoneId');
    const t = await this.repo.save(
      this.repo.create({
        title: dto.title,
        description: dto.description ?? '',
        storeId: dto.storeId,
        zoneId: dto.zoneId ?? null,
        type: dto.type ?? 'GENERAL',
        priority: dto.priority ?? 'MEDIUM',
        status: 'TODO',
        assigneeId: dto.assigneeId ?? null,
        createdById: user.id,
        dueAt: dto.dueAt ? new Date(dto.dueAt) : null,
        startAt: dto.startAt ? new Date(dto.startAt) : null,
        ...(createdAt ? { createdAt } : {}),
      }),
    );
    return (await this.views([t]))[0];
  }

  private applyStatus(t: Task, status: string, user: AuthUser) {
    if (status === 'VERIFIED') {
      if (!isManagerPlus(user.role)) throw new ForbiddenException('Only STORE_MANAGER+ can verify');
      t.verifiedAt = new Date();
      t.verifiedById = user.id;
      t.completedAt = t.completedAt ?? new Date();
    }
    if (status === 'DONE') t.completedAt = new Date();
    if (status === 'TODO' || status === 'IN_PROGRESS') {
      t.completedAt = null;
      t.verifiedAt = null;
    }
    t.status = status;
  }

  async update(user: AuthUser, id: number, dto: UpdateTaskDto) {
    const t = await this.find(user, id);
    const manager = isManagerPlus(user.role);
    const assignee = t.assigneeId === user.id;
    const onlyStatus = Object.keys(dto).every((k) => k === 'status');
    if (!manager && !(assignee && onlyStatus)) throw new ForbiddenException('Only STORE_MANAGER+ can edit tasks');
    if (dto.storeId && dto.storeId !== t.storeId) await this.scope.assertStore(user, dto.storeId);
    // moving a task to another store re-checks the existing assignee/zone too
    const movesStore = !!dto.storeId && dto.storeId !== t.storeId;
    await this.validateRefs(dto.storeId ?? t.storeId, dto.zoneId ?? (movesStore ? t.zoneId : undefined), dto.assigneeId ?? (movesStore ? t.assigneeId : undefined));
    for (const k of ['title', 'description', 'storeId', 'zoneId', 'type', 'priority', 'assigneeId'] as const) {
      if (dto[k] !== undefined) (t as unknown as Record<string, unknown>)[k] = dto[k];
    }
    if (dto.dueAt !== undefined) t.dueAt = dto.dueAt ? new Date(dto.dueAt) : null;
    if (dto.startAt !== undefined) t.startAt = dto.startAt ? new Date(dto.startAt) : null;
    if (dto.status) this.applyStatus(t, dto.status, user);
    await this.repo.save(t);
    return this.get(user, id);
  }

  async setStatus(user: AuthUser, id: number, status: string, proof: { proofUrl?: string; remark?: string } = {}) {
    const t = await this.find(user, id);
    if (!isManagerPlus(user.role) && t.assigneeId !== user.id) throw new ForbiddenException('Only the assignee or a manager can change status');
    this.applyStatus(t, status, user);
    if (proof.proofUrl !== undefined) t.proofUrl = proof.proofUrl;
    if (proof.remark !== undefined) t.remark = proof.remark;
    await this.repo.save(t);
    return this.get(user, id);
  }

  async verify(user: AuthUser, id: number) {
    const t = await this.find(user, id);
    if (t.status !== 'DONE' && t.status !== 'VERIFIED') throw new BadRequestException('Only DONE tasks can be verified');
    this.applyStatus(t, 'VERIFIED', user);
    await this.repo.save(t);
    return this.get(user, id);
  }

  /** First active STORE_MANAGER assigned to the store (by user id), or null. */
  async storeManagerOf(storeId: number): Promise<number | null> {
    const rows = await this.ds
      .getRepository(User)
      .createQueryBuilder('u')
      .innerJoin(UserStore, 'us', 'us.userId = u.id')
      .where('us.storeId = :storeId AND u.role = :role AND u.isActive = :a', { storeId, role: 'STORE_MANAGER', a: true })
      .orderBy('u.id', 'ASC')
      .getMany();
    return rows[0]?.id ?? null;
  }

  /** Same task across several stores (assignee defaults to each store's first active STORE_MANAGER). */
  async bulk(user: AuthUser, dto: BulkTaskDto) {
    const out: unknown[] = [];
    for (const storeId of [...new Set(dto.storeIds)]) await this.scope.assertStore(user, storeId);
    for (const storeId of [...new Set(dto.storeIds)]) {
      const assigneeId = dto.assigneeId ?? (await this.storeManagerOf(storeId)) ?? user.id;
      out.push(await this.create(user, { title: dto.title, description: dto.description, storeId, type: dto.type, priority: dto.priority, assigneeId, dueAt: dto.dueAt, startAt: dto.startAt }));
    }
    return out;
  }

  /** Follow-up task resolving a checklist deviation. */
  async createFromAnswer(user: AuthUser, opts: { storeId: number; answerId: number; title: string; description?: string; assigneeId: number | null; dueAt?: Date; priority?: string }) {
    await this.validateRefs(opts.storeId, null, opts.assigneeId);
    const t = await this.repo.save(
      this.repo.create({
        title: opts.title.slice(0, 200),
        description: (opts.description ?? '').slice(0, 2000),
        storeId: opts.storeId,
        type: 'FOLLOW_UP',
        priority: opts.priority ?? 'HIGH',
        status: 'TODO',
        assigneeId: opts.assigneeId,
        createdById: user.id,
        dueAt: opts.dueAt ?? new Date(Date.now() + 24 * 3600_000),
        checklistAnswerId: opts.answerId,
      }),
    );
    return (await this.views([t]))[0];
  }

  async remove(user: AuthUser, id: number) {
    await this.find(user, id);
    await this.repo.delete(id);
    return { ok: true };
  }
}
