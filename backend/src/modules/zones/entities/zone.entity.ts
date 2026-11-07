import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, IntColumn, JsonColumn, StrColumn } from '../../../common/db-types';
import { Camera } from '../../cameras/entities/camera.entity';
import { Store } from '../../stores/entities/store.entity';

@Entity('zones')
export class Zone {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_zones_storeId')
  @IntColumn()
  storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @Index('IX_zones_cameraId')
  @IntColumn()
  cameraId: number;
  @ManyToOne(() => Camera, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'cameraId' })
  camera?: Camera;
  @StrColumn(150) name: string;
  @StrColumn(20) type: string;
  @JsonColumn<[number, number][]>([]) polygon: [number, number][];
  @StrColumn(10, { nullable: true }) inDirection: string | null;
  @IntColumn({ default: 30 }) engagedDwellSec: number;
  @IntColumn({ nullable: true }) queueAlertLength: number | null;
  @IntColumn({ nullable: true }) queueAlertWaitSec: number | null;
  /** SHELF zones: snapshot showing the fully stocked shelf */
  @IntColumn({ nullable: true }) referenceSnapshotId: number | null;
  @BoolColumn({ default: true }) isActive: boolean;
  @CreatedAtColumn() createdAt: Date;
}
