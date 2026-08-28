import { OptionalJwtAuthGuard } from './optional-jwt-auth.guard';

describe('OptionalJwtAuthGuard', () => {
  const guard = new OptionalJwtAuthGuard();

  it('returns the authenticated user when the token is valid', () => {
    const user = { id: 'user-1', role: 'MANAGER' };

    expect(guard.handleRequest(null, user)).toBe(user);
  });

  it('returns undefined instead of throwing when there is no token', () => {
    expect(guard.handleRequest(null, undefined)).toBeUndefined();
  });

  it('returns undefined instead of throwing when verification fails', () => {
    expect(
      guard.handleRequest(new Error('invalid token'), undefined),
    ).toBeUndefined();
  });
});
