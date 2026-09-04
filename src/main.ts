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

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') ?? 3000;

  await app.listen(port);
}
void bootstrap();
