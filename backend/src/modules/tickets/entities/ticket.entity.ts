import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateTimeColumn, IntColumn, StrColumn, UpdatedAtColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../users/entities/user.entity';

@Entity('tickets')
@Index('IX_tickets_store_status', ['storeId', 'status'])
export class Ticket {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(20, { default: '' }) number: string;
  @StrColumn(200) title: string;
  @StrColumn(4000, { default: '' }) description: string;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(20, { default: 'OTHER' }) category: string;
  @StrColumn(10, { default: 'MEDIUM' }) priority: string;
  @StrColumn(20, { default: 'OPEN' }) status: string;
  @IntColumn({ nullable: true }) assigneeId: number | null;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'assigneeId' })
  assignee?: User;
  @IntColumn() reporterId: number;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'reporterId' })
  reporter?: User;
  @IntColumn({ nullable: true }) alertId: number | null;
  @DateTimeColumn() slaDueAt: Date;
  @DateTimeColumn({ nullable: true }) resolvedAt: Date | null;
  @CreatedAtColumn() createdAt: Date;
  @UpdatedAtColumn() updatedAt: Date;
}
