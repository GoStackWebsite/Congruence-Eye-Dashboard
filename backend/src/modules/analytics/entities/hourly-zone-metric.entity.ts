import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DateStrColumn, FloatColumn, IntColumn, UpdatedAtColumn } from '../../../common/db-types';

@Entity('hourly_zone_metrics')
@Index('UQ_hourly_zone_metrics', ['zoneId', 'date', 'hour'], { unique: true })
@Index('IX_hourly_zone_metrics_store_date_hour', ['storeId', 'date', 'hour'])
export class HourlyZoneMetric {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn() zoneId: number;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @IntColumn({ default: 0 }) visits: number;
  @IntColumn({ default: 0 }) uniqueVisitors: number;
  @FloatColumn({ default: 0 }) totalDwellSec: number;
  @IntColumn({ default: 0 }) dwellCount: number;
  @IntColumn({ default: 0 }) engaged: number;
  @IntColumn({ default: 0 }) male: number;
  @IntColumn({ default: 0 }) female: number;
  /** zone exits with dwell < the zone's engagedDwellSec */
  @IntColumn({ default: 0 }) bounced: number;
  @IntColumn({ default: 0 }) age_0_17: number;
  @IntColumn({ default: 0 }) age_18_24: number;
  @IntColumn({ default: 0 }) age_25_34: number;
  @IntColumn({ default: 0 }) age_35_44: number;
  @IntColumn({ default: 0 }) age_45_54: number;
  @IntColumn({ default: 0 }) age_55_plus: number;
  // queue zones only
  @IntColumn({ default: 0 }) queueSamples: number;
  @FloatColumn({ default: 0 }) avgQueueLength: number;
  @IntColumn({ default: 0 }) maxQueueLength: number;
  @FloatColumn({ default: 0 }) avgWaitSec: number;
  @FloatColumn({ default: 0 }) maxWaitSec: number;
  @IntColumn({ default: 0 }) queueBreaches: number;
  @FloatColumn({ default: 0 }) unattendedSec: number;
  @UpdatedAtColumn() updatedAt: Date;
}
