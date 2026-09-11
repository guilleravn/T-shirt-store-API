import { randomUUID } from 'node:crypto';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/app.config';
import { PrismaService } from '../src/prisma/prisma.service';
import { AuthTokensResponseDto } from '../src/auth/dto/auth-tokens-response.dto';

function refreshTokenOf(response: request.Response): string {
  return (response.body as AuthTokensResponseDto).refreshToken;
}

describe('Auth (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app as unknown as NestExpressApplication);
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  function signUpAndSignIn(email: string) {
    return request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({
        email,
        password: 'a-very-strong-password',
        firstName: 'Test',
        lastName: 'User',
      })
      .expect(201)
      .then(() =>
        request(app.getHttpServer())
          .post('/v1/auth/signin')
          .send({ email, password: 'a-very-strong-password' })
          .expect(200),
      );
  }

  describe('signup -> signin -> refresh -> reuse', () => {
    const email = `e2e-auth-${randomUUID()}@example.com`;

    afterAll(async () => {
      await prisma.user.deleteMany({ where: { email } });
    });

    it('signs up and signs in, issuing a refresh token', async () => {
      const signInResponse = await signUpAndSignIn(email);
      expect(refreshTokenOf(signInResponse)).toEqual(expect.any(String));
    });

    it('rotates the refresh token on use', async () => {
      const signInResponse = await request(app.getHttpServer())
        .post('/v1/auth/signin')
        .send({ email, password: 'a-very-strong-password' })
        .expect(200);
      const firstRefreshToken = refreshTokenOf(signInResponse);

      const refreshResponse = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);
      const secondRefreshToken = refreshTokenOf(refreshResponse);

      expect(secondRefreshToken).not.toBe(firstRefreshToken);
    });

    it('rejects reuse of an already-rotated token and revokes the whole session', async () => {
      const signInResponse = await request(app.getHttpServer())
        .post('/v1/auth/signin')
        .send({ email, password: 'a-very-strong-password' })
        .expect(200);
      const firstRefreshToken = refreshTokenOf(signInResponse);

      const refreshResponse = await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(200);
      const secondRefreshToken = refreshTokenOf(refreshResponse);

      // Replaying the already-rotated first token is theft-signal reuse — must be rejected.
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: firstRefreshToken })
        .expect(401);

      // The regression this test exists for: reuse detection must revoke the ENTIRE session,
      // including the second token that was legitimately issued by the rotation above — not
      // just re-reject the stolen first token. Before the fix, the mass-revoke ran inside a
      // $transaction that then threw and rolled it back, so this second token stayed valid.
      await request(app.getHttpServer())
        .post('/v1/auth/refresh')
        .send({ refreshToken: secondRefreshToken })
        .expect(401);
    });
  });
});
