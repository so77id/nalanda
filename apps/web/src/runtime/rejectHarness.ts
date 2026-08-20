import type { RunRequest } from './contract';

/**
 * The transport-level fields every runtime already knows how to read. Anything
 * else on the request is a second compilation unit the runtime cannot build —
 * or a typo that would be silently ignored, which is the same failure mode.
 *
 * Enumerated once, here, so the shape guard below stays honest against the
 * `RunRequest` type: adding a field to the contract that a worker must reject
 * requires nothing except keeping this set in sync (a review-catchable delta).
 */
const KNOWN_TRANSPORT_KEYS = new Set(['id', 'source', 'stdin']);

/**
 * Refuses a request carrying a compilation unit the runtime cannot build.
 *
 * Only Java compiles a second unit today (a `harness`). A runtime that quietly
 * ran `source` alone would report a passing exercise that verified nothing —
 * ADR-0019 §4 calls that the worst failure this feature could have. The answer
 * is to throw rather than ignore the field.
 *
 * The guard covers the SHAPE, not one field name: it walks `Object.keys` and
 * refuses anything outside `KNOWN_TRANSPORT_KEYS` that arrives populated.
 * A future second unit under a new name (`resource`, `helper`, whatever the
 * contract grows) is caught by CONSTRUCTION — the pre-#209 shape had a
 * `library` field alongside `harness`, and the moment the WP that adds a
 * third field forgets to add another `if` here is the moment C++ and Python
 * would run the snippet bare. This shape-check makes the promise real:
 * a `library` reintroduced tomorrow throws the same way `harness` does today,
 * with no code change to this file.
 *
 * Extracted from the two workers because the suite cannot run a worker at all:
 * both guards were deletable with 295 tests green until this existed.
 */
export function rejectHarness(request: RunRequest, language: string): void {
  const bag = request as unknown as Record<string, unknown>;
  for (const key of Object.keys(bag)) {
    if (KNOWN_TRANSPORT_KEYS.has(key)) continue;
    if (bag[key] === undefined) continue;
    if (key === 'harness') {
      throw new Error(`the ${language} runtime does not support exercises yet`);
    }
    throw new Error(
      `the ${language} runtime does not know how to handle the request field "${key}"`,
    );
  }
}
