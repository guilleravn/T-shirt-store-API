import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { Prisma, User } from '../../generated/prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { EmailQueueService } from '../email/email-queue.service';
import { PageMetaDto } from '../catalog/dto/page-meta.dto';
import { SignUpDto } from './dto/sign-up.dto';
import { SignInDto } from './dto/sign-in.dto';
import { SignOutDto } from './dto/sign-out.dto';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { UserResponseDto } from './dto/user-response.dto';
import { UserBriefResponseDto } from './dto/user-brief-response.dto';
import { ListUsersQueryDto } from './dto/list-users-query.dto';
import { AuthTokensResponseDto } from './dto/auth-tokens-response.dto';
import { generateRawToken, hashToken } from './utils/token.util';
import { JwtPayload } from './interfaces/jwt-payload.interface';

// Fixed by the ERD's refresh_tokens note, not an env-tunable ops knob.
const ACCESS_TOKEN_TTL_SECONDS = 15 * 60;
// Not fixed anywhere in the ERD/docs — a default, unlike the access-token lifetime above.
const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
// business-invariants.md security invariant: 3 requests/hour per account.
const PASSWORD_RESET_MAX_PER_HOUR = 3;

@Injectable()
export class AuthService {
  private readonly refreshTokenTtlMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    private readonly emailQueueService: EmailQueueService,
  ) {
    const refreshTokenTtlDays =
      this.configService.get<number>('JWT_REFRESH_TOKEN_TTL_DAYS') ?? 30;
    this.refreshTokenTtlMs = refreshTokenTtlDays * 24 * 60 * 60 * 1000;
  }

  async signUp(dto: SignUpDto): Promise<UserResponseDto> {
    const passwordHash = await bcrypt.hash(dto.password, 10);

    let user: User;
    try {
      // No findUnique pre-check: same TOCTOU reasoning R5 rejected a stored used_count for.
      // The unique constraint on email is what actually prevents the duplicate.
      user = await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash,
          firstName: dto.firstName,
          lastName: dto.lastName,
          // role is never taken from input — the DB default (CLIENT) always applies.
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'An account with this email already exists',
        );
      }
      throw error;
    }

    return new UserResponseDto(user);
  }

  async signIn(dto: SignInDto): Promise<AuthTokensResponseDto> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid email or password');
    }

    return this.issueTokens(user);
  }

  async refresh(dto: { refreshToken: string }): Promise<AuthTokensResponseDto> {
    const tokenHash = hashToken(dto.refreshToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!existing) {
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (existing.revokedAt) {
      // Reuse of an already-rotated token is the signal of theft (see
      // business-invariants.md) — revoke every active session for this user, not just this one
      // token. This runs and commits BEFORE the exception below, on purpose: throwing inside a
      // $transaction would roll this update back along with everything else, silently undoing
      // the revocation it exists to guarantee.
      await this.prisma.refreshToken.updateMany({
        where: { userId: existing.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      throw new UnauthorizedException('Invalid refresh token');
    }

    return this.prisma.$transaction(async (tx) => {
      // Conditional UPDATE, not read-then-write: guards two concurrent /auth/refresh calls
      // racing on the same row, same idiom R3 uses for stock.
      const { count } = await tx.refreshToken.updateMany({
        where: { id: existing.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      if (count !== 1) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      const user = await tx.user.findUnique({ where: { id: existing.userId } });
      if (!user) {
        throw new UnauthorizedException('Invalid refresh token');
      }

      return this.issueTokens(user, tx);
    });
  }

  async signOut(userId: string, dto: SignOutDto): Promise<void> {
    if (dto.all) {
      await this.prisma.refreshToken.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      return;
    }

    if (!dto.refreshToken) {
      throw new ForbiddenException(
        'refreshToken is required unless all is true',
      );
    }

    const tokenHash = hashToken(dto.refreshToken);
    const { count } = await this.prisma.refreshToken.updateMany({
      where: { userId, tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    if (count !== 1) {
      throw new NotFoundException('Session not found');
    }
  }

  async forgotPassword(dto: ForgotPasswordDto): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email: dto.email },
    });
    // Always behaves the same regardless of whether the account exists — no enumeration signal.
    if (!user) {
      return;
    }

    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const recentCount = await this.prisma.passwordResetToken.count({
      where: { userId: user.id, createdAt: { gte: oneHourAgo } },
    });
    if (recentCount >= PASSWORD_RESET_MAX_PER_HOUR) {
      return;
    }

    const rawToken = generateRawToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawToken),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TOKEN_TTL_MS),
      },
    });

    await this.emailQueueService.enqueuePasswordResetEmail({
      to: user.email,
      firstName: user.firstName,
      resetToken: rawToken,
    });
  }

  async resetPassword(dto: ResetPasswordDto): Promise<void> {
    const tokenHash = hashToken(dto.token);
    const passwordHash = await bcrypt.hash(dto.newPassword, 10);

    const user = await this.prisma.$transaction(async (tx) => {
      const resetToken = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
      });
      if (!resetToken) {
        throw new BadRequestException('Invalid or expired token');
      }

      // Conditional UPDATE: prevents two concurrent submissions of the same token both
      // succeeding.
      const { count } = await tx.passwordResetToken.updateMany({
        where: {
          id: resetToken.id,
          usedAt: null,
          expiresAt: { gt: new Date() },
        },
        data: { usedAt: new Date() },
      });
      if (count !== 1) {
        throw new BadRequestException('Invalid or expired token');
      }

      const updatedUser = await tx.user.update({
        where: { id: resetToken.userId },
        data: { passwordHash },
      });

      // Completing a reset revokes every session — the account is being recovered, so every
      // existing token is treated as potentially compromised (security invariant).
      await tx.refreshToken.updateMany({
        where: { userId: resetToken.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });

      return updatedUser;
    });

    // Enqueued after the transaction commits, not inside it — same reasoning
    // docs/architecture.md applies to the refund job: a queue failure must never roll back a
    // DB write that already succeeded.
    await this.emailQueueService.enqueuePasswordChangedEmail({
      to: user.email,
      firstName: user.firstName,
    });
  }

  async listUsers(
    query: ListUsersQueryDto,
  ): Promise<{ data: UserBriefResponseDto[]; meta: PageMetaDto }> {
    const where: Prisma.UserWhereInput = { role: query.role };
    const limit = query.limit ?? 20;
    const offset = query.offset ?? 0;

    const [total, users] = await Promise.all([
      this.prisma.user.count({ where }),
      this.prisma.user.findMany({
        where,
        select: { id: true, firstName: true, lastName: true },
        orderBy: { firstName: 'asc' },
        skip: offset,
        take: limit,
      }),
    ]);

    return {
      data: users.map((user) => new UserBriefResponseDto(user)),
      meta: new PageMetaDto({ total, limit, offset }),
    };
  }

  private async issueTokens(
    user: User,
    tx: Prisma.TransactionClient | PrismaService = this.prisma,
  ): Promise<AuthTokensResponseDto> {
    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = this.jwtService.sign(payload, {
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });

    const rawRefreshToken = generateRawToken();
    await tx.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(rawRefreshToken),
        expiresAt: new Date(Date.now() + this.refreshTokenTtlMs),
      },
    });

    return new AuthTokensResponseDto({
      user: new UserResponseDto(user),
      accessToken,
      refreshToken: rawRefreshToken,
      expiresIn: ACCESS_TOKEN_TTL_SECONDS,
    });
  }
}
