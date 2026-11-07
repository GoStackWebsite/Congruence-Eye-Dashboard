import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsInt, IsISO8601, IsOptional, IsString, Max, MaxLength, Min, MinLength, ValidateIf } from 'class-validator';

export const VENDOR_CATEGORIES = ['HOUSEKEEPING', 'SECURITY', 'MAINTENANCE', 'IT', 'SUPPLIER', 'OTHER'];
export const VISIT_STATUSES = ['SCHEDULED', 'CHECKED_IN', 'COMPLETED', 'MISSED', 'CANCELLED'];

export class CreateVendorDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(200) name: string;
  @ApiProperty({ enum: VENDOR_CATEGORIES }) @IsIn(VENDOR_CATEGORIES) category: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(150) contactName?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) phone?: string;
  @ApiPropertyOptional() @IsOptional() @ValidateIf((o) => o.email !== '') @IsEmail() email?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}
export class UpdateVendorDto extends PartialType(CreateVendorDto) {}

export class CreateVendorVisitDto {
  @ApiProperty() @IsInt() vendorId: number;
  @ApiProperty() @IsInt() storeId: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) purpose?: string;
  @ApiProperty() @IsISO8601() scheduledAt: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class UpdateVendorVisitDto {
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(500) purpose?: string;
  @ApiPropertyOptional() @IsOptional() @IsISO8601() scheduledAt?: string;
  @ApiPropertyOptional({ enum: VISIT_STATUSES }) @IsOptional() @IsIn(VISIT_STATUSES) status?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
export class CheckOutDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(1) @Max(5) rating?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(2000) notes?: string;
}
