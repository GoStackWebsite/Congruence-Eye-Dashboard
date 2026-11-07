import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'admin@congruence.in' }) @IsEmail() email: string;
  @ApiProperty({ example: 'Password@123' }) @IsString() @MinLength(1) @MaxLength(200) password: string;
}

export class ChangePasswordDto {
  @ApiProperty() @IsString() @MinLength(1) currentPassword: string;
  @ApiProperty() @IsString() @MinLength(6) @MaxLength(100) newPassword: string;
}
