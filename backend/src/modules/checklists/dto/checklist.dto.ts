import { IsDateOnly } from '../../../common/validators';
import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  Allow, ArrayMinSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength, ValidateIf, ValidateNested,
} from 'class-validator';

export const TEMPLATE_CATEGORIES = ['OPENING', 'CLOSING', 'VISUAL_MERCHANDISING', 'HYGIENE', 'SAFETY', 'AUDIT', 'OTHER'];
export const FREQUENCIES = ['DAILY', 'WEEKLY', 'MONTHLY', 'ADHOC'];
export const QUESTION_TYPES = ['YES_NO', 'MCQ_SINGLE', 'MCQ_MULTI', 'TEXT', 'NUMBER', 'RATING', 'PHOTO', 'VIDEO'];
export const AI_CHECK_TYPES = ['NONE', 'REFERENCE_MATCH', 'UNIFORM'];

export class QuestionDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() id?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) section?: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(1000) text: string;
  @ApiProperty({ enum: QUESTION_TYPES }) @IsIn(QUESTION_TYPES) type: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) options?: string[];
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @IsString({ each: true }) correctOptions?: string[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() required?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(0) weight?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() requiresPhoto?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsInt() sortOrder?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() minValue?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsNumber() maxValue?: number | null;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) referenceImageUrl?: string | null;
  @ApiPropertyOptional({ enum: AI_CHECK_TYPES }) @IsOptional() @IsIn(AI_CHECK_TYPES) aiCheck?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() createTaskOnFail?: boolean;
}

export class TemplateDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) description?: string;
  @ApiProperty({ enum: TEMPLATE_CATEGORIES }) @IsIn(TEMPLATE_CATEGORIES) category: string;
  @ApiProperty({ enum: FREQUENCIES }) @IsIn(FREQUENCIES) frequency: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiProperty({ type: [QuestionDto] }) @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => QuestionDto)
  questions: QuestionDto[];
}

export class AssignmentDto {
  @ApiProperty() @IsInt() templateId: number;
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @IsInt() assigneeId: number;
  @ApiProperty({ example: '2026-10-10' }) @IsDateOnly() dueDate: string;
  @ApiPropertyOptional({ description: 'deadline (ISO); default 23:59 store-local on dueDate' }) @IsOptional() @IsISO8601() dueAt?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() windowStart?: string;
}

export class AnswerDto {
  @ApiProperty() @IsInt() questionId: number;
  @ApiProperty({ description: 'string; MCQ_MULTI as JSON array string (arrays are accepted too)' }) @Allow() value: unknown;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) photoUrl?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(1000) remark?: string;
}

export class SubmissionDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() assignmentId?: number;
  @ApiProperty() @IsInt() templateId: number;
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty({ type: [AnswerDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => AnswerDto) answers: AnswerDto[];
}

export class ReviewDto {
  @ApiProperty({ enum: ['APPROVED', 'REDO'] }) @IsIn(['APPROVED', 'REDO']) status: 'APPROVED' | 'REDO';
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) comment?: string;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) redoQuestionIds?: number[];
}

export class DraftDto {
  @ApiProperty({ type: [AnswerDto] }) @IsArray() @ValidateNested({ each: true }) @Type(() => AnswerDto) answers: AnswerDto[];
}

export const SCHEDULE_FREQUENCIES = ['ONCE', 'DAILY', 'WEEKLY', 'MONTHLY'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export class ChecklistScheduleDto {
  @ApiProperty() @IsInt() templateId: number;
  @ApiProperty({ type: [Number] }) @IsArray() @IsInt({ each: true }) storeIds: number[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() assigneeId?: number | null;
  @ApiProperty({ enum: SCHEDULE_FREQUENCIES }) @IsIn(SCHEDULE_FREQUENCIES) frequency: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(365) repeatEvery?: number;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @IsInt({ each: true }) @Min(0, { each: true }) @Max(6, { each: true }) daysOfWeek?: number[];
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @IsInt() @Min(1) @Max(31) dayOfMonth?: number | null;
  @ApiProperty({ example: '09:30' }) @Matches(HHMM) windowStart: string;
  @ApiProperty({ example: '10:30' }) @Matches(HHMM) windowEnd: string;
  @ApiProperty() @IsDateOnly() startDate: string;
  @ApiPropertyOptional({ nullable: true }) @IsOptional() @ValidateIf((o) => o.endDate !== null) @IsDateOnly() endDate?: string | null;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(1440) reminderMinutesBefore?: number;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateChecklistScheduleDto extends PartialType(ChecklistScheduleDto) {}

export class AnswerTaskDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(200) title?: string;
  @ApiProperty() @IsInt() assigneeId: number;
  @ApiProperty() @IsISO8601() dueAt: string;
  @ApiPropertyOptional({ enum: ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] }) @IsOptional() @IsIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']) priority?: string;
}
