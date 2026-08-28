import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Same JWT verification as JwtAuthGuard, but never throws: a missing/invalid token leaves
// request.user undefined instead of rejecting the request. For routes that are public by
// default but behave differently when the caller happens to be authenticated (e.g.
// GET /products' includeInactive, which is MANAGER-only but the route itself isn't).
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(_err: unknown, user: TUser): TUser {
    return user;
  }
}
