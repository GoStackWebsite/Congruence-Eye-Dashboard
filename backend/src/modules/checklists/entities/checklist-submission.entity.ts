import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, DateStrColumn, DateTimeColumn, FloatColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../users/entities/user.entity';
import { ChecklistTemplate } from './checklist-template.entity';

@Entity('checklist_submissions')
@Index('IX_checklist_submissions_store_date', ['storeId', 'date'])
export class ChecklistSubmission {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn({ nullable: true }) assignmentId: number | null;
  @IntColumn() templateId: number;
  @ManyToOne(() => ChecklistTemplate, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'templateId' })
  template?: ChecklistTemplate;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @IntColumn() submittedById: number;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'submittedById' })
  submittedBy?: User;
  @DateTimeColumn() submittedAt: Date;
  @DateStrColumn() date: string;
  @FloatColumn({ default: 0 }) score: number;
  @FloatColumn({ default: 0 }) maxScore: number;
  @FloatColumn({ default: 0 }) scorePct: number;
  @StrColumn(20, { default: 'SUBMITTED' }) status: string;
  @IntColumn({ default: 0 }) flags: number;
  @StrColumn(2000, { nullable: true }) reviewerComment: string | null;
  @IntColumn({ nullable: true }) reviewedById: number | null;
  @DateTimeColumn({ nullable: true }) reviewedAt: Date | null;
  /** Template version the answers were given against (null for rows created before versioning). */
  @IntColumn({ nullable: true }) templateVersion: number | null;
  /** Template (incl. questions) exactly as answered — later template edits do not change history. */
  @JsonColumn<Record<string, unknown> | null>(null, { nullable: true }) templateSnapshot: Record<string, unknown> | null;
  /** Submitted after the assignment's deadline. */
  @BoolColumn({ default: false }) isLate: boolean;
}
