import * as fs from 'fs';
import * as path from 'path';
import { DataSourceOptions } from 'typeorm';
import { LengthGuardSubscriber } from '../common/length-guard.subscriber';
import { ENTITIES } from './entities';

export function databaseOptions(): DataSourceOptions {
  const type = process.env.DB_TYPE === 'mssql' ? 'mssql' : 'sqlite';
  const log = process.env.DB_LOGGING === 'true';
  if (type === 'mssql') {
    return {
      type: 'mssql',
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '1433', 10),
      username: process.env.DB_USER || 'sa',
      password: process.env.DB_PASSWORD || '',
      database: process.env.DB_NAME || 'CongruenceEye',
      entities: ENTITIES,
      subscribers: [LengthGuardSubscriber],
      synchronize: (process.env.DB_SYNC ?? 'false') === 'true',
      logging: log,
      options: {
        encrypt: (process.env.DB_ENCRYPT ?? 'false') === 'true',
        trustServerCertificate: (process.env.DB_TRUST_CERT ?? 'true') === 'true',
        useUTC: true,
      },
      pool: { max: 20, min: 0, idleTimeoutMillis: 30000 },
      requestTimeout: 120000,
    } as DataSourceOptions;
  }
  const dbPath = process.env.DB_PATH || './data/dev.sqlite';
  if (dbPath !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  return {
    type: 'better-sqlite3',
    database: dbPath,
    entities: ENTITIES,
    subscribers: [LengthGuardSubscriber],
    synchronize: (process.env.DB_SYNC ?? 'true') === 'true',
    logging: log,
    prepareDatabase: (db: { pragma: (s: string) => unknown }) => {
      if (dbPath !== ':memory:') db.pragma('journal_mode = WAL');
      db.pragma('synchronous = NORMAL');
    },
  } as DataSourceOptions;
}

export const uploadDir = () => path.resolve(process.env.UPLOAD_DIR || './uploads');
