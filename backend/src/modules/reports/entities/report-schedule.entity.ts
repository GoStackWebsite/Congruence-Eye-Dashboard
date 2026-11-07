import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, DateTimeColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';

@Entity('report_schedules')
export class ReportSchedule {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(200) name: string;
  @StrColumn(20) type: string;
  @StrColumn(5, { default: 'xlsx' }) format: string;
  @JsonColumn<number[]>([]) storeIds: number[];
  @StrColumn(10, { default: 'DAILY' }) frequency: string;
  @StrColumn(1000, { default: '' }) recipients: string;
  @BoolColumn({ default: true }) isActive: boolean;
  @DateTimeColumn({ nullable: true }) lastRunAt: Date | null;
  @StrColumn(500, { nullable: true }) lastFile: string | null;
  @IntColumn({ nullable: true }) createdById: number | null;
  @CreatedAtColumn() createdAt: Date;
}
