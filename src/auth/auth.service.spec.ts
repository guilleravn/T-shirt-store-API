import { Test } from '@nestjs/testing';
import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { Prisma } from '../../generated/prisma/client';
import { hashToken } from './utils/token.util';

function buildPrismaMock() {
  const prisma = {
    user: {
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    refreshToken: {
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      create: jest.fn(),
    },
    passwordResetToken: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
    },
    $transaction: jest.fn(),
  };
  // Every test reuses the same mock as the transaction client — this is a unit test of
  // business logic, not the concurrency tests that genuinely need a real DB (see testing.md).
  prisma.$transaction.mockImplementation(
    (callback: (tx: typeof prisma) => unknown) => callback(prisma),
  );
  return prisma;
}

describe('AuthService', () => {
  let service: AuthService;
  let prisma: ReturnType<typeof buildPrismaMock>;
  let jwtService: { sign: jest.Mock };
  let emailQueueService: {
    enqueuePasswordResetEmail: jest.Mock;
    enqueuePasswordChangedEmail: jest.Mock;
  };

  const baseUser = {
    id: 'user-1',
    email: 'guille@example.com',
    passwordHash: '',
    firstName: 'Guille',
    lastName: 'Maldonado',
    role: 'CLIENT' as const,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-01T00:00:00Z'),
  };

  beforeAll(async () => {
    baseUser.passwordHash = await bcrypt.hash('SuperSegura123', 10);
  });

  beforeEach(async () => {
    prisma = buildPrismaMock();
    jwtService = { sign: jest.fn().mockReturnValue('signed.jwt.token') };
    emailQueueService = {
      enqueuePasswordResetEmail: jest.fn().mockResolvedValue(undefined),
      enqueuePasswordChangedEmail: jest.fn().mockResolvedValue(undefined),
    };

    const module = await Test.createTestingModule({
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        { provide: JwtService, useValue: jwtService },
        {
          provide: ConfigService,
          useValue: { get: jest.fn().mockReturnValue(undefined) },
        },
        { provide: EmailQueueService, useValue: emailQueueService },
      ],
    }).compile();

    service = module.get(AuthService);
  });

  describe('signUp', () => {
    it('creates a CLIENT without trusting a role from input, and never returns the hash', async () => {
      prisma.user.create.mockResolvedValue(baseUser);

      const result = await service.signUp({
        email: baseUser.email,
        password: 'SuperSegura123',
        firstName: baseUser.firstName,
        lastName: baseUser.lastName,
      });

      // Exact match, not objectContaining: proves `role` is absent, not just that the
      // listed fields are present alongside whatever else might have been sent.
      expect(prisma.user.create).toHaveBeenCalledWith({
        data: {
          email: baseUser.email,
          passwordHash: expect.any(String) as string,
          firstName: baseUser.firstName,
          lastName: baseUser.lastName,
        },
      });
      expect(result).not.toHaveProperty('passwordHash');
      expect(result.email).toBe(baseUser.email);
    });

    it('maps a P2002 unique violation to ConflictException', async () => {
      prisma.user.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('duplicate', {
          code: 'P2002',
          clientVersion: 'test',
        }),
      );

      await expect(
        service.signUp({
          email: baseUser.email,
          password: 'SuperSegura123',
          firstName: baseUser.firstName,
          lastName: baseUser.lastName,
        }),
      ).rejects.toThrow(ConflictException);
    });
  });

  describe('signIn', () => {
    it('issues tokens on a correct password', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.signIn({
        email: baseUser.email,
        password: 'SuperSegura123',
      });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(result.user.email).toBe(baseUser.email);
      expect(prisma.refreshToken.create).toHaveBeenCalledTimes(1);
    });

    it('rejects an unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await expect(
        service.signIn({ email: 'nobody@example.com', password: 'whatever12' }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects a wrong password', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);

      await expect(
        service.signIn({ email: baseUser.email, password: 'wrong-password' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('refresh', () => {
    it('rotates the token and issues a new pair', async () => {
      const existing = {
        id: 'rt-1',
        userId: baseUser.id,
        tokenHash: hashToken('raw-token'),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(existing);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await service.refresh({ refreshToken: 'raw-token' });

      expect(result.accessToken).toBe('signed.jwt.token');
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: existing.id, revokedAt: null },
        }),
      );
    });

    it('rejects a token that does not exist', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(null);

      await expect(service.refresh({ refreshToken: 'nope' })).rejects.toThrow(
        UnauthorizedException,
      );
    });

    it('on reuse of an already-revoked token, revokes every active token for that user', async () => {
      const existing = {
        id: 'rt-1',
        userId: baseUser.id,
        tokenHash: hashToken('raw-token'),
        revokedAt: new Date(),
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(existing);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await expect(
        service.refresh({ refreshToken: 'raw-token' }),
      ).rejects.toThrow(UnauthorizedException);
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: baseUser.id, revokedAt: null },
        }),
      );
      // The revocation must not run inside $transaction: a throw there would roll it back along
      // with everything else, silently undoing the exact thing this path exists to guarantee.
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects when it loses the race to revoke the row (concurrent refresh)', async () => {
      const existing = {
        id: 'rt-1',
        userId: baseUser.id,
        tokenHash: hashToken('raw-token'),
        revokedAt: null,
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
      };
      prisma.refreshToken.findUnique.mockResolvedValue(existing);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.refresh({ refreshToken: 'raw-token' }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('signOut', () => {
    it('revokes every active token when all is true', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 2 });

      await service.signOut(baseUser.id, { all: true });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: baseUser.id, revokedAt: null },
        }),
      );
    });

    it('revokes only the given token when all is false', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await service.signOut(baseUser.id, {
        refreshToken: 'raw-token',
        all: false,
      });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            userId: baseUser.id,
            tokenHash: hashToken('raw-token'),
            revokedAt: null,
          },
        }),
      );
    });

    it('throws NotFoundException when the given token does not belong to the user', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.signOut(baseUser.id, { refreshToken: 'not-mine', all: false }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws ForbiddenException when neither all nor refreshToken is given', async () => {
      await expect(
        service.signOut(baseUser.id, { all: false }),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('forgotPassword', () => {
    it('does nothing observable when the email does not exist (no enumeration)', async () => {
      prisma.user.findUnique.mockResolvedValue(null);

      await service.forgotPassword({ email: 'nobody@example.com' });

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(
        emailQueueService.enqueuePasswordResetEmail,
      ).not.toHaveBeenCalled();
    });

    it('creates a token and enqueues the reset email under the per-account limit', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.passwordResetToken.count.mockResolvedValue(0);
      prisma.passwordResetToken.create.mockResolvedValue({});

      await service.forgotPassword({ email: baseUser.email });

      expect(prisma.passwordResetToken.create).toHaveBeenCalledTimes(1);
      expect(emailQueueService.enqueuePasswordResetEmail).toHaveBeenCalledWith(
        expect.objectContaining({ to: baseUser.email }),
      );
    });

    it('stops silently once the per-account rate limit (3/hour) is hit', async () => {
      prisma.user.findUnique.mockResolvedValue(baseUser);
      prisma.passwordResetToken.count.mockResolvedValue(3);

      await service.forgotPassword({ email: baseUser.email });

      expect(prisma.passwordResetToken.create).not.toHaveBeenCalled();
      expect(
        emailQueueService.enqueuePasswordResetEmail,
      ).not.toHaveBeenCalled();
    });
  });

  describe('resetPassword', () => {
    it('updates the password, revokes every session, and enqueues the changed-password email', async () => {
      const resetToken = {
        id: 'prt-1',
        userId: baseUser.id,
        tokenHash: hashToken('raw-reset-token'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
      };
      prisma.passwordResetToken.findUnique.mockResolvedValue(resetToken);
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 1 });
      prisma.user.update.mockResolvedValue(baseUser);
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 3 });

      await service.resetPassword({
        token: 'raw-reset-token',
        newPassword: 'NuevaSuperSegura123',
      });

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: baseUser.id } }),
      );
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: baseUser.id, revokedAt: null },
        }),
      );
      expect(
        emailQueueService.enqueuePasswordChangedEmail,
      ).toHaveBeenCalledWith(expect.objectContaining({ to: baseUser.email }));
    });

    it('rejects a token that does not exist', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue(null);

      await expect(
        service.resetPassword({
          token: 'nope',
          newPassword: 'NuevaSuperSegura123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });

    it('rejects an expired or already-used token', async () => {
      prisma.passwordResetToken.findUnique.mockResolvedValue({
        id: 'prt-1',
        userId: baseUser.id,
        tokenHash: hashToken('raw-reset-token'),
        usedAt: null,
        expiresAt: new Date(Date.now() + 1000),
        createdAt: new Date(),
      });
      prisma.passwordResetToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.resetPassword({
          token: 'raw-reset-token',
          newPassword: 'NuevaSuperSegura123',
        }),
      ).rejects.toThrow(UnauthorizedException);
    });
  });
});
