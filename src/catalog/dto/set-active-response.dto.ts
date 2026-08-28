export class SetActiveResponseDto {
  id: string;
  isActive: boolean;

  constructor(params: { id: string; isActive: boolean }) {
    this.id = params.id;
    this.isActive = params.isActive;
  }
}
