import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, DateStrColumn, DateTimeColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';

@Entity('visitor_events')
@Index('IX_visitor_events_store_date_hour', ['storeId', 'date', 'hour'])
@Index('IX_visitor_events_store_visitor', ['storeId', 'visitorId'])
@Index('IX_visitor_events_store_ts', ['storeId', 'ts'])
export class VisitorEvent {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn() cameraId: number;
  @IntColumn({ nullable: true }) zoneId: number | null;
  @StrColumn(12) type: string;
  @DateTimeColumn() ts: Date;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @StrColumn(64) trackId: string;
  @StrColumn(128) visitorId: string;
  @BoolColumn({ default: false }) isStaff: boolean;
  @StrColumn(64, { nullable: true }) groupId: string | null;
  @StrColumn(1, { default: 'U' }) gender: string;
  @StrColumn(5, { default: 'U' }) ageBand: string;
  @FloatColumn({ nullable: true }) dwellSec: number | null;
  @CreatedAtColumn() createdAt: Date;
}
