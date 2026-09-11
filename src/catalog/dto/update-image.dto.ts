import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;
}
