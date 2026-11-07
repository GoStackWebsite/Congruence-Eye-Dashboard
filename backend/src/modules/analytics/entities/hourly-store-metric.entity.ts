import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DateStrColumn, FloatColumn, IntColumn, MoneyColumn, UpdatedAtColumn } from '../../../common/db-types';

@Entity('hourly_store_metrics')
@Index('UQ_hourly_store_metrics', ['storeId', 'date', 'hour'], { unique: true })
@Index('IX_hourly_store_metrics_date', ['date'])
export class HourlyStoreMetric {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @IntColumn({ default: 0 }) footfallIn: number;
  @IntColumn({ default: 0 }) footfallOut: number;
  @IntColumn({ default: 0 }) uniqueVisitors: number;
  @IntColumn({ default: 0 }) staffEntries: number;
  @IntColumn({ default: 0 }) individuals: number;
  @IntColumn({ default: 0 }) groups: number;
  @IntColumn({ default: 0 }) billableEntities: number;
  /** engaged visits (people) */
  @IntColumn({ default: 0 }) engaged: number;
  /** engaged billable entities (a group counts once) — used for missed opportunities / funnel */
  @IntColumn({ default: 0 }) engagedEntities: number;
  @IntColumn({ default: 0 }) bounced: number;
  @IntColumn({ default: 0 }) repeatVisitors: number;
  @IntColumn({ default: 0 }) male: number;
  @IntColumn({ default: 0 }) female: number;
  @IntColumn({ default: 0 }) genderUnknown: number;
  @IntColumn({ default: 0 }) age_0_17: number;
  @IntColumn({ default: 0 }) age_18_24: number;
  @IntColumn({ default: 0 }) age_25_34: number;
  @IntColumn({ default: 0 }) age_35_44: number;
  @IntColumn({ default: 0 }) age_45_54: number;
  @IntColumn({ default: 0 }) age_55_plus: number;
  @IntColumn({ default: 0 }) ageUnknown: number;
  @IntColumn({ default: 0 }) male_0_17: number;
  @IntColumn({ default: 0 }) male_18_24: number;
  @IntColumn({ default: 0 }) male_25_34: number;
  @IntColumn({ default: 0 }) male_35_44: number;
  @IntColumn({ default: 0 }) male_45_54: number;
  @IntColumn({ default: 0 }) male_55_plus: number;
  @IntColumn({ default: 0 }) female_0_17: number;
  @IntColumn({ default: 0 }) female_18_24: number;
  @IntColumn({ default: 0 }) female_25_34: number;
  @IntColumn({ default: 0 }) female_35_44: number;
  @IntColumn({ default: 0 }) female_45_54: number;
  @IntColumn({ default: 0 }) female_55_plus: number;
  @FloatColumn({ default: 0 }) totalDwellSec: number;
  @IntColumn({ default: 0 }) dwellCount: number;
  @IntColumn({ default: 0 }) transactions: number;
  @MoneyColumn({ default: 0 }) revenue: number;
  @IntColumn({ default: 0 }) itemsSold: number;
  @FloatColumn({ default: 0 }) avgQueueLength: number;
  @IntColumn({ default: 0 }) maxQueueLength: number;
  @FloatColumn({ default: 0 }) avgWaitSec: number;
  @FloatColumn({ default: 0 }) maxWaitSec: number;
  @IntColumn({ default: 0 }) queueSamples: number;
  @IntColumn({ default: 0 }) queueBreaches: number;
  @FloatColumn({ default: 0 }) unattendedSec: number;
  @FloatColumn({ default: 0 }) staffPresentAvg: number;
  @UpdatedAtColumn() updatedAt: Date;
}

export const AGE_BANDS = ['0-17', '18-24', '25-34', '35-44', '45-54', '55+'] as const;
export const AGE_KEYS = ['0_17', '18_24', '25_34', '35_44', '45_54', '55_plus'] as const;
