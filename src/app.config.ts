import { ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import helmet from 'helmet';

// Shared between src/main.ts's real bootstrap and e2e tests, so a test exercises the exact same
// middleware/pipes/prefix as production instead of Nest's untouched defaults.
export function configureApp(app: NestExpressApplication): void {
  // Must run before any route handles a request — same rule as any other Express middleware.
  app.use(helmet());
  app.enableCors();

  // The deploy target (architecture.md) sits behind a router — required for
  // @nestjs/throttler's IP extraction to read X-Forwarded-For instead of the proxy's own IP.
  app.set('trust proxy', 1);

  // openapi.yaml's Local server is http://localhost:3000/v1 — every controller route assumes
  // this prefix.
  app.setGlobalPrefix('v1');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );
}
