import { UserRole } from '../../../generated/prisma/client';

export interface JwtPayload {
  sub: string;
  role: UserRole;
}
