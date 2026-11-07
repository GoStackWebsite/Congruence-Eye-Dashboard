import { ApiProperty, ApiPropertyOptional, OmitType, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export class CreateStaffDto {
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(30) code: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) designation?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) shiftStart?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) shiftEnd?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateStaffDto extends PartialType(OmitType(CreateStaffDto, ['storeId'] as const)) {}
