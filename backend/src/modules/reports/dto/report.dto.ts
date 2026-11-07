import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsArray, IsBoolean, IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const REPORT_TYPES = ['traffic', 'zones', 'conversion', 'queue', 'storeops', 'benchmark', 'checklists', 'alerts', 'tasks', 'tickets'];
export const REPORT_FORMATS = ['csv', 'xlsx'];
export const REPORT_FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY'];

export class CreateScheduleDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty({ enum: REPORT_TYPES }) @IsIn(REPORT_TYPES) type: string;
  @ApiProperty({ enum: REPORT_FORMATS }) @IsIn(REPORT_FORMATS) format: string;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) storeIds?: number[];
  @ApiProperty({ enum: REPORT_FREQUENCIES }) @IsIn(REPORT_FREQUENCIES) frequency: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) recipients?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateScheduleDto extends PartialType(CreateScheduleDto) {}
