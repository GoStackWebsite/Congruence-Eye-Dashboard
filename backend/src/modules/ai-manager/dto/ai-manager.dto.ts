import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsObject, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { AI_RULE_TYPES } from '../ai-manager.views';
import { ISO_WITH_OFFSET, TS_OFFSET_MSG } from '../../ingest/dto/ingest.dto';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const CHANNELS = ['IN_APP', 'EMAIL', 'WEBHOOK'];

export class AiRuleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiProperty({ enum: AI_RULE_TYPES }) @IsIn(AI_RULE_TYPES) type: string;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) storeIds?: number[];
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) zoneIds?: number[];
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) windowStart?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) windowEnd?: string;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) daysOfWeek?: number[];
  @ApiPropertyOptional() @IsOptional() @IsObject() params?: Record<string, number | string | boolean>;
  @ApiPropertyOptional({ enum: SEVERITIES }) @IsOptional() @IsIn(SEVERITIES) severity?: string;
  @ApiPropertyOptional({ enum: CHANNELS, isArray: true }) @IsOptional() @IsArray() @IsIn(CHANNELS, { each: true }) notifyChannels?: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) notifyEmails?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateAiRuleDto extends PartialType(AiRuleDto) {}

export class DetectionDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() ruleId?: number;
  @ApiProperty({ enum: AI_RULE_TYPES }) @IsIn(AI_RULE_TYPES) type: string;
  @ApiProperty() @IsInt() cameraId: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() zoneId?: number | null;
  @ApiProperty() @IsISO8601() @Matches(ISO_WITH_OFFSET, { message: TS_OFFSET_MSG }) ts: string;
  @ApiProperty({ enum: ['BREACHED', 'COMPLIED'] }) @IsIn(['BREACHED', 'COMPLIED']) status: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) details?: string;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) @Max(1) confidence?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() snapshotId?: number;
}
export class IngestDetectionsDto {
  @ApiProperty({ type: [DetectionDto] }) @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => DetectionDto) detections: DetectionDto[];
}
export class ReviewDetectionDto {
  @ApiProperty({ enum: ['VALID', 'FALSE_POSITIVE'] }) @IsIn(['VALID', 'FALSE_POSITIVE']) reviewStatus: string;
}
