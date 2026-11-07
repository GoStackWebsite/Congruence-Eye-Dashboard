import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateStrColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';

/** Day-summary video per store (H.264 mp4 built from that day's snapshots). */
@Entity('recaps')
@Index('UQ_recaps_store_date', ['storeId', 'date'], { unique: true })
export class Recap {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @DateStrColumn() date: string;
  /** PENDING | READY | FAILED */
  @StrColumn(10, { default: 'PENDING' }) status: string;
  @StrColumn(400, { nullable: true }) filePath: string | null;
  @FloatColumn({ default: 0 }) durationSec: number;
  @IntColumn({ default: 0 }) frameCount: number;
  @StrColumn(1000, { nullable: true }) error: string | null;
  @CreatedAtColumn() createdAt: Date;
}
