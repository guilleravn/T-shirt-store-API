# T-shirt Store API

Backend API built with [NestJS](https://nestjs.com/), [Prisma ORM](https://www.prisma.io/) and PostgreSQL.

## Stack

- **NestJS 11** (TypeScript)
- **Prisma ORM 7** with the `prisma-client` generator (CommonJS output) and the `@prisma/adapter-pg` driver adapter
- **PostgreSQL 16** (via Docker Compose for local development)
- Config validation with `@nestjs/config` + `joi`
- Request validation with `class-validator` / `class-transformer`

## Prerequisites

- Node.js 20.19+ (Node 24 in use during setup)
- Docker Desktop (for the local Postgres container)

## Getting started

1. Install dependencies:

   ```bash
   npm install
   ```

2. Copy the environment file and adjust if needed:

   ```bash
   cp .env.example .env
   ```

3. Start Postgres (runs in Docker on host port `5433` to avoid clashing with any other local Postgres on `5432`):

   ```bash
   npm run docker:up
   ```

4. Generate the Prisma client (re-run any time `prisma/schema.prisma` changes):

   ```bash
   npm run prisma:generate
   ```

5. Run the app in watch mode:

   ```bash
   npm run start:dev
   ```

   The API listens on `http://localhost:3000` by default (`PORT` in `.env`).

## Database workflow

- Define models in `prisma/schema.prisma`.
- Create/apply a migration: `npm run prisma:migrate`
- Regenerate the client after schema changes: `npm run prisma:generate`
- Browse data: `npm run prisma:studio`
- Stop the database container: `npm run docker:down`

The generated Prisma Client lives in `generated/prisma` (git-ignored) and is imported via `PrismaService` (`src/prisma/prisma.service.ts`), which is provided globally through `PrismaModule`.

## Project structure

```
src/
  config/          # env validation schema
  prisma/          # PrismaService + PrismaModule (global)
  app.module.ts
  main.ts
prisma/
  schema.prisma
  migrations/
docker-compose.yml # local Postgres container
```

## Scripts

| Script | Description |
| --- | --- |
| `npm run start:dev` | Start the app in watch mode |
| `npm run build` | Compile the project |
| `npm run typecheck` | Type-check without emitting output |
| `npm run lint` | Lint (check only) |
| `npm run lint:fix` | Lint and auto-fix |
| `npm test` | Run unit tests |
| `npm run test:e2e` | Run end-to-end tests |
| `npm run docker:up` / `docker:down` | Start/stop the local Postgres container |
| `npm run prisma:generate` | Regenerate the Prisma client |
| `npm run prisma:migrate` | Create and apply a migration |
| `npm run prisma:studio` | Open Prisma Studio |
