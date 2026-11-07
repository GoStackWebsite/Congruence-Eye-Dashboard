import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, DateTimeColumn, FloatColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { Recorder } from '../../recorders/entities/recorder.entity';
import { Store } from '../../stores/entities/store.entity';

@Entity('cameras')
export class Camera {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_cameras_storeId')
  @IntColumn()
  storeId: number;
  @ManyToOne(() => Store, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
  @StrColumn(150) name: string;
  @StrColumn(500, { default: '' }) rtspUrl: string;
  @StrColumn(20, { default: 'GENERAL' }) type: string;
  @StrColumn(20, { default: 'UNKNOWN' }) status: string;
  @DateTimeColumn({ nullable: true }) lastHeartbeatAt: Date | null;
  @BoolColumn({ default: true }) isActive: boolean;
  @FloatColumn({ nullable: true }) fps: number | null;
  /** contract v3: DVR / NVR channel. For a linked camera rtspUrl holds the MASKED url (no password). */
  @Index('IX_cameras_recorderId')
  @IntColumn({ nullable: true })
  recorderId: number | null;
  @ManyToOne(() => Recorder, { onDelete: 'NO ACTION', nullable: true })
  @JoinColumn({ name: 'recorderId' })
  recorder?: Recorder | null;
  @IntColumn({ nullable: true }) channel: number | null;
  @StrColumn(4, { nullable: true }) streamProfile: string | null;
  @CreatedAtColumn() createdAt: Date;
}
