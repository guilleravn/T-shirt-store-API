# T-shirt Store API

Backend API built with [NestJS](https://nestjs.com/), [Prisma ORM](https://www.prisma.io/) and PostgreSQL.

## Stack

- **NestJS 11** (TypeScript)
- **Prisma ORM 7** with the `prisma-client` generator (CommonJS output) and the `@prisma/adapter-pg` driver adapter
- **PostgreSQL 16 + Redis 7** (via Docker Compose for local development)
- **JWT auth** (`@nestjs/jwt` + `@nestjs/passport`), bcrypt for passwords
- **BullMQ** (`@nestjs/bullmq`) for background jobs (currently: password-reset and password-changed emails)
- **Brevo** (`@getbrevo/brevo`) for transactional email — requires `BREVO_API_KEY` and a verified
  sender address (`EMAIL_FROM_ADDRESS`) in `.env`, see below
- Config validation with `@nestjs/config` + `joi`
- Request validation with `class-validator` / `class-transformer`

## Prerequisites

- Node.js 20.19+ (Node 24 in use during setup)
- Docker Desktop (for the local Postgres and Redis containers)

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment file and fill in the real values — `JWT_SECRET` (any long random
   string), and `BREVO_API_KEY`/`EMAIL_FROM_ADDRESS` from your own
   [Brevo](https://www.brevo.com/) account. `EMAIL_FROM_ADDRESS` must be a sender verified in
   the Brevo dashboard, or every send fails:

   ```bash
   cp .env.example .env
   ```

3. Start Postgres and Redis (host ports `5433` and `6380`, shifted off their defaults to avoid
   clashing with anything else already running locally):

   ```bash
   npm run docker:up
   ```

4. Apply migrations and generate the Prisma client:

   ```bash
   npm run prisma:migrate
   npm run prisma:generate
   ```

5. Run the app in watch mode:

   ```bash
   npm run start:dev
   ```

   The API listens on `http://localhost:3000/v1` by default (`PORT` in `.env`; the `/v1` prefix
   is set in `src/main.ts`).

## Database workflow

- Define models in `prisma/schema.prisma`.
- Create/apply a migration: `npm run prisma:migrate`
- Regenerate the client after schema changes: `npm run prisma:generate`
- Browse data: `npm run prisma:studio`
- Stop the Postgres/Redis containers: `npm run docker:down`

The generated Prisma Client lives in `generated/prisma` (git-ignored) and is imported via `PrismaService` (`src/prisma/prisma.service.ts`), which is provided globally through `PrismaModule`.

## Project structure

```
src/
  auth/            # signup/signin/refresh/signout/forgot-password/reset-password, /me, JWT strategy/guard
  email/           # BullMQ-backed EmailService (Brevo) + queue producer/processor
  config/          # env validation schema
  prisma/          # PrismaService + PrismaModule (global)
  app.module.ts
  main.ts          # global ValidationPipe + the /v1 route prefix
prisma/
  schema.prisma
  migrations/
docker-compose.yml # local Postgres + Redis containers
```

## Scripts

| Script                              | Description                             |
| ----------------------------------- | --------------------------------------- |
| `npm run start:dev`                 | Start the app in watch mode             |
| `npm run build`                     | Compile the project                     |
| `npm run typecheck`                 | Type-check without emitting output      |
| `npm run lint`                      | Lint (check only)                       |
| `npm run lint:fix`                  | Lint and auto-fix                       |
| `npm test`                          | Run unit tests                          |
| `npm run test:e2e`                  | Run end-to-end tests                    |
| `npm run docker:up` / `docker:down` | Start/stop the local Postgres container |
| `npm run prisma:generate`           | Regenerate the Prisma client            |
| `npm run prisma:migrate`            | Create and apply a migration            |
| `npm run prisma:studio`             | Open Prisma Studio                      |
