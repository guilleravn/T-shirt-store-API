import { CategoryResponseDto } from './category-response.dto';

export class ReplaceCategoriesResponseDto {
  categories: CategoryResponseDto[];

  constructor(categories: CategoryResponseDto[]) {
    this.categories = categories;
  }
}
