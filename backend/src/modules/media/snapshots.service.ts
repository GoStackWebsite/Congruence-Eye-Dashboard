import { Injectable } from '@nestjs/common';
import { randomBytes } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { DataSource, In } from 'typeorm';
import { localParts } from '../../common/time.util';
import { uploadDir } from '../../config/database.config';
import { Snapshot } from './entities/snapshot.entity';

export const SNAPSHOT_KINDS = ['PERIODIC', 'EVENT', 'OPENING', 'CLOSING', 'AI_MANAGER', 'REFERENCE'];
export const snapshotUrl = (s: { filePath: string } | null | undefined) => (s ? `/uploads/${s.filePath.replace(/\\/g, '/')}` : null);

/** Stores every snapshot on disk under UPLOAD_DIR/snapshots/<storeId>/<date>/ and indexes it in `snapshots`. */
@Injectable()
export class SnapshotsService {
  constructor(private readonly ds: DataSource) {}

  async save(opts: { storeId: number; cameraId: number; buffer: Buffer; kind?: string; ts?: Date; tz?: string }, manager = this.ds.manager): Promise<Snapshot> {
    const ts = opts.ts ?? new Date();
    const date = localParts(ts, opts.tz || 'Asia/Kolkata').date;
    const rel = path.join('snapshots', String(opts.storeId), date, `cam${opts.cameraId}-${ts.getTime()}-${randomBytes(3).toString('hex')}.jpg`);
    const abs = path.join(uploadDir(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, opts.buffer);
    return manager.getRepository(Snapshot).save({
      storeId: opts.storeId,
      cameraId: opts.cameraId,
      ts,
      date,
      kind: opts.kind || 'PERIODIC',
      filePath: rel.split(path.sep).join('/'),
      sizeBytes: opts.buffer.length,
    });
  }

  absPath(s: Snapshot) {
    return path.join(uploadDir(), s.filePath);
  }

  async latestForCamera(cameraId: number): Promise<Snapshot | null> {
    return this.ds.getRepository(Snapshot).findOne({ where: { cameraId }, order: { ts: 'DESC', id: 'DESC' } });
  }

  async urls(ids: (number | null | undefined)[]): Promise<Map<number, string>> {
    const uniq = [...new Set(ids.filter((x): x is number => !!x))];
    const m = new Map<number, string>();
    for (let i = 0; i < uniq.length; i += 800) {
      const rows = await this.ds.getRepository(Snapshot).find({ select: { id: true, filePath: true }, where: { id: In(uniq.slice(i, i + 800)) } });
      for (const r of rows) m.set(r.id, snapshotUrl(r));
    }
    return m;
  }
}
