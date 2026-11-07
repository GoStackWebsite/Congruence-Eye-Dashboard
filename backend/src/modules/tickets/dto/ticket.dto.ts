import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const TICKET_CATEGORIES = ['PLANOGRAM', 'INFRASTRUCTURE', 'CAMERA', 'NETWORK', 'MAINTENANCE', 'OTHER'];
export const PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'];
export const TICKET_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CLOSED', 'REOPENED'];
export const SLA_HOURS: Record<string, number> = { URGENT: 4, HIGH: 24, MEDIUM: 72, LOW: 168 };

export class CreateTicketDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty({ enum: TICKET_CATEGORIES }) @IsIn(TICKET_CATEGORIES) category: string;
  @ApiProperty({ enum: PRIORITIES }) @IsIn(PRIORITIES) priority: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() assigneeId?: number | null;
}
export class UpdateTicketDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(4000) description?: string;
  @ApiPropertyOptional({ enum: TICKET_CATEGORIES }) @IsOptional() @IsIn(TICKET_CATEGORIES) category?: string;
  @ApiPropertyOptional({ enum: PRIORITIES }) @IsOptional() @IsIn(PRIORITIES) priority?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() assigneeId?: number | null;
  @ApiPropertyOptional({ enum: TICKET_STATUSES }) @IsOptional() @IsIn(TICKET_STATUSES) status?: string;
}
export class TicketStatusDto {
  @ApiProperty({ enum: TICKET_STATUSES }) @IsIn(TICKET_STATUSES) status: string;
}
export class CommentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(4000) body: string;
}
