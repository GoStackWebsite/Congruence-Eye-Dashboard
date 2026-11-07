import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const ZONE_TYPES = ['ENTRY_LINE', 'SECTION', 'QUEUE', 'STAFF_ONLY', 'SHELF'];
export const DIRECTIONS = ['UP', 'DOWN', 'LEFT', 'RIGHT'];

export class CreateZoneDto {
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @IsInt() cameraId: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiProperty({ enum: ZONE_TYPES }) @IsIn(ZONE_TYPES) type: string;
  @ApiProperty({ example: [[0.1, 0.1], [0.5, 0.1], [0.5, 0.5]] }) @IsArray() @ArrayMinSize(2) polygon: [number, number][];
  @ApiPropertyOptional({ enum: DIRECTIONS }) @IsOptional() @IsIn(DIRECTIONS) inDirection?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(36000) engagedDwellSec?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) queueAlertLength?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) queueAlertWaitSec?: number;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() referenceSnapshotId?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateZoneDto extends PartialType(OmitType(CreateZoneDto, ['storeId'] as const)) {}
