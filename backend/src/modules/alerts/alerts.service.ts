import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { Paged, parseIds, parsePaging, qstr } from '../../common/paging';
import { isDateStr } from '../../common/time.util';
import { AuthUser } from '../../common/roles';
import { StoreScopeService } from '../../common/store-scope.service';
import { Store } from '../stores/entities/store.entity';
import { TicketsService } from '../tickets/tickets.service';
import { CreateAlertRuleDto, UpdateAlertRuleDto } from './dto/alert.dto';
import { AlertRule } from './entities/alert-rule.entity';
import { Alert } from './entities/alert.entity';

const CATEGORY_BY_METRIC: Record<string, string> = {
  CAMERA_OFFLINE: 'CAMERA',
  EDGE_OFFLINE: 'NETWORK',
  QUEUE_LENGTH: 'OTHER',
  QUEUE_WAIT: 'OTHER',
  STORE_OPEN_LATE: 'OTHER',
  STORE_CLOSE_EARLY: 'OTHER',
  SOP_BREACH: 'OTHER',
  COUNTER_UNATTENDED: 'OTHER',
  STAFF_SHORTAGE: 'OTHER',
};
export const TICKET_CATEGORY_BY_METRIC = CATEGORY_BY_METRIC;
export const PRIORITY_BY_SEVERITY_MAP = (s: string) => PRIORITY_BY_SEVERITY[s] ?? 'MEDIUM';
const PRIORITY_BY_SEVERITY: Record<string, string> = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'URGENT' };

@Injectable()
export class AlertsService {
  constructor(
    private readonly ds: DataSource,
    private readonly scope: StoreScopeService,
    private readonly lookup: LookupService,
    private readonly tickets: TicketsService,
  ) {}

  static ruleView(r: AlertRule) {
    return {
      id: r.id,
      name: r.name,
      storeId: r.storeId ?? null,
      metric: r.metric,
      threshold: r.threshold,
      severity: r.severity,
      channels: r.channels ?? [],
      emails: r.emails ?? null,
      webhookUrl: r.webhookUrl ?? null,
      cooldownMin: r.cooldownMin,
      autoTicket: !!r.autoTicket,
      isActive: r.isActive,
    };
  }

  async views(rows: Alert[]) {
    const stores = await this.lookup.storeNames(rows.map((r) => r.storeId));
    const users = await this.lookup.userNames(rows.map((r) => r.acknowledgedById));
    return rows.map((a) => ({
      id: a.id,
      ruleId: a.ruleId ?? null,
      ruleName: a.ruleName,
      storeId: a.storeId,
      storeName: stores.get(a.storeId) ?? '',
      metric: a.metric,
      severity: a.severity,
      message: a.message,
      value: a.value,
      status: a.status,
      createdAt: toIso(a.createdAt),
      acknowledgedAt: toIso(a.acknowledgedAt),
      acknowledgedByName: a.acknowledgedById ? (users.get(a.acknowledgedById) ?? null) : null,
      resolvedAt: toIso(a.resolvedAt),
      ticketId: a.ticketId ?? null,
    }));
  }

  // ---- rules
  async listRules(user: AuthUser) {
    const rows = await this.ds.getRepository(AlertRule).find({ order: { id: 'ASC' } });
    return rows.filter((r) => this.scope.canAccess(user, r.storeId)).map(AlertsService.ruleView);
  }

  private async checkStore(storeId?: number | null) {
    if (!storeId) return;
    if (!(await this.ds.getRepository(Store).findOne({ where: { id: storeId } }))) throw new BadRequestException('Unknown storeId');
  }

  async createRule(dto: CreateAlertRuleDto) {
    await this.checkStore(dto.storeId);
    const repo = this.ds.getRepository(AlertRule);
    const r = await repo.save(repo.create({ ...dto, storeId: dto.storeId ?? null, cooldownMin: dto.cooldownMin ?? 30, autoTicket: dto.autoTicket ?? false, isActive: dto.isActive ?? true }));
    return AlertsService.ruleView(r);
  }

  async updateRule(id: number, dto: UpdateAlertRuleDto) {
    const repo = this.ds.getRepository(AlertRule);
    const r = await repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Alert rule not found');
    await this.checkStore(dto.storeId);
    Object.assign(r, dto);
    return AlertsService.ruleView(await repo.save(r));
  }

  async deleteRule(id: number) {
    const repo = this.ds.getRepository(AlertRule);
    const r = await repo.findOne({ where: { id } });
    if (!r) throw new NotFoundException('Alert rule not found');
    // keep alert history: detach alerts from the rule
    await this.ds.getRepository(Alert).update({ ruleId: id }, { ruleId: null });
    await repo.delete(id);
    return { ok: true };
  }

  // ---- alerts
  async list(user: AuthUser, q: Record<string, unknown>): Promise<Paged<unknown>> {
    const { page, pageSize, skip, take } = parsePaging(q);
    const ids = await this.scope.resolve(user, parseIds(q.storeIds), false);
    if (!ids.length) return { items: [], total: 0, page, pageSize };
    const qb = this.ds.getRepository(Alert).createQueryBuilder('a').where('a.storeId IN (:...ids)', { ids });
    if (q.status) qb.andWhere('a.status IN (:...st)', { st: String(q.status).split(',') });
    if (q.severity) qb.andWhere('a.severity IN (:...sev)', { sev: String(q.severity).split(',') });
    if (q.metric) qb.andWhere('a.metric = :m', { m: qstr(q.metric) });
    if (isDateStr(q.from)) qb.andWhere('a.createdAt >= :from', { from: new Date(String(q.from) + 'T00:00:00Z') });
    qb.orderBy('a.createdAt', 'DESC').addOrderBy('a.id', 'DESC').skip(skip).take(take);
    const [rows, total] = await qb.getManyAndCount();
    return { items: await this.views(rows), total, page, pageSize };
  }

  private async find(user: AuthUser, id: number) {
    const a = await this.ds.getRepository(Alert).findOne({ where: { id } });
    if (!a) throw new NotFoundException('Alert not found');
    this.scope.assert(user, a.storeId);
    return a;
  }

  async ack(user: AuthUser, id: number) {
    const a = await this.find(user, id);
    if (a.status === 'OPEN') {
      a.status = 'ACKNOWLEDGED';
      a.acknowledgedAt = new Date();
      a.acknowledgedById = user.id;
      await this.ds.getRepository(Alert).save(a);
    }
    return (await this.views([a]))[0];
  }

  async resolve(user: AuthUser, id: number) {
    const a = await this.find(user, id);
    if (a.status !== 'RESOLVED') {
      if (!a.acknowledgedAt) {
        a.acknowledgedAt = new Date();
        a.acknowledgedById = user.id;
      }
      a.status = 'RESOLVED';
      a.resolvedAt = new Date();
      a.resolvedById = user.id;
      await this.ds.getRepository(Alert).save(a);
    }
    return (await this.views([a]))[0];
  }

  async toTicket(user: AuthUser, id: number) {
    const a = await this.find(user, id);
    if (a.ticketId) return this.tickets.get(user, a.ticketId);
    const ticket = await this.tickets.create(
      user,
      {
        title: `${a.ruleName}`.slice(0, 200),
        description: `Created from alert #${a.id}: ${a.message}`,
        storeId: a.storeId,
        category: CATEGORY_BY_METRIC[a.metric] ?? 'OTHER',
        priority: PRIORITY_BY_SEVERITY[a.severity] ?? 'MEDIUM',
      },
      a.id,
    );
    a.ticketId = ticket.id as number;
    if (a.status === 'OPEN') {
      a.status = 'ACKNOWLEDGED';
      a.acknowledgedAt = new Date();
      a.acknowledgedById = user.id;
    }
    await this.ds.getRepository(Alert).save(a);
    return ticket;
  }
}
