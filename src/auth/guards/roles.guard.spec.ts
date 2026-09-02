import { ForbiddenException, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { UserRole } from '../../../generated/prisma/client';

function buildContext(user?: { role: UserRole }): ExecutionContext {
  return {
    getHandler: () => ({}),
    getClass: () => ({}),
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  let reflector: { getAllAndOverride: jest.Mock };
  let guard: RolesGuard;

  beforeEach(() => {
    reflector = { getAllAndOverride: jest.fn() };
    guard = new RolesGuard(reflector as unknown as Reflector);
  });

  it('allows the request when the route has no @Roles() metadata', () => {
    reflector.getAllAndOverride.mockReturnValue(undefined);

    expect(guard.canActivate(buildContext({ role: UserRole.CLIENT }))).toBe(
      true,
    );
  });

  it('allows the request when @Roles() was called with an empty list', () => {
    reflector.getAllAndOverride.mockReturnValue([]);

    expect(guard.canActivate(buildContext({ role: UserRole.CLIENT }))).toBe(
      true,
    );
  });

  it("allows a caller whose role is in the route's required list", () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MANAGER]);

    expect(guard.canActivate(buildContext({ role: UserRole.MANAGER }))).toBe(
      true,
    );
  });

  it("rejects a caller whose role is not in the route's required list", () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MANAGER]);

    expect(() =>
      guard.canActivate(buildContext({ role: UserRole.CLIENT })),
    ).toThrow(ForbiddenException);
  });

  it('rejects when the route requires a role but the request has no user', () => {
    reflector.getAllAndOverride.mockReturnValue([UserRole.MANAGER]);

    expect(() => guard.canActivate(buildContext(undefined))).toThrow(
      ForbiddenException,
    );
  });
});
