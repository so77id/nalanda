---
name: tdd
description: Execute a strict TDD cycle (Red-Green-Refactor) for a specific feature or behavior.
disable-model-invocation: true
argument-hint: "<description of what to implement>"
---

# TDD Cycle

Implement `$ARGUMENTS` following strict Test-Driven Development. You MUST follow this exact order — no skipping steps.

Nalanda uses puppeteer-based smoke tests at the repo root (`smoke-test-*.mjs`) instead of a unit-test framework. The "test" in each step below refers to one of those scripts.

## Step 1 — Red (Failing Test)
1. Understand the requirement from the arguments
2. Identify (or create) the smallest smoke test that asserts the new behavior. Either add an assertion to an existing `smoke-test-<area>.mjs` or create a new `smoke-test-<feature>.mjs`
3. Run the smoke test (`node smoke-test-<feature>.mjs`) — confirm it FAILS
4. **STOP.** Do NOT write implementation yet. Show the user the failing test.

## Step 2 — Green (Minimum Implementation)
1. Write the MINIMUM code necessary to make the failing test pass
2. No extra features, no "while I'm here" improvements
3. Run the affected smoke test(s) — confirm they pass
4. Run `npm run lint` — confirm lint is clean
5. Show the user the implementation

## Step 3 — Refactor
1. Look for duplication, unclear names, or unnecessary complexity
2. Refactor while keeping all tests green and lint clean
3. Re-run the smoke test(s) after each refactor step
4. Only refactor the code you just wrote — don't touch unrelated code

## Rules
- NEVER write implementation before the failing test exists
- NEVER write more code than needed to pass the test
- If multiple scenarios are needed, repeat the cycle for each one
- If you discover edge cases, add them as NEW assertions or NEW smoke tests (new Red cycle)
- Keep selectors in smoke tests stable (`data-testid` or semantic queries)
