import { Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, FloatColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';

@Entity('alert_rules')
export class AlertRule {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(150) name: string;
  @IntColumn({ nullable: true }) storeId: number | null;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(30) metric: string;
  @FloatColumn() threshold: number;
  @StrColumn(10, { default: 'MEDIUM' }) severity: string;
  @JsonColumn<string[]>(['IN_APP']) channels: string[];
  @StrColumn(1000, { nullable: true }) emails: string | null;
  @StrColumn(500, { nullable: true }) webhookUrl: string | null;
  @IntColumn({ default: 30 }) cooldownMin: number;
  @BoolColumn({ default: false }) autoTicket: boolean;
  @BoolColumn({ default: true }) isActive: boolean;
  @CreatedAtColumn() createdAt: Date;
}
