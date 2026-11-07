import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateTimeColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { Vendor } from './vendor.entity';

@Entity('vendor_visits')
@Index('IX_vendor_visits_store_sched', ['storeId', 'scheduledAt'])
export class VendorVisit {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() vendorId: number;
  @ManyToOne(() => Vendor, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'vendorId' })
  vendor?: Vendor;
  @IntColumn() storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(500, { default: '' }) purpose: string;
  @DateTimeColumn() scheduledAt: Date;
  @DateTimeColumn({ nullable: true }) checkInAt: Date | null;
  @DateTimeColumn({ nullable: true }) checkOutAt: Date | null;
  @StrColumn(20, { default: 'SCHEDULED' }) status: string;
  @IntColumn({ nullable: true }) rating: number | null;
  @StrColumn(2000, { nullable: true }) notes: string | null;
  @IntColumn({ nullable: true }) createdById: number | null;
  @CreatedAtColumn() createdAt: Date;
}
