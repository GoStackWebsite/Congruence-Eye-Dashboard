import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateTimeColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';

@Entity('edge_devices')
export class EdgeDevice {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_edge_devices_storeId')
  @IntColumn()
  storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(150) name: string;
  /** sha256 hex of the plaintext key */
  @StrColumn(64, { unique: true }) apiKeyHash: string;
  @StrColumn(12) apiKeyPrefix: string;
  @StrColumn(50, { nullable: true }) version: string | null;
  @DateTimeColumn({ nullable: true }) lastSeenAt: Date | null;
  @CreatedAtColumn() createdAt: Date;
}
