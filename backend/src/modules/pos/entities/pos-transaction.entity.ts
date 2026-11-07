import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateStrColumn, DateTimeColumn, IntColumn, MoneyColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';

@Entity('pos_transactions')
@Index('UQ_pos_transactions_store_bill', ['storeId', 'billNo'], { unique: true })
@Index('IX_pos_transactions_store_date_hour', ['storeId', 'date', 'hour'])
@Index('IX_pos_transactions_store_ts', ['storeId', 'ts'])
export class PosTransaction {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(60) billNo: string;
  @DateTimeColumn() ts: Date;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @MoneyColumn() amount: number;
  @IntColumn({ default: 1 }) itemsCount: number;
  @StrColumn(30, { nullable: true }) staffCode: string | null;
  @StrColumn(10, { default: 'API' }) source: string;
  @CreatedAtColumn() createdAt: Date;
}
