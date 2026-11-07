import { Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';
import { User } from '../../users/entities/user.entity';

@Entity('documents')
export class DocumentFile {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(200) title: string;
  @StrColumn(20, { default: 'OTHER' }) category: string;
  @IntColumn({ nullable: true }) storeId: number | null;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(260) fileName: string;
  @StrColumn(300) storedName: string;
  @StrColumn(120, { default: 'application/octet-stream' }) mimeType: string;
  @IntColumn({ default: 0 }) size: number;
  @IntColumn() uploadedById: number;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'uploadedById' })
  uploadedBy?: User;
  @CreatedAtColumn() createdAt: Date;
}
