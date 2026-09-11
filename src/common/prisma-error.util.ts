import { BadRequestException, ConflictException } from '@nestjs/common';
import { Prisma } from '../../generated/prisma/client';

export interface PrismaErrorMessages {
  /** P2002 — unique constraint violation. */
  uniqueViolation?: string;
  /** P2003 — foreign key constraint violation. */
  foreignKeyViolation?: string;
  /**
   * P2039 — this Prisma version's code (via @prisma/adapter-pg) for a raw Postgres CHECK
   * constraint violation (SQLSTATE 23514). Confirmed live, not assumed — see
   * promo-codes.service.ts's history for why this isn't P2004.
   */
  checkViolation?: string;
}

// Shared across every service that writes rows guarded by DB constraints (products, variants,
// promo codes, orders) — extracted once three call sites had hand-rolled the same three-code
// switch, to avoid a fourth copy for orders' own CHECK constraints (total_matches_math,
// discount_within_subtotal, ...).
export function mapPrismaWriteError(
  error: unknown,
  messages: PrismaErrorMessages,
): unknown {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002' && messages.uniqueViolation) {
      return new ConflictException(messages.uniqueViolation);
    }
    if (error.code === 'P2003' && messages.foreignKeyViolation) {
      return new BadRequestException(messages.foreignKeyViolation);
    }
    if (error.code === 'P2039' && messages.checkViolation) {
      return new BadRequestException(messages.checkViolation);
    }
  }
  return error;
}
