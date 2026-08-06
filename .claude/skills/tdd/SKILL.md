---
name: tdd
description: Execute a strict TDD cycle (Red-Green-Refactor) for a specific feature or behavior.
disable-model-invocation: true
argument-hint: "<description of what to implement>"
---

# TDD Cycle

Implement `$ARGUMENTS` following strict Test-Driven Development. You MUST follow this exact order — no skipping steps.

Testing levels and tools are defined in `docs/standards/testing-strategy.md`. For `apps/web`: unit and component tests use **Vitest + Testing Library** (colocated `Thing.test.ts(x)` beside the code); browser smoke uses **Playwright** once introduced. Pick the smallest level that can assert the behavior — prefer a unit/component test over a browser test whenever possible.

## Step 1 — Red (Failing Test)
1. Understand the requirement from the arguments
2. Write the smallest test that asserts the new behavior, at the lowest applicable level (colocated Vitest test for logic/components; Playwright smoke only for real-browser flows)
3. Run it (`cd apps/web && npm run test` or the specific file via `npx vitest run <path>`) — confirm it FAILS
4. **STOP.** Do NOT write implementation yet. Show the user the failing test.

## Step 2 — Green (Minimum Implementation)
1. Write the MINIMUM code necessary to make the failing test pass
2. No extra features, no "while I'm here" improvements
3. Run the affected tests — confirm they pass
4. Run the app's per-commit protocol (`format:check`, `lint`, `build`, `test` — see `testing-strategy.md`) — confirm clean
5. Show the user the implementation

## Step 3 — Refactor
1. Look for duplication, unclear names, or unnecessary complexity
2. Refactor while keeping all tests green and lint clean
3. Re-run the tests after each refactor step
4. Only refactor the code you just wrote — don't touch unrelated code

## Rules
- NEVER write implementation before the failing test exists
- NEVER write more code than needed to pass the test
- If multiple scenarios are needed, repeat the cycle for each one
- If you discover edge cases, add them as NEW tests (new Red cycle)
- Component tests assert contract/behavior (what renders per mode/props), not implementation details
- In browser tests keep selectors stable (`data-testid` or semantic queries)
