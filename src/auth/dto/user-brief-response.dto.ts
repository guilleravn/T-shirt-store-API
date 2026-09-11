export class UserBriefResponseDto {
  id: string;
  firstName: string;
  lastName: string;

  constructor(user: { id: string; firstName: string; lastName: string }) {
    this.id = user.id;
    this.firstName = user.firstName;
    this.lastName = user.lastName;
  }
}
