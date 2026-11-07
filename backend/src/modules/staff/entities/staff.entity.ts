import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';

@Entity('staff')
@Index('UQ_staff_store_code', ['storeId', 'code'], { unique: true })
export class Staff {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(30) code: string;
  @StrColumn(150) name: string;
  @StrColumn(100, { default: '' }) designation: string;
  @StrColumn(5, { default: '10:00' }) shiftStart: string;
  @StrColumn(5, { default: '19:00' }) shiftEnd: string;
  @BoolColumn({ default: true }) isActive: boolean;
  @CreatedAtColumn() createdAt: Date;
}
