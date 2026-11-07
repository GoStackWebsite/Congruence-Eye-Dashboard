import { Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Paged, parsePaging } from '../../common/paging';
import { AuthUser } from '../../common/roles';
import { AuditLog } from './entities/audit-log.entity';

const SECRET_KEYS = /password|apikey|secret|token/i;

@Injectable()
export class AuditService {
  private readonly log = new Logger(AuditService.name);
  constructor(private readonly ds: DataSource) {}

  async record(user: Partial<AuthUser> | null, action: string, entity: string, entityId: number | null, details?: unknown) {
    try {
      await this.ds.getRepository(AuditLog).insert({
        userId: user?.id ?? null,
        userName: user?.name ?? '',
        action: action.slice(0, 30),
        entity: entity.slice(0, 60),
        entityId: entityId && isFinite(entityId) ? entityId : null,
        details: details === undefined ? null : AuditService.sanitize(details),
      });
    } catch (e) {
      this.log.warn(`audit write failed: ${(e as Error).message}`);
    }
  }

  static sanitize(details: unknown): string {
    const clean = (v: unknown): unknown => {
      if (Array.isArray(v)) return v.length > 20 ? `[${v.length} items]` : v.map(clean);
      if (v && typeof v === 'object') {
        const o: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(v)) o[k] = SECRET_KEYS.test(k) ? '***' : clean(val);
        return o;
      }
      return v;
    };
    const s = JSON.stringify(clean(details));
    return s.length > 16000 ? s.slice(0, 16000) + '…' : s;
  }

  async list(q: { userId?: number; entity?: string; page?: unknown; pageSize?: unknown }): Promise<Paged<unknown>> {
    const { page, pageSize, skip, take } = parsePaging(q);
    const qb = this.ds.getRepository(AuditLog).createQueryBuilder('a');
    if (q.userId) qb.andWhere('a.userId = :uid', { uid: q.userId });
    if (q.entity) qb.andWhere('a.entity = :entity', { entity: q.entity });
    qb.orderBy('a.id', 'DESC').skip(skip).take(take);
    const [rows, total] = await qb.getManyAndCount();
    return {
      items: rows.map((r) => ({
        id: r.id,
        userId: r.userId,
        userName: r.userName,
        action: r.action,
        entity: r.entity,
        entityId: r.entityId,
        details: r.details,
        createdAt: r.createdAt?.toISOString?.() ?? r.createdAt,
      })),
      total,
      page,
      pageSize,
    };
  }
}
