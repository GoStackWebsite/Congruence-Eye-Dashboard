import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, StrColumn, UpdatedAtColumn } from '../../../common/db-types';

@Entity('users')
export class User {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(200, { unique: true }) email: string;
  @StrColumn(150) name: string;
  @StrColumn(200) passwordHash: string;
  @StrColumn(30) role: string;
  @BoolColumn({ default: true }) isActive: boolean;
  @CreatedAtColumn() createdAt: Date;
  @UpdatedAtColumn() updatedAt: Date;
}
