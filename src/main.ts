import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { NestExpressApplication } from '@nestjs/platform-express';
import { configureApp } from './app.config';
import { AppModule } from './app.module';

async function bootstrap() {
  // Stripe webhook signature verification needs the exact raw bytes of the request body — this
  // preserves them on req.rawBody alongside the normal parsed req.body for every route, with no
  // effect on anything else.
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  configureApp(app);
  // Without this, a SIGTERM (e.g. a Heroku dyno cycling, per architecture.md's deploy shape)
  // never fires PrismaService.onModuleDestroy, so $disconnect() never runs on shutdown.
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3000;

  await app.listen(port);
}
bootstrap().catch((error: unknown) => {
  // A startup failure (bad DATABASE_URL, a missing required env var, ...) must exit cleanly and
  // logged, not surface as a silent unhandled rejection.
  console.error('Failed to start application', error);
  process.exit(1);
});
