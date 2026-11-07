import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, StrColumn } from '../../../common/db-types';

@Entity('vendors')
export class Vendor {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(200) name: string;
  @StrColumn(20, { default: 'OTHER' }) category: string;
  @StrColumn(150, { default: '' }) contactName: string;
  @StrColumn(30, { default: '' }) phone: string;
  @StrColumn(200, { default: '' }) email: string;
  @BoolColumn({ default: true }) isActive: boolean;
  @CreatedAtColumn() createdAt: Date;
}
