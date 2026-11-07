import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, DateStrColumn, DateTimeColumn, FloatColumn, IntColumn } from '../../../common/db-types';

@Entity('queue_snapshots')
@Index('IX_queue_snapshots_store_date_hour', ['storeId', 'date', 'hour'])
@Index('IX_queue_snapshots_zone_ts', ['zoneId', 'ts'])
@Index('IX_queue_snapshots_store_ts', ['storeId', 'ts'])
export class QueueSnapshot {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn() zoneId: number;
  @DateTimeColumn() ts: Date;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @IntColumn() queueLength: number;
  @FloatColumn() avgWaitSec: number;
  @BoolColumn({ default: true }) counterStaffed: boolean;
}
