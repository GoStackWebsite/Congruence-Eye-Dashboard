import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength,
  registerDecorator, ValidateNested, ValidationOptions,
} from 'class-validator';
import { CAMERA_TYPES } from '../../cameras/dto/camera.dto';
import { isValidHost, RECORDER_BRANDS, RECORDER_KINDS, STREAM_PROFILES } from '../recorder-url';

export function IsHost(options?: ValidationOptions) {
  return (object: object, propertyName: string) =>
    registerDecorator({
      name: 'isHost',
      target: object.constructor,
      propertyName,
      options: { message: `${propertyName} must be an IPv4 address, an IPv6 address or a hostname`, ...options },
      validator: { validate: (v: unknown) => isValidHost(v) },
    });
}

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class CreateRecorderDto {
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @Transform(trim) @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiProperty({ enum: RECORDER_KINDS }) @IsIn(RECORDER_KINDS as unknown as string[]) kind: string;
  @ApiProperty({ enum: RECORDER_BRANDS }) @IsIn(RECORDER_BRANDS as unknown as string[]) brand: string;
  @ApiProperty({ description: 'IPv4, IPv6 or hostname' }) @Transform(trim) @IsHost() host: string;
  @ApiPropertyOptional({ default: 554 }) @IsOptional() @IsInt() @Min(1) @Max(65535) rtspPort?: number;
  @ApiPropertyOptional({ default: 80 }) @IsOptional() @IsInt() @Min(1) @Max(65535) httpPort?: number;
  @ApiProperty() @IsString() @MaxLength(100) username: string;
  @ApiPropertyOptional({ description: 'write-only; omit (or "") to keep on PATCH, null to clear' })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  password?: string | null;
  @ApiProperty({ minimum: 1, maximum: 64 }) @IsInt() @Min(1) @Max(64) channels: number;
  @ApiPropertyOptional({ enum: STREAM_PROFILES, default: 'MAIN' }) @IsOptional() @IsIn(STREAM_PROFILES as unknown as string[]) stream?: string;
  @ApiPropertyOptional({ description: 'CUSTOM only: rtsp://… containing {channel}' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  urlTemplate?: string | null;
}

export class UpdateRecorderDto extends PartialType(OmitType(CreateRecorderDto, ['storeId'] as const)) {}

export class GenerateCamerasDto {
  @ApiProperty({ type: [Number] })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(64, { each: true })
  channels: number[];
  @ApiPropertyOptional({ enum: CAMERA_TYPES, default: 'GENERAL' }) @IsOptional() @IsIn(CAMERA_TYPES) type?: string;
  @ApiPropertyOptional({ default: 'Channel' }) @IsOptional() @IsString() @MaxLength(120) namePrefix?: string;
}

export class TestChannelsDto {
  @ApiPropertyOptional({ type: [Number], description: 'default: every channel' })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(64)
  @IsInt({ each: true })
  @Min(1, { each: true })
  @Max(64, { each: true })
  channels?: number[];
}

export const PROBE_ERROR_CODES = ['AUTH', 'TIMEOUT', 'UNREACHABLE', 'NOT_FOUND', 'UNSUPPORTED_CODEC', 'EDGE_OFFLINE', 'OTHER'] as const;
export const PROBE_STATUSES = ['PENDING', 'RUNNING', 'OK', 'FAILED', 'EXPIRED'] as const;

/** The `result` JSON of POST /api/ingest/probes/:id. */
export class ProbeResultDto {
  @IsIn(['OK', 'FAILED']) status: 'OK' | 'FAILED';
  @IsOptional() @IsInt() @Min(0) @Max(100000) width?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(100000) height?: number | null;
  @IsOptional() @IsNumber() @Min(0) @Max(1000) fps?: number | null;
  @IsOptional() @IsString() @MaxLength(30) codec?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(3_600_000) latencyMs?: number | null;
  @IsOptional() @IsString() @MaxLength(2000) error?: string | null;
  @IsOptional() @IsIn(PROBE_ERROR_CODES as unknown as string[]) errorCode?: string | null;
}

export class DiscoveredDeviceDto {
  @IsHost() host: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) port?: number;
  @IsOptional() @IsInt() @Min(1) @Max(65535) rtspPort?: number;
  @IsOptional() @IsInt() @Min(1) @Max(65535) httpPort?: number | null;
  @IsOptional() @IsString() @MaxLength(20) brandGuess?: string | null;
  @IsOptional() @IsBoolean() onvif?: boolean;
}

export class IngestDiscoveredDto {
  @IsArray() @ArrayMaxSize(1024) @ValidateNested({ each: true }) @Type(() => DiscoveredDeviceDto) devices: DiscoveredDeviceDto[];
}
