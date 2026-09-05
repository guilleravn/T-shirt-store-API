import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from '../decorators/roles.decorator';
import type { User } from '../../../generated/prisma/client';

// Direct role comparison, on purpose — CASL is installed and used for Sales's per-order
// (own-resource) abilities (src/sales/casl/order-ability.factory.ts), but route-level role
// gating stays a plain check here; see coding-style.md's "Authorization current state". Must run
// after JwtAuthGuard in @UseGuards(JwtAuthGuard, RolesGuard): it reads request.user, which only
// JwtAuthGuard sets.
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<
      User['role'][] | undefined
    >(ROLES_KEY, [context.getHandler(), context.getClass()]);
    if (!requiredRoles?.length) return true;

    const { user } = context.switchToHttp().getRequest<{ user?: User }>();
    if (!user || !requiredRoles.includes(user.role)) {
      throw new ForbiddenException("You don't have permission for this action");
    }
    return true;
  }
}
