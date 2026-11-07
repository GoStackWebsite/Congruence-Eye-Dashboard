import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DateTimeColumn, IntColumn, StrColumn } from '../../../common/db-types';

/** One row per status interval of a camera (ONLINE/OFFLINE). endedAt null = current state. */
@Entity('camera_status_log')
@Index('IX_camera_status_log_camera', ['cameraId', 'startedAt'])
@Index('IX_camera_status_log_store', ['storeId', 'startedAt'])
export class CameraStatusLog {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn() cameraId: number;
  @StrColumn(20) status: string;
  @DateTimeColumn() startedAt: Date;
  @DateTimeColumn({ nullable: true }) endedAt: Date | null;
  @StrColumn(300, { nullable: true }) reason: string | null;
}
