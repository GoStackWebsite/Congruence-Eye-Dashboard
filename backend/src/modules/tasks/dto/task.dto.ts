import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsInt, IsISO8601, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const TASK_TYPES = ['GENERAL', 'ZONE_ALLOCATION', 'FOLLOW_UP', 'VISUAL_MERCHANDISING'];
export const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const TASK_STATUSES = ['TODO', 'IN_PROGRESS', 'DONE', 'VERIFIED', 'CANCELLED'];

export class CreateTaskDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiProperty() @IsInt() storeId: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() zoneId?: number | null;
  @ApiPropertyOptional({ enum: TASK_TYPES }) @IsOptional() @IsIn(TASK_TYPES) type?: string;
  @ApiPropertyOptional({ enum: TASK_PRIORITIES }) @IsOptional() @IsIn(TASK_PRIORITIES) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() assigneeId?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueAt?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startAt?: string | null;
}
export class UpdateTaskDto extends PartialType(CreateTaskDto) {
  @ApiPropertyOptional({ enum: TASK_STATUSES }) @IsOptional() @IsIn(TASK_STATUSES) status?: string;
}
export class TaskStatusDto {
  @ApiProperty({ enum: TASK_STATUSES }) @IsIn(TASK_STATUSES) status: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) proofUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) remark?: string;
}
export class BulkTaskDto {
  @ApiProperty({ type: [Number] }) @IsArray() @ArrayMinSize(1) @IsInt({ each: true }) storeIds: number[];
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) description?: string;
  @ApiPropertyOptional({ enum: TASK_TYPES }) @IsOptional() @IsIn(TASK_TYPES) type?: string;
  @ApiPropertyOptional({ enum: TASK_PRIORITIES }) @IsOptional() @IsIn(TASK_PRIORITIES) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() startAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() assigneeId?: number;
}
