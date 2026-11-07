import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateTimeColumn, IntColumn, StrColumn, UpdatedAtColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../users/entities/user.entity';

@Entity('tasks')
@Index('IX_tasks_store_status', ['storeId', 'status'])
@Index('IX_tasks_assignee', ['assigneeId'])
export class Task {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(200) title: string;
  @StrColumn(2000, { default: '' }) description: string;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @IntColumn({ nullable: true }) zoneId: number | null;
  @StrColumn(30, { default: 'GENERAL' }) type: string;
  @StrColumn(10, { default: 'MEDIUM' }) priority: string;
  @StrColumn(20, { default: 'TODO' }) status: string;
  @IntColumn({ nullable: true }) assigneeId: number | null;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'assigneeId' })
  assignee?: User;
  @IntColumn() createdById: number;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'createdById' })
  createdBy?: User;
  @DateTimeColumn({ nullable: true }) dueAt: Date | null;
  @DateTimeColumn({ nullable: true }) completedAt: Date | null;
  @DateTimeColumn({ nullable: true }) verifiedAt: Date | null;
  @IntColumn({ nullable: true }) verifiedById: number | null;
  /** task becomes visible to the assignee from this time */
  @DateTimeColumn({ nullable: true }) startAt: Date | null;
  @IntColumn({ nullable: true }) checklistAnswerId: number | null;
  @StrColumn(500, { nullable: true }) proofUrl: string | null;
  @StrColumn(2000, { nullable: true }) remark: string | null;
  @CreatedAtColumn() createdAt: Date;
  @UpdatedAtColumn() updatedAt: Date;
}
