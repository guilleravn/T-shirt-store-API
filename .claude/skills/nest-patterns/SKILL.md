---
name: nest-patterns
description: Check a diff for correct NestJS mechanics — constructor DI, decorator usage, module registration, and guard/pipe order — as distinct from where business logic belongs. Use whenever a change adds or edits a controller, provider, guard, or module.
---

# Nest patterns

`docs/conventions/coding-style.md` says which layer owns what (controller vs service vs guard),
but not whether NestJS itself is wired correctly — a provider missing `@Injectable()`, a guard
registered in the wrong order, or a module that never exports something another module needs are
mechanical mistakes that layer conventions alone don't catch. This skill checks the wiring.

## Procedure

1. **Determine scope.** Default to `git diff --cached` (staged changes). If the user names a
   commit range or file list instead, use that.

2. **For every changed controller, provider, guard, or module, check:**

   | Check                   | What's correct                                                                                                                                                                                                                                                                                                           |
   | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | Dependency injection    | Dependencies come in via the constructor (`private readonly x: X`), never `new SomeService()` inside a method.                                                                                                                                                                                                           |
   | Decorators present      | Every provider has `@Injectable()`; every controller has `@Controller()` plus a route decorator per method.                                                                                                                                                                                                              |
   | Guard order             | `@UseGuards(JwtAuthGuard, RolesGuard)` — auth guard first, role/ability guard second. This repo's existing controllers are consistent on this order (`RolesGuard` reads `req.user`, which only exists once `JwtAuthGuard` has run) — a diff with the order reversed, or `RolesGuard` alone with no auth guard, is a bug. |
   | Guard scope             | Guards check identity/role/ability only — no business-state checks or Prisma calls inside a guard (that belongs in the service, per `coding-style.md`'s Guard row).                                                                                                                                                      |
   | Module registration     | A new provider/controller is declared in its owning module's `providers`/`controllers` array (see the module-ownership table in `coding-style.md`); anything another module needs is in that module's `exports`, not reached via a relative import into its internals.                                                   |
   | No circular workarounds | No `forwardRef()` introduced to paper over a module boundary that's actually wrong — if one module needs another's provider, check whether the ownership table means the code belongs in the other module instead.                                                                                                       |

3. **Report** a table — `File:line | Check | Status | Fix` — for every check that applies to the
   diff (skip a row entirely if nothing in the diff exercises it, don't mark it PASS by default).
   End with one line: does this diff violate anything, yes or no.

## What this is not

Not a check of which layer should contain a given piece of logic (that's `quality-gate`'s
controller/DTO/service split) and not a business-rule check (`check-invariants`) — this only
verifies that NestJS's own machinery (DI, decorators, module wiring, guard order) is used
correctly.
