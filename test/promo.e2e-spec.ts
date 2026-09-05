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
import { OrderStatus, UserRole } from '../generated/prisma/client';

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

  // fix(promo): list() batches usage counts in one groupBy instead of one count() per row —
  // verified against the real database since Prisma's groupBy-with-a-relation-where is exactly
  // the kind of query shape a mocked unit test can't confirm actually compiles and joins right.
  describe('GET /promo-codes usage counting (groupBy regression)', () => {
    const code = `E2E-USAGE-${randomUUID().slice(0, 8)}`;
    let promoCodeId: string;
    let orderId: string;
    let userId: string;

    beforeAll(async () => {
      const createResponse = await request(app.getHttpServer())
        .post('/v1/promo-codes')
        .set('Authorization', `Bearer ${managerToken}`)
        .send({ code, discountType: 'FIXED', discountValue: 500 })
        .expect(201);
      promoCodeId = (createResponse.body as { id: string }).id;

      const user = await prisma.user.create({
        data: {
          email: `e2e-promo-usage-${randomUUID().slice(0, 8)}@example.com`,
          passwordHash: 'not-a-real-hash',
          firstName: 'E2E',
          lastName: 'PromoUsage',
          role: UserRole.CLIENT,
        },
      });
      userId = user.id;

      const order = await prisma.order.create({
        data: {
          userId,
          status: OrderStatus.PENDING,
          subtotalCents: 1000,
          discountCents: 500,
          totalCents: 500,
          statusHistory: {
            create: { status: OrderStatus.PENDING, changedByUserId: userId },
          },
        },
      });
      orderId = order.id;

      await prisma.promoRedemption.create({ data: { promoCodeId, orderId } });
    });

    afterAll(async () => {
      await prisma.promoRedemption.deleteMany({ where: { promoCodeId } });
      await prisma.order.deleteMany({ where: { id: orderId } });
      await prisma.user.deleteMany({ where: { id: userId } });
      await prisma.promoCode.deleteMany({ where: { id: promoCodeId } });
    });

    it('counts the redemption via the batched groupBy query', async () => {
      const response = await request(app.getHttpServer())
        .get(`/v1/promo-codes?code=${code}`)
        .set('Authorization', `Bearer ${managerToken}`)
        .expect(200);

      const body = response.body as {
        data: { code: string; timesUsed: number }[];
      };
      expect(body.data).toHaveLength(1);
      expect(body.data[0].timesUsed).toBe(1);
    });
  });
});
