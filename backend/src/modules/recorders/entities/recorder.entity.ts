import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateTimeColumn, IntColumn, StrColumn, UpdatedAtColumn } from '../../../common/db-types';
import { Store } from '../../stores/entities/store.entity';

/** A DVR / NVR in a store (contract v3). The password is AES-256-GCM encrypted (see recorder-crypto.ts). */
@Entity('recorders')
@Index('UQ_recorders_store_host_port', ['storeId', 'host', 'rtspPort'], { unique: true })
export class Recorder {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_recorders_storeId')
  @IntColumn()
  storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(150) name: string;
  @StrColumn(10, { default: 'DVR' }) kind: string;
  @StrColumn(20) brand: string;
  /** lower-cased IPv4 / IPv6 / hostname */
  @StrColumn(255) host: string;
  @IntColumn({ default: 554 }) rtspPort: number;
  @IntColumn({ default: 80 }) httpPort: number;
  @StrColumn(100, { default: '' }) username: string;
  /** `v1:` + base64(iv | tag | ciphertext); null = no password */
  @StrColumn(500, { nullable: true }) passwordEnc: string | null;
  @IntColumn() channels: number;
  @StrColumn(4, { default: 'MAIN' }) stream: string;
  @StrColumn(500, { nullable: true }) urlTemplate: string | null;
  @StrColumn(10, { default: 'UNKNOWN' }) status: string;
  @DateTimeColumn({ nullable: true }) lastCheckedAt: Date | null;
  @CreatedAtColumn() createdAt: Date;
  @UpdatedAtColumn() updatedAt: Date;
}
