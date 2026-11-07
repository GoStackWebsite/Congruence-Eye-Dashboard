import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, FloatColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';
import { ChecklistTemplate } from './checklist-template.entity';

@Entity('checklist_questions')
export class ChecklistQuestion {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_checklist_questions_template')
  @IntColumn()
  templateId: number;
  @ManyToOne(() => ChecklistTemplate, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'templateId' })
  template?: ChecklistTemplate;
  @StrColumn(150, { default: 'General' }) section: string;
  @StrColumn(1000) text: string;
  @StrColumn(20) type: string;
  @JsonColumn<string[]>([], { nullable: true }) options: string[];
  @JsonColumn<string[]>([], { nullable: true }) correctOptions: string[];
  @BoolColumn({ default: true }) required: boolean;
  @FloatColumn({ default: 1 }) weight: number;
  @BoolColumn({ default: false }) requiresPhoto: boolean;
  @IntColumn({ default: 0 }) sortOrder: number;
  @FloatColumn({ nullable: true }) minValue: number | null;
  @FloatColumn({ nullable: true }) maxValue: number | null;
  @StrColumn(500, { nullable: true }) referenceImageUrl: string | null;
  /** NONE | REFERENCE_MATCH | UNIFORM */
  @StrColumn(20, { default: 'NONE' }) aiCheck: string;
  @BoolColumn({ default: false }) createTaskOnFail: boolean;
  /** questions removed by a template PUT are retired (kept for historic answers) */
  @BoolColumn({ default: true }) isActive: boolean;
}
