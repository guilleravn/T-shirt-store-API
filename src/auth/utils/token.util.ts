import { createHash, randomBytes } from 'node:crypto';

// Refresh and password-reset tokens are already high-entropy random values — sha256 (fast,
// deterministic) is correct here, not bcrypt. bcrypt salts randomly per call, so hashing the
// same raw token twice produces two different hashes, which makes the indexed
// `WHERE token_hash = ?` lookup these tables rely on impossible. bcrypt is for
// users.password_hash only, where the check is against one row already fetched by email.
export function generateRawToken(): string {
  return randomBytes(32).toString('hex');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}
