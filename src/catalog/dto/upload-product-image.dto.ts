import { IsOptional, IsString, MaxLength } from 'class-validator';

export class UploadProductImageDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  altText?: string;
}
