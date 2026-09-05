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

// Exercises OrdersController over real HTTP (supertest), not OrdersService directly — status
// codes and request-DTO validation only exist at this layer, so orders.e2e-spec.ts (which calls
// OrdersService in-process) can't catch either bug this file guards against.
describe('Orders HTTP surface (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const suffix = randomUUID().slice(0, 8);
  let productId: string;
  let colorId: string;
  let sizeId: string;
  let variantId: string;
  const createdUserIds: string[] = [];

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication<NestExpressApplication>();
    configureApp(app as unknown as NestExpressApplication);
    await app.init();

    prisma = moduleFixture.get(PrismaService);

    const color = await prisma.color.create({
      data: { name: `E2E HTTP Color ${suffix}`, hexCode: '#abcdef' },
    });
    colorId = color.id;

    const size = await prisma.size.create({
      data: { name: `EH-${suffix}`, position: 9200 },
    });
    sizeId = size.id;

    const product = await prisma.product.create({
      data: { name: `E2E HTTP Tee ${suffix}`, isActive: true },
    });
    productId = product.id;

    const variant = await prisma.productVariant.create({
      data: {
        productId,
        colorId,
        sizeId,
        sku: `E2E-HTTP-${suffix}`,
        priceCents: 1800,
        stock: 10,
      },
    });
    variantId = variant.id;
  });

  afterAll(async () => {
    await prisma.order.deleteMany({
      where: { userId: { in: createdUserIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
    await prisma.productVariant.deleteMany({ where: { id: variantId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.color.deleteMany({ where: { id: colorId } });
    await prisma.size.deleteMany({ where: { id: sizeId } });
    await app.close();
  });

  async function createOrderForFreshClient() {
    const email = `e2e-http-${randomUUID().slice(0, 8)}@example.com`;
    const signUpResponse = await request(app.getHttpServer())
      .post('/v1/auth/signup')
      .send({
        email,
        password: 'SuperSegura123',
        firstName: 'E2E',
        lastName: 'Http',
      })
      .expect(201);
    createdUserIds.push((signUpResponse.body as { id: string }).id);

    const signInResponse = await request(app.getHttpServer())
      .post('/v1/auth/signin')
      .send({ email, password: 'SuperSegura123' })
      .expect(200);
    const token = (signInResponse.body as AuthTokensResponseDto).accessToken;

    await request(app.getHttpServer())
      .post('/v1/me/cart/items')
      .set('Authorization', `Bearer ${token}`)
      .send({ productVariantId: variantId, quantity: 1 })
      .expect(200);

    const orderResponse = await request(app.getHttpServer())
      .post('/v1/orders')
      .set('Authorization', `Bearer ${token}`)
      .send({})
      .expect(201);

    return { token, orderId: (orderResponse.body as { id: string }).id };
  }

  describe('POST /orders/:orderId/cancel', () => {
    it('returns 200, not 201, on a successful cancellation', async () => {
      const { token, orderId } = await createOrderForFreshClient();

      await request(app.getHttpServer())
        .post(`/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({})
        .expect(200);
    });

    it('rejects a reason over 255 characters with 400, not a raw 500', async () => {
      const { token, orderId } = await createOrderForFreshClient();

      await request(app.getHttpServer())
        .post(`/v1/orders/${orderId}/cancel`)
        .set('Authorization', `Bearer ${token}`)
        .send({ reason: 'x'.repeat(256) })
        .expect(400);
    });
  });
});
