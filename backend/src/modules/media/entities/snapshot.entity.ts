import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, DateStrColumn, DateTimeColumn, IntColumn, StrColumn } from '../../../common/db-types';

/** Every camera snapshot is kept (image directory, recaps, open/close snaps, AI Manager evidence). */
@Entity('snapshots')
@Index('IX_snapshots_store_date', ['storeId', 'date'])
@Index('IX_snapshots_camera_ts', ['cameraId', 'ts'])
@Index('IX_snapshots_store_ts', ['storeId', 'ts'])
export class Snapshot {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn() cameraId: number;
  @DateTimeColumn() ts: Date;
  /** store-local date of ts */
  @DateStrColumn() date: string;
  /** PERIODIC | EVENT | OPENING | CLOSING | AI_MANAGER | REFERENCE */
  @StrColumn(20, { default: 'PERIODIC' }) kind: string;
  /** path relative to UPLOAD_DIR (served at /uploads/<filePath>) */
  @StrColumn(400) filePath: string;
  @IntColumn({ default: 0 }) sizeBytes: number;
  @CreatedAtColumn() createdAt: Date;
}
