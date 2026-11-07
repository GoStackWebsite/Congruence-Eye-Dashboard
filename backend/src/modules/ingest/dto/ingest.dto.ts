import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength,
  ValidateNested,
} from 'class-validator';

/** Edge timestamps must carry a UTC offset ("…Z" or "+05:30"); a bare local time would be parsed in the server's zone. */
export const ISO_WITH_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
export const TS_OFFSET_MSG = 'ts must be an ISO-8601 timestamp with a UTC offset, e.g. 2026-10-05T04:30:00.000Z';
/** Upper bound for dwell values (7 days) — anything larger is a tracker bug. */
export const MAX_DWELL_SEC = 7 * 86400;

export const EVENT_TYPES =['ENTRY', 'EXIT', 'ZONE_ENTER', 'ZONE_EXIT', 'PASS_BY'];   // PASS_BY: crossed the street-side line (capture rate)
export const GENDERS = ['M', 'F', 'U'];
export const AGE_BAND_VALUES = ['0-17', '18-24', '25-34', '35-44', '45-54', '55+', 'U'];
export const STOREOPS_TYPES = ['STORE_OPENED', 'STORE_CLOSED', 'SOP_BREACH', 'COUNTER_UNATTENDED', 'STAFF_ABSENT', 'LIGHTS_OFF', 'CAMERA_TAMPER', 'COUNT_AUDIT'];   // COUNT_AUDIT: manual count vs engine, details = JSON

export class VisitorEventDto {
  @ApiProperty() @IsInt() cameraId: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() zoneId?: number | null;
  @ApiProperty({ enum: EVENT_TYPES }) @IsIn(EVENT_TYPES) type: string;
  @ApiProperty() @IsISO8601() @Matches(ISO_WITH_OFFSET, { message: TS_OFFSET_MSG }) ts: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(64) trackId: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(128) visitorId: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isStaff?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) groupId?: string | null;
  @ApiPropertyOptional({ enum: GENDERS }) @IsOptional() @IsIn(GENDERS) gender?: string;
  @ApiPropertyOptional({ enum: AGE_BAND_VALUES }) @IsOptional() @IsIn(AGE_BAND_VALUES) ageBand?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(MAX_DWELL_SEC) dwellSec?: number;
}
export class IngestEventsDto {
  @ApiProperty({ type: [VisitorEventDto] }) @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => VisitorEventDto)
  events: VisitorEventDto[];
}

export class QueueSnapshotDto {
  @ApiProperty() @IsInt() zoneId: number;
  @ApiProperty() @IsISO8601() @Matches(ISO_WITH_OFFSET, { message: TS_OFFSET_MSG }) ts: string;
  @ApiProperty() @IsInt() @Min(0) queueLength: number;
  @ApiProperty() @IsNumber() @Min(0) avgWaitSec: number;
  @ApiProperty() @IsBoolean() counterStaffed: boolean;
}
export class IngestQueueDto {
  @ApiProperty({ type: [QueueSnapshotDto] }) @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => QueueSnapshotDto)
  snapshots: QueueSnapshotDto[];
}

export class HeatmapDto {
  @ApiProperty() @IsInt() cameraId: number;
  @ApiProperty() @IsISO8601() @Matches(ISO_WITH_OFFSET, { message: TS_OFFSET_MSG }) ts: string;
  @ApiProperty({ default: 32 }) @IsInt() @Min(1) @Max(256) width: number;
  @ApiProperty({ default: 18 }) @IsInt() @Min(1) @Max(256) height: number;
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMaxSize(65536) @IsNumber({ allowNaN: false, allowInfinity: false }, { each: true }) grid: number[];
}

export class CameraHeartbeatDto {
  @ApiProperty() @IsInt() cameraId: number;
  @ApiProperty({ enum: ['ONLINE', 'OFFLINE'] }) @IsIn(['ONLINE', 'OFFLINE']) status: 'ONLINE' | 'OFFLINE';
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) fps?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(300) reason?: string;
}
export class HeartbeatDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(50) version?: string;
  @ApiProperty({ type: [CameraHeartbeatDto] }) @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => CameraHeartbeatDto)
  cameras: CameraHeartbeatDto[];
}

export class StoreOpsEventDto {
  @ApiProperty({ enum: STOREOPS_TYPES }) @IsIn(STOREOPS_TYPES) type: string;
  @ApiProperty() @IsISO8601() @Matches(ISO_WITH_OFFSET, { message: TS_OFFSET_MSG }) ts: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() cameraId?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) details?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() snapshotId?: number | null;
}
export class IngestStoreOpsDto {
  @ApiProperty({ type: [StoreOpsEventDto] }) @IsArray() @ArrayMaxSize(5000) @ValidateNested({ each: true }) @Type(() => StoreOpsEventDto)
  events: StoreOpsEventDto[];
}
