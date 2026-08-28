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
  `@prisma/adapter-pg`), PostgreSQL 16 via Docker Compose for local dev.
- `prisma/schema.prisma` has **no models yet** — generator/datasource only. Do not treat it as
  authoritative; `docs/reference/erd/T-Shirt.dbml` is.
- `src/` has only the Nest placeholder plus `PrismaModule`/`PrismaService` wiring — no domain
  modules exist yet.
- `openapi.yaml` is the real, current API contract (also published on SwaggerHub).
- CASL (authorization) and BullMQ (queue) are decided but not installed — see
  `docs/conventions/coding-style.md` and `docs/architecture.md`.

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
