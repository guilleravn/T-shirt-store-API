export class SizeResponseDto {
  id: string;
  name: string;
  position: number;

  constructor(size: { id: string; name: string; position: number }) {
    this.id = size.id;
    this.name = size.name;
    this.position = size.position;
  }
}
