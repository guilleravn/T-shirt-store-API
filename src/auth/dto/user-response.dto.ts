import { UserRole } from '../../../generated/prisma/client';

// Explicit whitelist mapper — the project has no global serialization interceptor yet, and
// Auth is the first module returning anything sensitive. Never spread a raw User row into a
// response; passwordHash must never leave this file's control.
export class UserResponseDto {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  createdAt: Date;

  constructor(user: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    role: UserRole;
    createdAt: Date;
  }) {
    this.id = user.id;
    this.email = user.email;
    this.firstName = user.firstName;
    this.lastName = user.lastName;
    this.role = user.role;
    this.createdAt = user.createdAt;
  }
}
