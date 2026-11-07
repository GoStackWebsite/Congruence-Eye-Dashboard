import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, DateStrColumn, DateTimeColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';

/** One row per visit, built from ENTRY/EXIT (and linked ZONE_EXIT) events by visitorId. */
@Entity('visits')
@Index('IX_visits_store_date_hour', ['storeId', 'date', 'hour'])
@Index('IX_visits_store_visitor', ['storeId', 'visitorId', 'entryTs'])
@Index('IX_visits_open', ['storeId', 'exitTs'])
@Index('IX_visits_stale', ['exitTs', 'entryTs'])
export class Visit {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @StrColumn(128) visitorId: string;
  @StrColumn(64, { default: '' }) trackId: string;
  @DateTimeColumn() entryTs: Date;
  @DateTimeColumn({ nullable: true }) exitTs: Date | null;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @FloatColumn({ nullable: true }) dwellSec: number | null;
  @BoolColumn({ default: false }) isStaff: boolean;
  @StrColumn(64, { nullable: true }) groupId: string | null;
  @StrColumn(1, { default: 'U' }) gender: string;
  @StrColumn(5, { default: 'U' }) ageBand: string;
  @BoolColumn({ default: false }) engaged: boolean;
  /** engaged because a zone dwell exceeded that zone's engagedDwellSec */
  @BoolColumn({ default: false }) zoneEngaged: boolean;
  @BoolColumn({ default: false }) bounced: boolean;
  @BoolColumn({ default: false }) isRepeat: boolean;
  @FloatColumn({ default: 0 }) maxZoneDwellSec: number;
  @BoolColumn({ default: false }) autoClosed: boolean;
}
