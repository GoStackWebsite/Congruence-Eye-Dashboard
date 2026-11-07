import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateTimeColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { AlertRule } from './alert-rule.entity';

@Entity('alerts')
@Index('IX_alerts_store_status', ['storeId', 'status'])
@Index('IX_alerts_rule_store_created', ['ruleId', 'storeId', 'createdAt'])
@Index('IX_alerts_createdAt', ['createdAt'])
export class Alert {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn({ nullable: true }) ruleId: number | null;
  @ManyToOne(() => AlertRule, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'ruleId' })
  rule?: AlertRule;
  @StrColumn(150) ruleName: string;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(30) metric: string;
  @StrColumn(10) severity: string;
  @StrColumn(1000) message: string;
  @FloatColumn({ default: 0 }) value: number;
  @StrColumn(20, { default: 'OPEN' }) status: string;
  @CreatedAtColumn() createdAt: Date;
  @DateTimeColumn({ nullable: true }) acknowledgedAt: Date | null;
  @IntColumn({ nullable: true }) acknowledgedById: number | null;
  @DateTimeColumn({ nullable: true }) resolvedAt: Date | null;
  @IntColumn({ nullable: true }) resolvedById: number | null;
  @IntColumn({ nullable: true }) ticketId: number | null;
}
