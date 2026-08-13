/**
 * Which languages the platform can execute — the name of the set, not the
 * machinery behind it.
 *
 * It lives in `lib/` rather than in `runtime/` because a consumer may need to
 * ASK the question without paying for the answer. `components/MdxPre` decides
 * whether a markdown fence is highlightable, and it is reached eagerly through
 * the shell's MDX map: importing the runtime seam for this pulled `useRuntime`,
 * the registry, the descriptors and the Java launcher into the eager payload —
 * 1 eager chunk and 503kB became 9 and 542kB, falsifying ADR-0018's stated
 * claim to defend ("no CodeMirror, no compiler, no runtime in the entry
 * chunk"). Guarded now by `architecture.test.ts`.
 *
 * Same shape as `lib/catalogEntry.ts` and `lib/componentMeta.ts`: the producing
 * feature never learns who consumes it (frontend-code-style.md).
 */
export const RUNTIME_IDS = ['cpp', 'python', 'java'] as const;

export type RuntimeId = (typeof RUNTIME_IDS)[number];
