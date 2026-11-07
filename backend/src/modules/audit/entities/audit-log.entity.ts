import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, IntColumn, StrColumn, TextColumn } from '../../../common/db-types';

@Entity('audit_logs')
@Index('IX_audit_logs_createdAt', ['createdAt'])
@Index('IX_audit_logs_user', ['userId'])
export class AuditLog {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn({ nullable: true }) userId: number | null;
  @StrColumn(150, { default: '' }) userName: string;
  @StrColumn(30) action: string;
  @StrColumn(60) entity: string;
  @IntColumn({ nullable: true }) entityId: number | null;
  @TextColumn({ nullable: true }) details: string | null;
  @CreatedAtColumn() createdAt: Date;
}
