import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, IntColumn, StrColumn, UpdatedAtColumn } from '../../../common/db-types';

@Entity('checklist_templates')
export class ChecklistTemplate {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(200) name: string;
  @StrColumn(1000, { default: '' }) description: string;
  @StrColumn(30, { default: 'OTHER' }) category: string;
  @StrColumn(10, { default: 'ADHOC' }) frequency: string;
  @BoolColumn({ default: true }) isActive: boolean;
  /** Incremented by every PUT; submissions record the version (and a snapshot) they were answered against. */
  @IntColumn({ default: 1 }) version: number;
  @IntColumn({ nullable: true }) createdById: number | null;
  @CreatedAtColumn() createdAt: Date;
  @UpdatedAtColumn() updatedAt: Date;
}
