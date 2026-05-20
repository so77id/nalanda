---
name: review
description: Code review of current changes. Checks Clean Code, security, edge cases, and test coverage.
disable-model-invocation: true
context: fork
---

# Code Review

Review all uncommitted changes in this repository. Analyze each changed file for the following:

## 1. Correctness
- Does the code do what it claims?
- Are there off-by-one errors, null/undefined risks, or unhandled error paths?
- React hooks follow Rules of Hooks; effects have correct dependency arrays
- Async cleanup on unmount (AbortController, subscriptions, timers)

## 2. Clean Code
- Functions and components doing one thing only?
- Meaningful names (no abbreviations)?
- Max 2 levels of indentation in JS?
- No dead code or premature abstractions?

## 3. Test / Smoke Quality
- Is there a smoke test (or change to an existing one) for every new user-visible behavior?
- Are edge cases covered (empty state, error state, large inputs)?
- Are smoke-test selectors stable (`data-testid`, semantic queries — not brittle CSS paths)?
- Are smoke tests self-contained (start from a known URL, no shared mutable state)?

## 4. Security
- No hardcoded secrets or credentials
- No user-supplied strings passed to `eval`, `new Function`, or `dangerouslySetInnerHTML` without sanitization
- WASM and browser-API failure points have error handling
- External URLs and assets come from trusted sources

## 5. Consistency
- Follows existing patterns in the codebase
- Imports ordered and grouped (external → internal → relative)
- File and folder naming matches existing conventions
- Tailwind class lists are reasonable; component extraction when they grow

## Output Format
For each issue found, report:
- **File:Line** — description of the issue
- **Severity**: critical / warning / suggestion
- **Fix**: what to change

If everything looks good, say so briefly.
