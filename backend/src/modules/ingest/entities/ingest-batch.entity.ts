import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, IntColumn, StrColumn, TextColumn } from '../../../common/db-types';

/**
 * Idempotency record of an edge ingest request (`X-Batch-Id` header or `batchId` body field).
 * A replayed batch (edge spool resend after a lost response) returns the stored response and is not
 * processed again. Rows older than INGEST_BATCH_TTL_DAYS (default 14) are purged hourly.
 */
@Entity('ingest_batches')
@Index('UQ_ingest_batches_store_kind_batch', ['storeId', 'kind', 'batchId'], { unique: true })
@Index('IX_ingest_batches_created', ['createdAt'])
export class IngestBatch {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @StrColumn(20) kind: string;
  @StrColumn(64) batchId: string;
  /** JSON of the first successful response; null while the first request is still running */
  @TextColumn({ nullable: true }) response: string | null;
  @CreatedAtColumn() createdAt: Date;
}
