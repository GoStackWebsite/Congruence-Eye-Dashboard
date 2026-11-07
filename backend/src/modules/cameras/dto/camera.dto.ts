import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export const CAMERA_TYPES = ['ENTRANCE', 'ZONE', 'BILLING', 'GENERAL'];

export class CreateCameraDto {
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) rtspUrl?: string;
  @ApiProperty({ enum: CAMERA_TYPES }) @IsIn(CAMERA_TYPES) type: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(240) fps?: number;
  /** contract v3: link to a DVR / NVR channel (null unlinks) */
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() recorderId?: number | null;
  @ApiPropertyOptional({ nullable: true, minimum: 1, maximum: 64 }) @IsOptional() @IsInt() @Min(1) @Max(64) channel?: number | null;
  @ApiPropertyOptional({ enum: ['MAIN', 'SUB'], nullable: true }) @IsOptional() @IsIn(['MAIN', 'SUB']) streamProfile?: string | null;
}
export class UpdateCameraDto extends PartialType(OmitType(CreateCameraDto, ['storeId'] as const)) {}
