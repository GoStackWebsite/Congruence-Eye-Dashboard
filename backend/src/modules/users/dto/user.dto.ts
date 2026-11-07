import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { Role } from '../../../common/roles';

export class CreateUserDto {
  @ApiProperty() @IsEmail() @MaxLength(200) email: string;
  @ApiProperty() @IsString() @MinLength(1) @MaxLength(150) name: string;
  @ApiProperty({ enum: Role }) @IsEnum(Role) role: Role;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(100) password: string;
  @ApiPropertyOptional({ type: [Number] }) @IsOptional() @IsArray() @ArrayUnique() @IsInt({ each: true }) storeIds?: number[];
  @ApiPropertyOptional() @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateUserDto extends PartialType(CreateUserDto) {}
