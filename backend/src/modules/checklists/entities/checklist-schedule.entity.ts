import { Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, DateStrColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';
import { ChecklistTemplate } from './checklist-template.entity';

/** Smart scheduling: generates checklist assignments per store with a time window. */
@Entity('checklist_schedules')
export class ChecklistSchedule {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() templateId: number;
  @ManyToOne(() => ChecklistTemplate, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'templateId' })
  template?: ChecklistTemplate;
  @JsonColumn<number[]>([]) storeIds: number[];
  /** null = each store's manager */
  @IntColumn({ nullable: true }) assigneeId: number | null;
  /** ONCE | DAILY | WEEKLY | MONTHLY */
  @StrColumn(10, { default: 'DAILY' }) frequency: string;
  @IntColumn({ default: 1 }) repeatEvery: number;
  @JsonColumn<number[]>([]) daysOfWeek: number[];
  @IntColumn({ nullable: true }) dayOfMonth: number | null;
  @StrColumn(5, { default: '09:00' }) windowStart: string;
  @StrColumn(5, { default: '18:00' }) windowEnd: string;
  @DateStrColumn() startDate: string;
  @DateStrColumn({ nullable: true }) endDate: string | null;
  @IntColumn({ default: 60 }) reminderMinutesBefore: number;
  @BoolColumn({ default: true }) isActive: boolean;
  @DateStrColumn({ nullable: true }) lastGeneratedDate: string | null;
  @IntColumn({ nullable: true }) createdById: number | null;
  @CreatedAtColumn() createdAt: Date;
}
