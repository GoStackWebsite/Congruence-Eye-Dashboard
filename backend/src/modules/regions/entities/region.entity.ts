import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, StrColumn } from '../../../common/db-types';

@Entity('regions')
export class Region {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(100, { unique: true }) name: string;
  @CreatedAtColumn() createdAt: Date;
}
