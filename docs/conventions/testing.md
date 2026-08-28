# Testing

> Goes stale if `package.json`'s test scripts change, or if R3/R5 (the two rules the
> concurrency tests exist to verify) change in
> [`business-invariants.md`](../rules/business-invariants.md).

## Commands

```bash
npm test              # unit tests
npm run test:watch    # unit tests, watch mode
npm run test:cov      # unit tests with coverage
npm run test:e2e      # e2e tests (test/jest-e2e.json)
npm run test:debug    # unit tests, --inspect-brk
```

## What needs a test, per slice

- **Every service method gets a unit test.** The challenge brief asks for this explicitly —
  it's not optional coverage.
- **The three critical paths get an e2e test:** authentication (signup/signin/refresh),
  checkout (cart or Payment Link through to a created order), and order history (listing and
  reading orders with the right visibility per role). Everything else gets e2e coverage as it
  becomes relevant, but these three are mandatory per the brief.

## The two concurrency tests this project actually needs

A sequential test — call the service, await it, call it again — never reaches the race window
these rules exist for. Both need genuinely concurrent calls (`Promise.all`) against the same row,
hitting the real database:

- **Stock decrement under simultaneous purchases** (R3). Two concurrent purchases of a variant
  with `stock = 1` — exactly one must succeed, the other must see the 0-row `UPDATE` result and
  handle it as R8 specifies, not throw.
- **Promo code usage limit under simultaneous checkouts** (R5). Two concurrent checkouts against
  a code with one redemption slot left — exactly one must succeed. Without the `FOR UPDATE` lock,
  both read the same pre-lock count and both pass.

## Do not

- **Mock away the exact thing the test exists to verify.** Mocking Prisma in the stock-decrement
  concurrency test defeats the test's entire purpose — the row lock only exists in the real
  database, not in a mock.
- **Skip an e2e "because the unit test covers the logic."** A unit test on a service method
  doesn't verify the guard actually rejects a non-owner, that the DTO validation actually fires
  on a malformed body, or that the controller-to-service wiring is correct. Those are exactly
  what e2e tests exist to catch.
