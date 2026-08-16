import { createContext, useContext } from 'react';

/**
 * The section slugs of the document currently being rendered.
 *
 * A question names the section it belongs to, and nothing in its own subtree
 * can tell whether that name exists — the headings are siblings ABOVE it in the
 * MDX tree, not children. So the document publishes its spine here and each
 * question checks itself against it.
 *
 * It lives in `lib/` rather than in `content/` on purpose: `content/` provides
 * it and `components/` consumes it, and `components → content` is not an edge
 * in the `FEATURE_EDGES` allowlist (`src/architecture.test.ts`). Adding one to
 * pass a set of strings would be a real architectural cost for no gain, whereas
 * `lib` is what both are already allowed to import.
 *
 * Empty means "not measured", not "this document has no sections": the spine is
 * read from the DOM after mount (`content/useSections.ts`), so it is empty on
 * the first render of every document. A checker that treated empty as authority
 * would flash an authoring error over every correct question on every page
 * load. A document that genuinely has no section is covered by the source-level
 * invariant in `content/architecture.test.ts` instead.
 */
const KnownSectionsContext = createContext<ReadonlySet<string>>(new Set());

export const KnownSectionsProvider = KnownSectionsContext.Provider;

/** The section slugs of the surrounding document; empty when not measured yet. */
export function useKnownSections(): ReadonlySet<string> {
  return useContext(KnownSectionsContext);
}
