import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsInt, IsISO8601, IsNumber, IsOptional, IsString, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';

export class PosTransactionDto {
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(60) billNo: string;
  @ApiProperty() @IsISO8601() ts: string;
  @ApiProperty() @IsNumber() @Min(0) amount: number;
  @ApiProperty() @IsInt() @Min(0) itemsCount: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(30) staffCode?: string;
}
export class PosTransactionsDto {
  @ApiProperty({ type: [PosTransactionDto] }) @IsArray() @ArrayMaxSize(10000) @ValidateNested({ each: true }) @Type(() => PosTransactionDto)
  transactions: PosTransactionDto[];
}
