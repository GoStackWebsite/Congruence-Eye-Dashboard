import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, MaxLength, Min, MinLength } from 'class-validator';

export const ALERT_METRICS = [
  'QUEUE_LENGTH', 'QUEUE_WAIT', 'CAMERA_OFFLINE', 'STORE_OPEN_LATE', 'STORE_CLOSE_EARLY',
  'FOOTFALL_DROP', 'CONVERSION_DROP', 'SOP_BREACH', 'STAFF_SHORTAGE', 'COUNTER_UNATTENDED',
  'CHECKLIST_OVERDUE', 'CHECKLIST_NON_COMPLIANCE', 'AI_MANAGER_BREACH', 'EDGE_OFFLINE',
];
export const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'];
export const CHANNELS = ['IN_APP', 'EMAIL', 'WEBHOOK'];

export class CreateAlertRuleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() storeId?: number | null;
  @ApiProperty({ enum: ALERT_METRICS }) @IsIn(ALERT_METRICS) metric: string;
  @ApiProperty() @IsNumber() @Min(0) threshold: number;
  @ApiProperty({ enum: SEVERITIES }) @IsIn(SEVERITIES) severity: string;
  @ApiProperty({ enum: CHANNELS, isArray: true }) @IsArray() @ArrayUnique() @IsIn(CHANNELS, { each: true }) channels: string[];
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) emails?: string;
  @ApiPropertyOptional() @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(500) webhookUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) cooldownMin?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() autoTicket?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateAlertRuleDto extends PartialType(CreateAlertRuleDto) {}
