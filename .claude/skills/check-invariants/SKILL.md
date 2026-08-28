---
name: check-invariants
description: Verify a diff against the eight business invariants (R1-R8) and the security invariants in docs/rules/business-invariants.md, one rule at a time, reporting which ones the change touches and whether it respects them. Use before committing anything that touches orders, order_items, order_status_history, payments, stripe_events, product_variants, promo_codes, or promo_redemptions — or whenever asked to review/check a change against the business rules or invariants.
---

# Check invariants

Reviewing a change against R1-R8 without a forced procedure gets done inconsistently — some
rules get checked, some get skipped, and there's no structured record of which. This skill
applies all of them, in order, every time.

## Procedure

1. **Determine the diff.** Default to `git diff --cached` (staged changes). If the user names a
   commit range, branch, or file list instead, use that.

2. **Read `docs/rules/business-invariants.md` in full** — do not rely on memory of it from
   earlier in the conversation; it may have changed.

3. **Walk R1 through R8 in order.** For each rule:
   - Decide if the diff touches code relevant to that rule's concern (see the table below for
     what each rule governs).
   - If relevant: check the diff against exactly what the rule _requires_ (not the general
     topic — the specific mechanism). Report `PASS`, `FAIL`, or `UNCLEAR` with the file:line and
     a one-sentence reason.
   - If not relevant: report `N/A`. Do not skip the row — an explicit N/A is the record that the
     rule was actually considered.

   | Rule | Concern                             | Relevant if the diff touches...                                |
   | ---- | ----------------------------------- | -------------------------------------------------------------- |
   | R1   | PAID orders are immutable           | Any write to `orders` or `order_items` outside order creation  |
   | R2   | status + history written atomically | Any `orders.status` write                                      |
   | R3   | conditional stock UPDATE            | Any stock decrement                                            |
   | R4   | Stripe event idempotency            | `stripe_events` handling, the webhook handler                  |
   | R5   | promo usage under row lock          | `promo_redemptions` insert, `promo_codes` read during checkout |
   | R6   | money as integer cents              | Any monetary field, DTO, or calculation                        |
   | R7   | delivery assignment at one moment   | `delivery_person_id` writes                                    |
   | R8   | oversold webhook still commits      | The stock-decrement webhook path specifically                  |

4. **Check the security invariants** (same file, "Security invariants" section) if the diff
   touches auth, tokens, the `ValidationPipe`, or `/webhooks/stripe`. Same PASS/FAIL/N/A
   treatment.

5. **Report.** A table — `Rule | Status | Note` — covering all 8 rules plus any triggered
   security invariants, followed by one line: does this diff violate anything, yes or no. If
   yes, name the exact fix, don't just flag the problem.

## What this is not

Not a general code review. It checks exactly the invariants in that one file — nothing about
style, test coverage, or unrelated bugs. If asked for a broader review, run this alongside it,
not instead of it.
