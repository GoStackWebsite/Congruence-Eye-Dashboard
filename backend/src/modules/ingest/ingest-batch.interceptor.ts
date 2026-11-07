import { BadRequestException, CallHandler, ConflictException, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { from, lastValueFrom, Observable } from 'rxjs';
import { DataSource, LessThan } from 'typeorm';
import { EdgeContext } from '../../common/roles';
import { IngestBatch } from './entities/ingest-batch.entity';

const BATCH_ID = /^[A-Za-z0-9._:-]{1,64}$/;

export const batchTtlDays = () => Math.max(1, parseInt(process.env.INGEST_BATCH_TTL_DAYS || '14', 10) || 14);

/** Reads the idempotency key of an edge request: `X-Batch-Id` header (preferred) or `batchId` body field. */
export function batchIdOf(req: { headers?: Record<string, unknown>; body?: unknown }): string | undefined {
  const h = req.headers?.['x-batch-id'];
  const b = req.body && typeof req.body === 'object' ? (req.body as Record<string, unknown>).batchId : undefined;
  const v = (Array.isArray(h) ? h[0] : h) ?? b;
  if (v === undefined || v === null || v === '') return undefined;
  if (typeof v !== 'string' || !BATCH_ID.test(v)) throw new BadRequestException('batchId must be 1-64 characters of A-Z a-z 0-9 . _ : -');
  return v;
}

const isUniqueViolation = (e: unknown) => /UNIQUE|duplicate key|unique constraint|2627|2601/i.test(String((e as Error)?.message ?? e));

/**
 * Exactly-once processing for edge ingest batches. The first request with a batchId claims it (unique
 * index on storeId + kind + batchId); a replay of a finished batch gets the stored response plus
 * `duplicate: true` without being processed; a replay while the first is still running gets 409 (the edge
 * retries later). If processing fails the claim is released so the batch can be retried.
 */
@Injectable()
export class IngestBatchInterceptor implements NestInterceptor {
  private readonly log = new Logger(IngestBatchInterceptor.name);
  constructor(private readonly ds: DataSource) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest();
    const edge: EdgeContext | undefined = req.edge;
    if (req.method !== 'POST' || !edge) return next.handle();
    const kind = String((req.route?.path ?? req.path ?? '').split('/').filter(Boolean).pop() ?? 'unknown').slice(0, 20);
    if (kind === 'heartbeat') return next.handle(); // replaying a heartbeat is harmless (and must reflect "now")
    const batchId = batchIdOf(req);
    if (!batchId) return next.handle();
    return from(this.run(edge.storeId, kind, batchId, () => lastValueFrom(next.handle())));
  }

  private async run(storeId: number, kind: string, batchId: string, fn: () => Promise<unknown>) {
    const repo = this.ds.getRepository(IngestBatch);
    let claimId: number;
    try {
      claimId = (await repo.insert({ storeId, kind, batchId, response: null })).identifiers[0].id;
    } catch (e) {
      if (!isUniqueViolation(e)) throw e;
      const prev = await repo.findOne({ where: { storeId, kind, batchId } });
      if (prev?.response) {
        let body: unknown = {};
        try {
          body = JSON.parse(prev.response);
        } catch {
          body = {};
        }
        return body && typeof body === 'object' ? { ...(body as object), duplicate: true } : { ok: true, duplicate: true };
      }
      throw new ConflictException(`Batch ${batchId} is still being processed`);
    }
    try {
      const res = await fn();
      await repo.update(claimId, { response: JSON.stringify(res ?? null) });
      return res;
    } catch (e) {
      await repo.delete(claimId).catch((err: Error) => this.log.warn(`could not release batch claim: ${err.message}`));
      throw e;
    }
  }

  /** Deletes idempotency rows older than the TTL. */
  static async purge(ds: DataSource, now = new Date()): Promise<number> {
    const r = await ds.getRepository(IngestBatch).delete({ createdAt: LessThan(new Date(now.getTime() - batchTtlDays() * 86400_000)) });
    return r.affected ?? 0;
  }
}
