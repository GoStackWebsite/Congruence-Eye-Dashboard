import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateStrColumn, DateTimeColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';

@Entity('ai_detections')
@Index('IX_ai_detections_store_date', ['storeId', 'date'])
@Index('IX_ai_detections_rule_store_date', ['ruleId', 'storeId', 'date'])
@Index('IX_ai_detections_ts', ['ts'])
@Index('IX_ai_detections_store_ts', ['storeId', 'ts'])
export class AiDetection {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn({ nullable: true }) ruleId: number | null;
  @StrColumn(30) type: string;
  @IntColumn() storeId: number;
  @IntColumn() cameraId: number;
  @IntColumn({ nullable: true }) zoneId: number | null;
  @DateTimeColumn() ts: Date;
  @DateStrColumn() date: string;
  /** BREACHED | COMPLIED */
  @StrColumn(10) status: string;
  @StrColumn(1000, { nullable: true }) details: string | null;
  @FloatColumn({ nullable: true }) confidence: number | null;
  @IntColumn({ nullable: true }) snapshotId: number | null;
  /** VALID | FALSE_POSITIVE | null */
  @StrColumn(20, { nullable: true }) reviewStatus: string | null;
  @IntColumn({ nullable: true }) reviewedById: number | null;
  @IntColumn({ nullable: true }) alertId: number | null;
  @CreatedAtColumn() createdAt: Date;
}
