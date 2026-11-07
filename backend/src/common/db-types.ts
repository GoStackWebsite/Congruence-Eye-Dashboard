import { Column, ColumnOptions, CreateDateColumn, UpdateDateColumn, ValueTransformer } from 'typeorm';

/**
 * Logical column types mapped per driver so that every entity is portable
 * between SQL Server (production) and SQLite (dev / tests).
 * DB_TYPE must be set before entities are imported (see src/env.ts / test/setup-env.ts).
 */
export const dbType = (): 'mssql' | 'sqlite' => (process.env.DB_TYPE === 'mssql' ? 'mssql' : 'sqlite');
export const isMssql = () => dbType() === 'mssql';

export const DATETIME = () => (isMssql() ? 'datetime2' : 'datetime');

const numberTransformer: ValueTransformer = {
  to: (v: unknown) => v,
  from: (v: unknown) => (v === null || v === undefined ? v : Number(v)),
};

const boolTransformer: ValueTransformer = {
  to: (v: unknown) => v,
  from: (v: unknown) => (v === null || v === undefined ? v : v === true || v === 1 || v === '1' || v === 'true'),
};

export function jsonTransformer<T>(fallback: T): ValueTransformer {
  return {
    to: (v: unknown) => (v === undefined ? undefined : v === null ? null : JSON.stringify(v)),
    from: (v: unknown) => {
      if (v === null || v === undefined || v === '') return fallback;
      try {
        return JSON.parse(String(v));
      } catch {
        return fallback;
      }
    },
  };
}

type Extra = Pick<ColumnOptions, 'nullable' | 'default' | 'name' | 'unique'>;

export const DateTimeColumn = (o: Extra = {}) => Column({ type: DATETIME() as any, ...o });
/** Timestamps are stored in UTC on both drivers (SQL Server default SYSUTCDATETIME()). */
export const CreatedAtColumn = () =>
  isMssql() ? CreateDateColumn({ type: 'datetime2' as any, default: () => 'SYSUTCDATETIME()' }) : CreateDateColumn({ type: 'datetime' as any });
export const UpdatedAtColumn = () =>
  isMssql() ? UpdateDateColumn({ type: 'datetime2' as any, default: () => 'SYSUTCDATETIME()' }) : UpdateDateColumn({ type: 'datetime' as any });
/** nvarchar(n) on both drivers */
export const StrColumn = (length: number, o: Extra = {}) => Column({ type: 'nvarchar', length, ...o });
/** YYYY-MM-DD store-local date stored as varchar(10) — portable and sortable */
export const DateStrColumn = (o: Extra = {}) => Column({ type: 'varchar', length: 10, ...o });
export const TextColumn = (o: Extra = {}) =>
  isMssql() ? Column({ type: 'nvarchar', length: 'MAX', ...o }) : Column({ type: 'text', ...o });
export const JsonColumn = <T>(fallback: T, o: Extra = {}) =>
  isMssql()
    ? Column({ type: 'nvarchar', length: 'MAX', transformer: jsonTransformer(fallback), ...o })
    : Column({ type: 'text', transformer: jsonTransformer(fallback), ...o });
export const BoolColumn = (o: Extra = {}) =>
  Column({ type: isMssql() ? 'bit' : 'boolean', transformer: boolTransformer, ...o });
export const MoneyColumn = (o: Extra = {}) =>
  Column({ type: 'decimal', precision: 12, scale: 2, transformer: numberTransformer, ...o });
export const IntColumn = (o: Extra = {}) => Column({ type: 'int', ...o });
export const FloatColumn = (o: Extra = {}) => Column({ type: 'float', transformer: numberTransformer, ...o });

/** Normalises a timestamp coming from raw queries (sqlite returns 'YYYY-MM-DD HH:MM:SS.SSS' in UTC). */
export function toDate(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null;
  if (v instanceof Date) return v;
  let s = String(v);
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(s)) s = s.replace(' ', 'T');
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/.test(s)) s += 'Z';
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export const toIso = (v: unknown): string | null => {
  const d = toDate(v);
  return d ? d.toISOString() : null;
};

export const toBool = (v: unknown): boolean => v === true || v === 1 || v === '1' || v === 'true';
export const num = (v: unknown): number => (v === null || v === undefined || v === '' ? 0 : Number(v));
