import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DateTimeColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';

/** A connection test of one camera or recorder channel, run by the store's edge box (contract v3). */
@Entity('probes')
@Index('IX_probes_store_status', ['storeId', 'status'])
@Index('IX_probes_recorder_channel', ['recorderId', 'channel'])
@Index('IX_probes_camera', ['cameraId'])
export class Probe {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn({ nullable: true }) cameraId: number | null;
  @IntColumn({ nullable: true }) recorderId: number | null;
  @IntColumn({ nullable: true }) channel: number | null;
  /** MAIN / SUB stream used for a recorder channel without a camera */
  @StrColumn(4, { nullable: true }) streamProfile: string | null;
  /** PENDING | RUNNING | OK | FAILED | EXPIRED */
  @StrColumn(10, { default: 'PENDING' }) status: string;
  @DateTimeColumn() requestedAt: Date;
  @DateTimeColumn({ nullable: true }) claimedAt: Date | null;
  @DateTimeColumn({ nullable: true }) completedAt: Date | null;
  @IntColumn({ nullable: true }) width: number | null;
  @IntColumn({ nullable: true }) height: number | null;
  @FloatColumn({ nullable: true }) fps: number | null;
  @StrColumn(30, { nullable: true }) codec: string | null;
  @IntColumn({ nullable: true }) latencyMs: number | null;
  @StrColumn(500, { nullable: true }) error: string | null;
  @StrColumn(20, { nullable: true }) errorCode: string | null;
  /** path under UPLOAD_DIR */
  @StrColumn(300, { nullable: true }) snapshotPath: string | null;
  @IntColumn({ nullable: true }) requestedById: number | null;
}
