import { BadRequestException } from '@nestjs/common';
import { EntityMetadata, EntitySubscriberInterface, EventSubscriber, InsertEvent, UpdateEvent } from 'typeorm';

/**
 * SQL Server rejects strings longer than an nvarchar(n) column ("String or binary data would be truncated",
 * a 500), while SQLite silently stores them — so a too-long value passed every dev/test run and failed in
 * production. This subscriber enforces the column lengths on BOTH drivers before any INSERT/UPDATE and turns
 * a violation into a 400 naming the field. DTO @MaxLength rules stay the first line of defence.
 */
@EventSubscriber()
export class LengthGuardSubscriber implements EntitySubscriberInterface {
  private readonly limits = new WeakMap<EntityMetadata, { prop: string; max: number }[]>();

  private limitsOf(meta: EntityMetadata) {
    let l = this.limits.get(meta);
    if (!l) {
      l = meta.columns
        .filter((c) => ['nvarchar', 'varchar', 'nchar', 'char'].includes(String(c.type)) && c.length && /^\d+$/.test(String(c.length)))
        .map((c) => ({ prop: c.propertyName, max: Number(c.length) }));
      this.limits.set(meta, l);
    }
    return l;
  }

  private check(meta: EntityMetadata | undefined, row: unknown) {
    if (!meta || !row || typeof row !== 'object') return;
    for (const { prop, max } of this.limitsOf(meta)) {
      const v = (row as Record<string, unknown>)[prop];
      if (typeof v === 'string' && v.length > max) throw new BadRequestException(`${prop} must be at most ${max} characters`);
    }
  }

  beforeInsert(event: InsertEvent<unknown>) {
    this.check(event.metadata, event.entity);
  }

  beforeUpdate(event: UpdateEvent<unknown>) {
    this.check(event.metadata, event.entity);
  }
}
