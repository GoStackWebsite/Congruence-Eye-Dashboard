import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Region } from '../../regions/entities/region.entity';

@Entity('stores')
export class Store {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(30, { unique: true }) code: string;
  @StrColumn(150) name: string;
  @Index('IX_stores_regionId')
  @IntColumn()
  regionId: number;
  @ManyToOne(() => Region, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'regionId' })
  region?: Region;
  @StrColumn(100, { default: '' }) city: string;
  @StrColumn(400, { default: '' }) address: string;
  @StrColumn(64, { default: 'Asia/Kolkata' }) timezone: string;
  @StrColumn(5, { default: '10:00' }) openTime: string;
  @StrColumn(5, { default: '21:30' }) closeTime: string;
  @IntColumn({ default: 0 }) areaSqft: number;
  /** HIGH_STREET | MALL | AIRPORT | OUTLET | KIOSK */
  @StrColumn(20, { default: 'HIGH_STREET' }) format: string;
  @BoolColumn({ default: true }) isActive: boolean;
  @FloatColumn({ nullable: true }) latitude: number | null;
  @FloatColumn({ nullable: true }) longitude: number | null;
  @CreatedAtColumn() createdAt: Date;
}
