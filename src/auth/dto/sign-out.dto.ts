import { IsBoolean, IsOptional, IsString } from 'class-validator';

export class SignOutDto {
  @IsOptional()
  @IsString()
  refreshToken?: string;

  @IsOptional()
  @IsBoolean()
  all?: boolean = false;
}
