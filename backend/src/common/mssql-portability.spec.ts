import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, EntityMetadata } from 'typeorm';

/**
 * QA edge-case plan §10 — SQL Server portability guards that run on every `npm test` (no SQL Server needed):
 *  - database/01_schema.sql mirrors the entities (every table, column and index; regenerate with `npm run ddl`)
 *  - identifiers fit SQL Server's 128-character limit
 *  - T-SQL reserved words used as column names are never written bare in hand-written query fragments
 *  - no SQLite-only SQL functions in the source
 */
const TSQL_RESERVED = new Set(
  ('ADD ALL ALTER AND ANY AS ASC AUTHORIZATION BACKUP BEGIN BETWEEN BREAK BROWSE BULK BY CASCADE CASE CHECK CHECKPOINT CLOSE CLUSTERED COALESCE ' +
    'COLLATE COLUMN COMMIT COMPUTE CONSTRAINT CONTAINS CONTAINSTABLE CONTINUE CONVERT CREATE CROSS CURRENT CURRENT_DATE CURRENT_TIME CURRENT_TIMESTAMP ' +
    'CURRENT_USER CURSOR DATABASE DBCC DEALLOCATE DECLARE DEFAULT DELETE DENY DESC DISK DISTINCT DISTRIBUTED DOUBLE DROP DUMP ELSE END ERRLVL ESCAPE ' +
    'EXCEPT EXEC EXECUTE EXISTS EXIT EXTERNAL FETCH FILE FILLFACTOR FOR FOREIGN FREETEXT FREETEXTTABLE FROM FULL FUNCTION GOTO GRANT GROUP HAVING ' +
    'HOLDLOCK IDENTITY IDENTITY_INSERT IDENTITYCOL IF IN INDEX INNER INSERT INTERSECT INTO IS JOIN KEY KILL LEFT LIKE LINENO LOAD MERGE NATIONAL NOCHECK ' +
    'NONCLUSTERED NOT NULL NULLIF OF OFF OFFSETS ON OPEN OPENDATASOURCE OPENQUERY OPENROWSET OPENXML OPTION OR ORDER OUTER OVER PERCENT PIVOT PLAN ' +
    'PRECISION PRIMARY PRINT PROC PROCEDURE PUBLIC RAISERROR READ READTEXT RECONFIGURE REFERENCES REPLICATION RESTORE RESTRICT RETURN REVERT REVOKE ' +
    'RIGHT ROLLBACK ROWCOUNT ROWGUIDCOL RULE SAVE SCHEMA SECURITYAUDIT SELECT SESSION_USER SET SETUSER SHUTDOWN SOME STATISTICS SYSTEM_USER TABLE ' +
    'TABLESAMPLE TEXTSIZE THEN TO TOP TRAN TRANSACTION TRIGGER TRUNCATE TRY_CONVERT TSEQUAL UNION UNIQUE UNPIVOT UPDATE UPDATETEXT USE USER VALUES ' +
    'VARYING VIEW WAITFOR WHEN WHERE WHILE WITH WRITETEXT').split(' '),
);

let metas: EntityMetadata[];
const schema = fs.readFileSync(path.resolve(__dirname, '../../../database/01_schema.sql'), 'utf8');
const srcFiles = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? srcFiles(path.join(dir, d.name)) : d.name.endsWith('.ts') && !d.name.endsWith('.spec.ts') ? [path.join(dir, d.name)] : []));

beforeAll(async () => {
  // entity column types are chosen per driver at import time: load a fresh copy of the entities as mssql
  const prev = process.env.DB_TYPE;
  process.env.DB_TYPE = 'mssql';
  let entities: unknown[] = [];
  jest.isolateModules(() => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    entities = require('../config/entities').ENTITIES;
  });
  process.env.DB_TYPE = prev;
  const ds = new DataSource({ type: 'mssql', host: 'localhost', username: 'sa', password: 'x', database: 'x', entities: entities as never });
  await (ds as unknown as { buildMetadatas: () => Promise<void> }).buildMetadatas();
  metas = ds.entityMetadatas;
});

describe('SQL Server portability', () => {
  it('01_schema.sql has every table, column and index of the entities (run `npm run ddl` after entity changes)', () => {
    const missing: string[] = [];
    for (const m of metas) {
      if (!schema.includes(`[dbo].[${m.tableName}]`)) missing.push(`table ${m.tableName}`);
      for (const c of m.columns) if (!schema.includes(`[${c.databaseName}]`)) missing.push(`column ${m.tableName}.${c.databaseName}`);
      for (const i of m.indices) if (i.name && !schema.includes(`[${i.name}]`)) missing.push(`index ${i.name}`);
    }
    expect(missing).toEqual([]);
  });

  it('identifiers fit in 128 characters', () => {
    const long: string[] = [];
    for (const m of metas) {
      for (const n of [m.tableName, ...m.columns.map((c) => c.databaseName), ...m.indices.map((i) => i.name ?? ''), ...m.foreignKeys.map((f) => f.name ?? '')]) if (n.length > 128) long.push(n);
    }
    for (const n of schema.match(/\[[^\]]+\]/g) ?? []) if (n.length - 2 > 128) long.push(n);
    expect(long).toEqual([]);
  });

  it('reserved words used as column names are always bracket-quoted in 01_schema.sql', () => {
    const reservedCols = metas.flatMap((m) => m.columns.filter((c) => TSQL_RESERVED.has(c.databaseName.toUpperCase())).map((c) => c.databaseName));
    const bare: string[] = [];
    for (const name of new Set(reservedCols)) {
      const re = new RegExp(`(^|[\\s,(])${name}(\\s+(nvarchar|varchar|int|bit|float|datetime2|decimal))`, 'gm');
      if (re.test(schema)) bare.push(name);
    }
    expect(bare).toEqual([]);
  });

  it('hand-written query fragments never use a reserved-word column without an alias (e.g. "key = :k")', () => {
    const reservedCols = new Set(metas.flatMap((m) => m.columns.map((c) => c.databaseName)).filter((n) => TSQL_RESERVED.has(n.toUpperCase())));
    expect([...reservedCols]).toContain('key'); // settings.key — self-check that the scan has something to look for
    const offenders: string[] = [];
    for (const f of srcFiles(path.resolve(__dirname, '..'))) {
      const text = fs.readFileSync(f, 'utf8');
      for (const m of text.matchAll(/\.(where|andWhere|orWhere|select|addSelect|groupBy|addGroupBy|orderBy|addOrderBy)\(\s*'([^']*)'/g)) {
        for (const col of reservedCols) if (new RegExp(`(^|[^.\\w"\\[])${col}\\b`, 'i').test(m[2])) offenders.push(`${path.relative(process.cwd(), f)}: ${m[2]}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('no SQLite-only SQL in the source', () => {
    const sqliteOnly = /\b(strftime|julianday|GROUP_CONCAT|IFNULL|INSERT OR (IGNORE|REPLACE)|ON CONFLICT|AUTOINCREMENT|PRAGMA)\b|datetime\('now'\)|LIMIT \d+/i;
    const offenders: string[] = [];
    for (const f of srcFiles(path.resolve(__dirname, '..'))) {
      if (f.includes(`${path.sep}seed${path.sep}`) || f.endsWith('database.config.ts')) continue;
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (sqliteOnly.test(line) && !/^\s*(\/\/|\*)/.test(line)) offenders.push(`${path.relative(process.cwd(), f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(offenders).toEqual([]);
  });
});
