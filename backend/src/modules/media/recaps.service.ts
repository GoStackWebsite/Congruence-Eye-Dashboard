import { Injectable, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { DataSource, In } from 'typeorm';
import { toIso } from '../../common/db-types';
import { LookupService } from '../../common/lookup.service';
import { isDateStr } from '../../common/time.util';
import { uploadDir } from '../../config/database.config';
import { Recap } from './entities/recap.entity';
import { Snapshot } from './entities/snapshot.entity';

export const FRAME_SEC = 0.25;
export const MAX_RECAP_SEC = 119;

/** ffmpeg binary: FFMPEG_PATH env, else the npm ffmpeg-static binary, else `ffmpeg` on PATH. */
export function ffmpegPath(): string {
  if (process.env.FFMPEG_PATH) return process.env.FFMPEG_PATH;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const p = require('ffmpeg-static') as string | null;
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* not installed */
  }
  return 'ffmpeg';
}

function run(bin: string, args: string[], timeoutMs = 300_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let err = '';
    const t = setTimeout(() => p.kill('SIGKILL'), timeoutMs);
    p.stderr.on('data', (d: Buffer) => (err = (err + d.toString()).slice(-4000)));
    p.on('error', (e) => {
      clearTimeout(t);
      reject(e);
    });
    p.on('close', (code) => {
      clearTimeout(t);
      if (code === 0) resolve(err);
      else reject(new Error(`ffmpeg exited with ${code}: ${err.split('\n').slice(-4).join(' ')}`));
    });
  });
}

/** Day-summary recap video (H.264 yuv420p mp4, +faststart, 1280 wide, ~0.25 s per snapshot, < 120 s). */
@Injectable()
export class RecapsService {
  private readonly log = new Logger(RecapsService.name);
  constructor(
    private readonly ds: DataSource,
    private readonly lookup: LookupService,
  ) {}

  async views(rows: Recap[]) {
    const names = await this.lookup.storeNames(rows.map((r) => r.storeId));
    return rows.map((r) => ({
      id: r.id,
      storeId: r.storeId,
      storeName: names.get(r.storeId) ?? '',
      date: r.date,
      status: r.status,
      url: r.status === 'READY' && r.filePath ? `/uploads/${r.filePath}` : null,
      durationSec: r.durationSec,
      frameCount: r.frameCount,
      error: r.error ?? null,
      createdAt: toIso(r.createdAt),
    }));
  }

  async list(ids: number[], q: { from?: unknown; to?: unknown }) {
    if (!ids.length) return [];
    const qb = this.ds.getRepository(Recap).createQueryBuilder('r').where('r.storeId IN (:...ids)', { ids });
    if (isDateStr(q.from)) qb.andWhere('r.date >= :from', { from: q.from });
    if (isDateStr(q.to)) qb.andWhere('r.date <= :to', { to: q.to });
    return this.views(await qb.orderBy('r.date', 'DESC').addOrderBy('r.storeId', 'ASC').take(500).getMany());
  }

  async get(id: number) {
    const r = await this.ds.getRepository(Recap).findOne({ where: { id } });
    if (!r) throw new NotFoundException('Recap not found');
    return r;
  }

  /** Builds (or rebuilds) the recap for a store-day. Throws 422 when there are no snapshots. */
  async generate(storeId: number, date: string): Promise<Recap> {
    const snaps = await this.ds.getRepository(Snapshot).find({ where: { storeId, date, kind: In(['PERIODIC', 'EVENT', 'OPENING', 'CLOSING', 'AI_MANAGER']) }, order: { ts: 'ASC', id: 'ASC' } });
    if (!snaps.length) throw new UnprocessableEntityException(`No snapshots for store ${storeId} on ${date}`);
    const repo = this.ds.getRepository(Recap);
    let recap = await repo.findOne({ where: { storeId, date } });
    if (!recap) recap = await repo.save(repo.create({ storeId, date, status: 'PENDING', filePath: null, durationSec: 0, frameCount: 0, error: null }));
    else await repo.update(recap.id, { status: 'PENDING', error: null });
    // cap length: sample evenly so frames * 0.25 s < 120 s
    const maxFrames = Math.floor(MAX_RECAP_SEC / FRAME_SEC);
    const frames = snaps.length <= maxFrames ? snaps : Array.from({ length: maxFrames }, (_, i) => snaps[Math.floor((i * snaps.length) / maxFrames)]);
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'recap-'));
    const rel = `recaps/store-${storeId}-${date}.mp4`;
    const out = path.join(uploadDir(), rel);
    try {
      let n = 0;
      for (const s of frames) {
        const src = path.join(uploadDir(), s.filePath);
        if (!fs.existsSync(src)) continue;
        fs.copyFileSync(src, path.join(tmp, `f${String(n++).padStart(5, '0')}.jpg`));
      }
      if (!n) throw new Error('snapshot files missing on disk');
      fs.mkdirSync(path.dirname(out), { recursive: true });
      const tmpOut = path.join(tmp, 'out.mp4');
      await run(ffmpegPath(), [
        '-hide_banner', '-loglevel', 'error', '-y',
        '-framerate', String(1 / FRAME_SEC), '-i', path.join(tmp, 'f%05d.jpg'),
        '-vf', 'scale=1280:-2:flags=bicubic,format=yuv420p', '-r', '12',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an',
        tmpOut,
      ]);
      fs.copyFileSync(tmpOut, out);
      await repo.update(recap.id, { status: 'READY', filePath: rel, frameCount: n, durationSec: Math.round(n * FRAME_SEC * 100) / 100, error: null });
    } catch (e) {
      this.log.warn(`recap ${storeId}/${date} failed: ${(e as Error).message}`);
      await repo.update(recap.id, { status: 'FAILED', error: (e as Error).message.slice(0, 1000) });
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
    return repo.findOneOrFail({ where: { id: recap.id } });
  }
}
