import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsInt, IsNumber, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export const STORE_FORMATS = ['HIGH_STREET', 'MALL', 'AIRPORT', 'OUTLET', 'KIOSK'];
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export class CreateStoreDto {
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(30) code: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiProperty() @IsInt() regionId: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(100) city?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(400) address?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) timezone?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) openTime?: string;
  @ApiPropertyOptional() @IsOptional() @Matches(HHMM) closeTime?: string;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) areaSqft?: number;
  @ApiPropertyOptional({ enum: STORE_FORMATS }) @IsOptional() @IsIn(STORE_FORMATS) format?: string;
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-90) @Max(90) latitude?: number;
  @ApiPropertyOptional() @IsOptional() @IsNumber() @Min(-180) @Max(180) longitude?: number;
}
export class UpdateStoreDto extends PartialType(CreateStoreDto) {}
