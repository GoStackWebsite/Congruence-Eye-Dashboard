import { IsBoolean, IsEmail, IsInt, IsOptional, IsString, IsUrl, Max, MaxLength, Min, ValidateIf } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional() @IsInt() @Min(1) @Max(36000) engagedStoreDwellSec?: number;
  @IsOptional() @IsInt() @Min(1) @Max(36000) bounceSec?: number;
  @IsOptional() @IsInt() @Min(1) @Max(365) repeatWindowDays?: number;
  @IsOptional() @IsString() @MaxLength(10) currency?: string;
  @IsOptional() @IsString() @MaxLength(100) companyName?: string;
  @IsOptional() @IsString() @MaxLength(200) smtpHost?: string;
  @IsOptional() @IsInt() @Min(1) @Max(65535) smtpPort?: number;
  @IsOptional() @IsString() @MaxLength(200) smtpUser?: string;
  @IsOptional() @IsString() @MaxLength(200) smtpPassword?: string;
  @IsOptional() @ValidateIf((o) => o.smtpFrom !== '') @IsEmail() smtpFrom?: string;
  @IsOptional() @IsBoolean() alertEmailEnabled?: boolean;
  @IsOptional() @IsUrl({ require_tld: false, require_protocol: true }) @MaxLength(300) aiServiceUrl?: string;
  @IsOptional() @IsInt() @Min(0) @Max(1440) checklistReminderMinutes?: number;
}
