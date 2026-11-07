import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { assertAssignee } from '../tasks/tasks.service';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { parseIds, qstr } from '../../common/paging';
import { AuthUser, isManagerPlus } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { User } from '../users/entities/user.entity';
import { CreateTicketDto, SLA_HOURS, UpdateTicketDto } from './dto/ticket.dto';
import { TicketComment } from './entities/ticket-comment.entity';
import { Ticket } from './entities/ticket.entity';

export const ticketNumber = (id: number) => `TKT-${String(id).padStart(5, '0')}`;
export const slaDue = (from: Date, priority: string) => new Date(from.getTime() + (SLA_HOURS[priority] ?? 72) * 3600_000);

@Injectable()
export class TicketsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
  ) {}
  private get repo() {
    return this.ds.getRepository(Ticket);
  }

  async views(rows: Ticket[], withComments = false) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const users = await this.lookup.userNames(rows.flatMap((r) => [r.assigneeId, r.reporterId]));
    const comments = new Map<number, unknown[]>();
    if (withComments && rows.length) {
      const cs = await this.ds.getRepository(TicketComment).find({ where: { ticketId: In(rows.map((r) => r.id)) }, order: { id: 'ASC' } });
      const cu = await this.lookup.userNames(cs.map((c) => c.userId));
      for (const c of cs) {
        if (!comments.has(c.ticketId)) comments.set(c.ticketId, []);
        comments.get(c.ticketId).push({ id: c.id, userId: c.userId, userName: cu.get(c.userId) ?? '', body: c.body, createdAt: toIso(c.createdAt) });
      }
    }
    const now = Date.now();
    return rows.map((t) => {
      const v: Record<string, unknown> = {
        id: t.id,
        number: t.number,
        title: t.title,
        description: t.description,
        storeId: t.storeId,
        storeName: stores.get(t.storeId) ?? '',
        category: t.category,
        priority: t.priority,
        status: t.status,
        assigneeId: t.assigneeId ?? null,
        assigneeName: t.assigneeId ? (users.get(t.assigneeId) ?? '') : null,
        reporterId: t.reporterId,
        reporterName: users.get(t.reporterId) ?? '',
        alertId: t.alertId ?? null,
        slaDueAt: toIso(t.slaDueAt),
        resolvedAt: toIso(t.resolvedAt),
        createdAt: toIso(t.createdAt),
        isSlaBreached: (t.resolvedAt ? t.resolvedAt.getTime() : now) > t.slaDueAt.getTime(),
      };
      if (withComments) v.comments = comments.get(t.id) ?? [];
      return v;
    });
  }

  async list(user: AuthUser, q: Record<string, unknown>) {
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return [];
    const qb = this.repo.createQueryBuilder('t').where('t.storeId IN (:...ids)', { ids });
    if (q.status) qb.andWhere('t.status IN (:...st)', { st: String(q.status).split(',') });
    if (q.category) qb.andWhere('t.category = :c', { c: qstr(q.category) });
    if (q.priority) qb.andWhere('t.priority = :p', { p: qstr(q.priority) });
    qb.orderBy('t.id', 'DESC').take(1000);
    return this.views(await qb.getMany());
  }

  async find(user: AuthUser, id: number) {
    const t = await this.repo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Ticket not found');
    this.scope.assert(user, t.storeId);
    return t;
  }

  async get(user: AuthUser, id: number) {
    return (await this.views([await this.find(user, id)], true))[0];
  }

  private async checkAssignee(assigneeId: number | null | undefined, storeId: number) {
    if (!assigneeId) return;
    await assertAssignee(this.ds, assigneeId, storeId);
  }

  async create(user: AuthUser, dto: CreateTicketDto, alertId: number | null = null, createdAt = new Date()) {
    await this.scope.assertStore(user, dto.storeId);
    await this.checkAssignee(dto.assigneeId, dto.storeId);
    const t = await this.repo.save(
      this.repo.create({
        ...dto,
        description: dto.description ?? '',
        assigneeId: dto.assigneeId ?? null,
        reporterId: user.id,
        status: 'OPEN',
        alertId,
        slaDueAt: slaDue(createdAt, dto.priority),
        createdAt,
      }),
    );
    t.number = ticketNumber(t.id);
    await this.repo.update(t.id, { number: t.number });
    return (await this.views([t], true))[0];
  }

  private canChange(user: AuthUser, t: Ticket) {
    return isManagerPlus(user.role) || t.assigneeId === user.id;
  }

  private applyStatus(t: Ticket, status: string) {
    t.status = status;
    if (status === 'RESOLVED' || status === 'CLOSED') t.resolvedAt = t.resolvedAt ?? new Date();
    if (status === 'REOPENED' || status === 'OPEN' || status === 'IN_PROGRESS') t.resolvedAt = null;
  }

  async update(user: AuthUser, id: number, dto: UpdateTicketDto) {
    const t = await this.find(user, id);
    const isReporter = t.reporterId === user.id;
    const touchesControl = dto.status !== undefined || dto.assigneeId !== undefined || dto.priority !== undefined;
    if (touchesControl && !this.canChange(user, t)) throw new ForbiddenException('Only STORE_MANAGER+ or the assignee can change status/assignment');
    if (!touchesControl && !this.canChange(user, t) && !isReporter) throw new ForbiddenException('Not allowed');
    if (dto.assigneeId !== undefined && dto.assigneeId !== t.assigneeId) await this.checkAssignee(dto.assigneeId, t.storeId);
    if (dto.title !== undefined) t.title = dto.title;
    if (dto.description !== undefined) t.description = dto.description;
    if (dto.category !== undefined) t.category = dto.category;
    if (dto.assigneeId !== undefined) t.assigneeId = dto.assigneeId;
    if (dto.priority !== undefined && dto.priority !== t.priority) {
      t.priority = dto.priority;
      t.slaDueAt = slaDue(t.createdAt, dto.priority);
    }
    if (dto.status) this.applyStatus(t, dto.status);
    await this.repo.save(t);
    return this.get(user, id);
  }

  async setStatus(user: AuthUser, id: number, status: string) {
    const t = await this.find(user, id);
    if (!this.canChange(user, t)) throw new ForbiddenException('Only STORE_MANAGER+ or the assignee can change status');
    this.applyStatus(t, status);
    await this.repo.save(t);
    return this.get(user, id);
  }

  /** Comments are allowed until a ticket is CLOSED (RESOLVED tickets can still be discussed / reopened). */
  async comment(user: AuthUser, id: number, body: string) {
    const t = await this.find(user, id);
    if (t.status === 'CLOSED') throw new ConflictException('Ticket is closed — reopen it to comment');
    const c = await this.ds.getRepository(TicketComment).save({ ticketId: id, userId: user.id, body });
    await this.repo.update(id, { updatedAt: new Date() });
    return { id: c.id, userId: user.id, userName: user.name, body: c.body, createdAt: toIso(c.createdAt) };
  }
}
