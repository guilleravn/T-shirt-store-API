# CLAUDE.md

## Language

All code, comments, identifiers, commit messages, and documentation in this repository are
written in English. The developer communicates in Spanish; nothing written into this repo is —
translate before you write, including anything ported from the ERD source notes.

## What this is

T-Shirt Store API: a NestJS + Prisma + PostgreSQL backend built for a BE Nerdery challenge. It
implements auth, a product catalog, cart/checkout via Stripe, order tracking, and promo codes,
against the data model in `docs/reference/erd/`. It ships as a working API plus the one-page
architecture write-up the challenge requires.

## Stack — current state

- NestJS 11, TypeScript, Prisma ORM 7 (`prisma-client` generator, CommonJS output,
  `@prisma/adapter-pg`), PostgreSQL 16 + Redis via Docker Compose for local dev.
- `prisma/schema.prisma` fully models all 20 tables in `docs/reference/erd/T-Shirt.dbml`: `User`,
  `RefreshToken`, `PasswordResetToken` (Auth); `Category`, `Product`, `ProductCategory`, `Color`,
  `Size`, `ProductVariant`, `ProductImage` (Catalog); `Cart`, `CartItem`, `ProductLike`
  (Engagement); `Order`, `OrderItem`, `OrderStatusHistory`, `Payment`, `StripeEvent` (Sales); and
  `PromoCode`, `PromoRedemption` (Promo) — verified model-by-model against the DBML, no drift.
  `docs/reference/erd/T-Shirt.dbml` stays canonical; any further schema change needs the matching
  DBML edit in the same slice (see the non-negotiable process rule below).
- `src/` has `AuthModule` (signup/signin/refresh/signout/forgot-password/reset-password/`/me`,
  JWT + Passport, bcrypt for passwords, SHA-256 for token-table lookups), `EmailModule`
  (BullMQ-backed; `EmailService` is bound to `BrevoEmailService`, sending real transactional
  email via `@getbrevo/brevo` — needs `BREVO_API_KEY`/`EMAIL_FROM_ADDRESS` in `.env`, and that
  sender address verified in the Brevo dashboard, or sends fail), `CatalogModule`
  (categories/colors/sizes are read-only, seeded via `prisma/seed.ts`; products, variants, and
  product images all support the full CRUD `openapi.yaml` documents, MANAGER-gated via
  `RolesGuard`; images are stored in S3 via `S3ImageStorageService`, needs
  `AWS_REGION`/`AWS_S3_BUCKET`/`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` in `.env`),
  `EngagementModule` (cart and product likes, CLIENT-gated via `RolesGuard`), `PromoModule`
  (promo code CRUD + `/promo-codes/validate`, MANAGER/CLIENT-gated — usage-based status
  (`EXHAUSTED`) is reachable today: it counts real `PromoRedemption` rows), and `SalesModule`
  (`src/sales/`: orders list/detail/status-transition/cancel, cart checkout via
  `POST /orders` + `POST /checkout/payment-intent`, direct `POST /checkout/payment-link`, the
  Stripe webhook, and a BullMQ-backed refund queue — CLIENT/MANAGER/DELIVERY-gated per action via
  `RolesGuard`, with `@casl/ability` layered on top for per-order (own-resource) abilities; see
  `docs/conventions/coding-style.md`'s "Authorization current state").
- `openapi.yaml` is the real, current API contract (also published on SwaggerHub). The API is
  served under a global `/v1` prefix (set in `src/main.ts`). Helmet and CORS are enabled globally
  (`src/app.config.ts`, shared between `main.ts` and e2e tests so both configure the app
  identically).
- `@nestjs/bullmq` (BullMQ on Redis) is installed and wired for the two email jobs above and for
  Sales's refund-on-cancellation job. `@casl/ability` is installed and used in `SalesModule` (see
  above) — `docs/conventions/coding-style.md` has the exact scope. No separate worker process
  exists yet; queue jobs run in-process with the API.

## Commands

```bash
npm run start:dev                             # watch mode
npm run build && npm run lint && npm test     # before every commit
npm run test:e2e
npm run docker:up                             # local Postgres (docker-compose.yml)
npm run prisma:generate
npm run prisma:migrate
```

## Non-negotiable process rules

- Never `git push` or `gh pr create` (needs a pushed branch) — commit locally; the developer
  reviews and pushes. This is enforced by a hook (`.claude/hooks/block-git-push.cjs`), not just
  stated here — it denies, it does not ask, and there is no override.
- State the full commit message in chat and wait for approval before running `git commit`.
  Never commit a message that hasn't been seen and confirmed first. Commit messages carry no
  tooling attribution — no `Co-Authored-By:` trailer, no "Generated with" footer.
- Plan before implementing anything beyond a trivial fix — see `docs/conventions/git-workflow.md`.
- Commit per slice, not one commit at the end — and a slice isn't finished until the docs it
  affects are updated in that same commit.
- Secrets (Stripe keys, JWT secret, `DATABASE_URL`) never go in a prompt or in the repo.
- Money is integer minor units (cents), everywhere — database, service layer, DTOs, API
  responses. Never float, never `Decimal`, never `parseFloat`. Only the frontend and the email
  templates divide by 100. Percentage discounts round with `Math.round` (R6).
- The ERD is canonical: any change to `prisma/schema.prisma` needs the matching change to
  `docs/reference/erd/T-Shirt.dbml` in the same slice — a schema drifted from the ERD makes
  every rule in `business-invariants.md` unverifiable.

## Where to look

| Question                                                                 | Document                                                       |
| ------------------------------------------------------------------------ | -------------------------------------------------------------- |
| Is this business rule real, and what breaks if I skip it?                | `docs/rules/business-invariants.md`                            |
| What was considered and rejected, and why?                               | `docs/rules/business-invariants.md` ("Evaluated and rejected") |
| Where does this belong — controller, DTO, guard, service?                | `docs/conventions/coding-style.md`                             |
| How do I structure a plan, a slice, a commit?                            | `docs/conventions/git-workflow.md`                             |
| What needs a test, and of what kind?                                     | `docs/conventions/testing.md`                                  |
| What's the exact request/response shape for an endpoint?                 | `openapi.yaml`                                                 |
| What conventions apply across all endpoints (pagination, money, errors)? | `docs/reference/api-contracts.md`                              |
| How does the ERD map to Prisma?                                          | `docs/reference/data-model.md`                                 |
| What's the production architecture, and what do we monitor?              | `docs/architecture.md`                                         |
