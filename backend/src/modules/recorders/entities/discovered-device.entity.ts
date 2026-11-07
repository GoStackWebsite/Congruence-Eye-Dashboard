import { Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, DateTimeColumn, IntColumn, StrColumn } from '../../../common/db-types';

/** A recorder / camera the store's edge box found on the LAN (WS-Discovery or RTSP port scan). */
@Entity('discovered_devices')
@Index('UQ_discovered_devices_store_host_port', ['storeId', 'host', 'rtspPort'], { unique: true })
export class DiscoveredDevice {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() storeId: number;
  @StrColumn(255) host: string;
  @IntColumn({ default: 554 }) rtspPort: number;
  @IntColumn({ nullable: true }) httpPort: number | null;
  @StrColumn(20, { nullable: true }) brandGuess: string | null;
  @BoolColumn({ default: false }) onvif: boolean;
  @DateTimeColumn() seenAt: Date;
}
