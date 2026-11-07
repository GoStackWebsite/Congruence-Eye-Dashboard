import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateStrColumn, DateTimeColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../users/entities/user.entity';
import { ChecklistTemplate } from './checklist-template.entity';

@Entity('checklist_assignments')
@Index('IX_checklist_assignments_store_due', ['storeId', 'dueDate'])
@Index('IX_checklist_assignments_assignee', ['assigneeId', 'status'])
@Index('IX_checklist_assignments_status_due', ['status', 'dueAt'])
export class ChecklistAssignment {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() templateId: number;
  @ManyToOne(() => ChecklistTemplate, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'templateId' })
  template?: ChecklistTemplate;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @IntColumn() assigneeId: number;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'assigneeId' })
  assignee?: User;
  @IntColumn({ nullable: true }) assignedById: number | null;
  @DateStrColumn() dueDate: string;
  @StrColumn(20, { default: 'PENDING' }) status: string;
  @IntColumn({ nullable: true }) submissionId: number | null;
  /** deadline (UTC); defaults to 23:59 store-local on dueDate */
  @DateTimeColumn({ nullable: true }) dueAt: Date | null;
  @DateTimeColumn({ nullable: true }) windowStart: Date | null;
  @IntColumn({ nullable: true }) scheduleId: number | null;
  @JsonColumn<unknown[] | null>(null, { nullable: true }) draftAnswers: unknown[] | null;
  @DateTimeColumn({ nullable: true }) remindedAt: Date | null;
  @CreatedAtColumn() createdAt: Date;
}
