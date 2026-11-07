import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { DateStrColumn, IntColumn, JsonColumn, UpdatedAtColumn } from '../../../common/db-types';

/** Accumulated occupancy grid per camera / store-local date / hour (upsert by adding). */
@Entity('heatmap_frames')
@Index('UQ_heatmap_frames_camera_date_hour', ['cameraId', 'date', 'hour'], { unique: true })
@Index('IX_heatmap_frames_store_date', ['storeId', 'date'])
export class HeatmapFrame {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @IntColumn() cameraId: number;
  @DateStrColumn() date: string;
  @IntColumn() hour: number;
  @IntColumn({ default: 32 }) width: number;
  @IntColumn({ default: 18 }) height: number;
  @JsonColumn<number[]>([]) grid: number[];
  @IntColumn({ default: 0 }) samples: number;
  @UpdatedAtColumn() updatedAt: Date;
}
