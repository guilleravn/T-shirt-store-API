import { ArrayMaxSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class ReplaceCategoriesDto {
  @IsArray()
  @ArrayMaxSize(10)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  categoryIds: string[];
}
