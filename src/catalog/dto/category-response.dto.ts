export class CategoryResponseDto {
  id: string;
  name: string;
  slug: string;

  constructor(category: { id: string; name: string; slug: string }) {
    this.id = category.id;
    this.name = category.name;
    this.slug = category.slug;
  }
}
