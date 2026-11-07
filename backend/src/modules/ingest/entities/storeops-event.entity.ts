import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateStrColumn, DateTimeColumn, IntColumn, StrColumn } from '../../../common/db-types';

@Entity('storeops_events')
@Index('IX_storeops_events_store_date', ['storeId', 'date'])
@Index('IX_storeops_events_store_ts', ['storeId', 'ts'])
export class StoreOpsEvent {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn({ nullable: true }) cameraId: number | null;
  @StrColumn(30) type: string;
  @DateTimeColumn() ts: Date;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @StrColumn(1000, { nullable: true }) details: string | null;
  @IntColumn({ nullable: true }) snapshotId: number | null;
  @CreatedAtColumn() createdAt: Date;
}
