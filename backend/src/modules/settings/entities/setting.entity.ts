import { Entity, PrimaryColumn } from 'typeorm';
import { TextColumn } from '../../../common/db-types';

@Entity('settings')
export class Setting {
  @PrimaryColumn({ type: 'nvarchar', length: 100 }) key: string;
  @TextColumn({ nullable: true }) value: string | null;
}
