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

describe('Promo codes (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let managerToken: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app as unknown as NestExpressApplication);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    // Only the seed creates a MANAGER account (signup always creates CLIENT) — same seeded
    // account used for every manual smoke test in this project.
    const signInResponse = await request(app.getHttpServer())
      .post('/v1/auth/signin')
      .send({ email: 'guichi.maldo@gmail.com', password: 'Manager123!' })
      .expect(200);
    managerToken = (signInResponse.body as AuthTokensResponseDto).accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  describe('PATCH /promo-codes/:id CHECK constraint', () => {
    const code = `E2E-CHECK-${randomUUID().slice(0, 8)}`;
    let promoCodeId: string;

    beforeAll(async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/v1/promo-codes')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ code, discountType: 'PERCENTAGE', discountValue: 10 })
        .expect(201);
      promoCodeId = (createResponse.body as { id: string }).id;
    });

    afterAll(async () => {
      await prisma.promoCode.deleteMany({ where: { code } });
    });

    it('maps the real discount_value_valid_for_type CHECK violation to 400, not 500', async () => {
      // 500 is out of the 1-100 range the DB CHECK constraint enforces for a PERCENTAGE code.
      // This must round-trip through Postgres's real error rather than a hand-constructed mock:
      // the exact Prisma error code for a CHECK violation isn't documented and already
      // surprised us once (P2004 assumed while writing promo-codes.service.ts's mapWriteError,
      // P2039 confirmed only by triggering this exact constraint live).
      await request(app.getHttpServer())
        .patch(`/v1/promo-codes/${promoCodeId}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ discountValue: 500 })
        .expect(400);
    });
  });
});
