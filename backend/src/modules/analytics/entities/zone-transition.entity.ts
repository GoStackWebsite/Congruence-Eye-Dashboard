import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DateStrColumn, IntColumn } from '../../../common/db-types';

/** Daily zone-to-zone movement counts. fromZoneId 0 = Entrance. */
@Entity('zone_transitions')
@Index('IX_zone_transitions_store_date', ['storeId', 'date'])
export class ZoneTransition {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @DateStrColumn() date: string;
  @IntColumn() fromZoneId: number;
  @IntColumn() toZoneId: number;
  @IntColumn({ default: 0 }) count: number;
}
