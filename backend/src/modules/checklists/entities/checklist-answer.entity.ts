import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, FloatColumn, IntColumn, JsonColumn, StrColumn, TextColumn } from '../../../common/db-types';

export interface AiResult {
  status: 'PASS' | 'FAIL' | 'ERROR' | 'SKIPPED';
  score: number;
  message: string;
  issues: string[];
  annotatedUrl?: string;
}
import { ChecklistQuestion } from './checklist-question.entity';
import { ChecklistSubmission } from './checklist-submission.entity';

@Entity('checklist_answers')
export class ChecklistAnswer {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_checklist_answers_submission')
  @IntColumn()
  submissionId: number;
  @ManyToOne(() => ChecklistSubmission, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'submissionId' })
  submission?: ChecklistSubmission;
  @IntColumn() questionId: number;
  @ManyToOne(() => ChecklistQuestion, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'questionId' })
  question?: ChecklistQuestion;
  @TextColumn({ nullable: true }) value: string | null;
  @StrColumn(500, { nullable: true }) photoUrl: string | null;
  @StrColumn(1000, { nullable: true }) remark: string | null;
  @FloatColumn({ default: 0 }) score: number;
  @FloatColumn({ default: 0 }) maxScore: number;
  @BoolColumn({ default: false }) redo: boolean;
  @JsonColumn<AiResult | null>(null, { nullable: true }) aiResult: AiResult | null;
  @BoolColumn({ default: false }) flagged: boolean;
}
