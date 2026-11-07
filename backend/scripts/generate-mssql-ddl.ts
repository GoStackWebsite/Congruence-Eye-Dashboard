/**
 * Generates database/01_schema.sql (T-SQL for SQL Server 2022) from the TypeORM entity metadata,
 * so table / column / constraint names mirror the entities exactly.
 * Usage: npm run ddl
 */
process.env.DB_TYPE = 'mssql';
import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, EntityMetadata } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';

async function main() {
  const { ENTITIES } = await import('../src/config/entities');
  const ds = new DataSource({ type: 'mssql', host: 'localhost', username: 'sa', password: 'x', database: 'CongruenceEye', entities: ENTITIES });
  await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
  const ns = ds.namingStrategy;
  const q = (n: string) => `[${n}]`;

  const typeOf = (c: ColumnMetadata): string => {
    const t = String(typeof c.type === 'function' ? (c.type as { name: string }).name : c.type).toLowerCase();
    if (t === 'nvarchar' || t === 'varchar') return `${t}(${c.length || '255'})`;
    if (t === 'decimal') return `decimal(${c.precision ?? 18},${c.scale ?? 0})`;
    if (t === 'number' || t === 'int') return 'int';
    return t;
  };
  const defaultOf = (c: ColumnMetadata): string | null => {
    const d = c.default;
    if (d === undefined || d === null) return null;
    if (typeof d === 'function') return (d as () => string)();
    if (typeof d === 'boolean') return d ? '1' : '0';
    if (typeof d === 'number') return String(d);
    return `'${String(d).replace(/'/g, "''")}'`;
  };

  // order tables so that FK targets come first
  const metas = [...ds.entityMetadatas];
  const ordered: EntityMetadata[] = [];
  const visit = (m: EntityMetadata, stack = new Set<EntityMetadata>()) => {
    if (ordered.includes(m) || stack.has(m)) return;
    stack.add(m);
    for (const fk of m.foreignKeys) if (fk.referencedEntityMetadata !== m) visit(fk.referencedEntityMetadata, stack);
    ordered.push(m);
  };
  metas.sort((a, b) => a.tableName.localeCompare(b.tableName)).forEach((m) => visit(m));

  const out: string[] = [];
  out.push(`/* =====================================================================
   Congruence Eye — SQL Server 2022 schema
   Generated from the backend TypeORM entities (npm run ddl). Mirrors
   table/column/constraint names exactly so that the API can run with
   DB_SYNC=false against this database.
   All timestamps are UTC (datetime2); 'date' columns are store-local
   YYYY-MM-DD strings and 'hour' columns 0..23 store-local.
   ===================================================================== */
IF DB_ID(N'CongruenceEye') IS NULL
BEGIN
    CREATE DATABASE [CongruenceEye];
END
GO
USE [CongruenceEye];
GO
`);
  for (const m of ordered) {
    const t = m.tableName;
    const lines: string[] = [];
    for (const c of m.columns) {
      let l = `    ${q(c.databaseName)} ${typeOf(c)}`;
      if (c.isGenerated && c.generationStrategy === 'increment') l += ' IDENTITY(1,1)';
      l += c.isNullable ? ' NULL' : ' NOT NULL';
      const d = defaultOf(c);
      if (d !== null) l += ` CONSTRAINT ${q(ns.defaultConstraintName(t, c.databaseName))} DEFAULT ${d}`;
      lines.push(l);
    }
    const pk = m.primaryColumns.map((c) => c.databaseName);
    lines.push(`    CONSTRAINT ${q(ns.primaryKeyName(t, pk))} PRIMARY KEY (${pk.map(q).join(', ')})`);
    for (const u of m.uniques) lines.push(`    CONSTRAINT ${q(u.name)} UNIQUE (${u.columns.map((c) => q(c.databaseName)).join(', ')})`);
    out.push(`IF OBJECT_ID(N'dbo.${t}', N'U') IS NULL\nBEGIN\n    CREATE TABLE [dbo].${q(t)} (\n${lines.map((l) => '    ' + l).join(',\n')}\n    );\nEND\nGO\n`);
  }
  out.push('/* ---------------------------------------------------------------- upgrade: add columns missing in an existing (v1) database */');
  for (const m of ordered) {
    for (const c of m.columns) {
      if (c.isPrimary) continue;
      let l = `${q(c.databaseName)} ${typeOf(c)}${c.isNullable ? ' NULL' : ' NOT NULL'}`;
      const d = defaultOf(c);
      if (d !== null) l += ` CONSTRAINT ${q(ns.defaultConstraintName(m.tableName, c.databaseName))} DEFAULT ${d}`;
      out.push(`IF COL_LENGTH(N'dbo.${m.tableName}', N'${c.databaseName}') IS NULL\n    ALTER TABLE [dbo].${q(m.tableName)} ADD ${l};\nGO`);
    }
  }
  out.push('\n/* ---------------------------------------------------------------- indexes */');
  for (const m of ordered) {
    for (const i of m.indices) {
      const cols = i.columns.map((c) => q(c.databaseName)).join(', ');
      out.push(`IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = N'${i.name}' AND object_id = OBJECT_ID(N'dbo.${m.tableName}'))\n    CREATE ${i.isUnique ? 'UNIQUE ' : ''}INDEX ${q(i.name)} ON [dbo].${q(m.tableName)} (${cols});\nGO`);
    }
  }
  out.push('\n/* ---------------------------------------------------------------- foreign keys */');
  for (const m of ordered) {
    for (const fk of m.foreignKeys) {
      const name = fk.name;
      const del = (fk.onDelete || 'NO ACTION').toUpperCase();
      out.push(`IF OBJECT_ID(N'dbo.${name}', N'F') IS NULL\n    ALTER TABLE [dbo].${q(m.tableName)} ADD CONSTRAINT ${q(name)} FOREIGN KEY (${fk.columnNames.map(q).join(', ')}) REFERENCES [dbo].${q(fk.referencedEntityMetadata.tableName)} (${fk.referencedColumnNames.map(q).join(', ')}) ON DELETE ${del} ON UPDATE NO ACTION;\nGO`);
    }
  }
  const file = path.resolve(__dirname, '../../database/01_schema.sql');
  fs.writeFileSync(file, out.join('\n') + '\n');
  console.log(`wrote ${file} (${ordered.length} tables)`);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
