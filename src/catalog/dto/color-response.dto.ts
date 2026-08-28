export class ColorResponseDto {
  id: string;
  name: string;
  hexCode: string;

  constructor(color: { id: string; name: string; hexCode: string }) {
    this.id = color.id;
    this.name = color.name;
    this.hexCode = color.hexCode;
  }
}
