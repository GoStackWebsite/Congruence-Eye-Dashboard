import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export const DOC_CATEGORIES = ['SOP', 'CIRCULAR', 'PLANOGRAM', 'TRAINING', 'OTHER'];
export class UploadDocumentDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) title: string;
  @ApiProperty({ enum: DOC_CATEGORIES }) @IsIn(DOC_CATEGORIES) category: string;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() storeId?: number;
  @ApiProperty({ type: 'string', format: 'binary' }) file?: unknown;
}
