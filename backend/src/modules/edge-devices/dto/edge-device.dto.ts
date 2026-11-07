import { ApiProperty } from '@nestjs/swagger';
import { IsInt, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateEdgeDeviceDto {
  @ApiProperty() @IsInt() storeId: number;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
}
