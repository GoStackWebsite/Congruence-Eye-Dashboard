import { EntityManager, EntityTarget, ObjectLiteral } from 'typeorm';
import { isMssql } from './db-types';

/** Chunked bulk insert respecting SQL Server's 2100-parameter limit. */
export async function bulkInsert<T extends ObjectLiteral>(
  manager: EntityManager,
  target: EntityTarget<T>,
  rows: Partial<T>[],
): Promise<void> {
  if (!rows.length) return;
  const meta = manager.connection.getMetadata(target);
  const cols = Math.max(1, meta.columns.filter((c) => !c.isGenerated).length);
  // SQL Server: max 2100 parameters per statement; SQLite (>= 3.32): 32766
  const chunk = isMssql() ? Math.max(1, Math.min(500, Math.floor(2000 / cols))) : Math.max(1, Math.min(1000, Math.floor(30000 / cols)));
  for (let i = 0; i < rows.length; i += chunk) {
    await manager
      .createQueryBuilder()
      .insert()
      .into(target)
      .values(rows.slice(i, i + chunk) as any)
      .updateEntity(false)
      .execute();
  }
}

/** Splits an id list for IN (...) clauses. */
export function chunks<T>(arr: T[], size = 1000): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}
