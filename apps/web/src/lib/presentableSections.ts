import { createContext, useContext } from 'react';

/**
 * The set of slide-title slugs the surrounding document exposes as
 * deep-linkable from the book (#256). `mdxHeading` reads it to decide
 * whether an h2 gets a "Presentar sección" button next to its `#` anchor.
 *
 * Split from the value that carries it — the docId — so the button can
 * check membership and build `/d/${docId}/present?section=<slug>` from one
 * context read. `docId` is `null` when there is no surrounding document
 * (e.g. `/catalog` renders a component in isolation): mdxHeading uses that
 * as the silent "no button" signal.
 *
 * Lives in `lib/` for the same reason as [[known-sections]]: the provider
 * lives in `presentation/` (which is what walks the slide model) and the
 * consumer lives in `content/`, and `content → presentation` is not an
 * edge in the `FEATURE_EDGES` allowlist (`src/architecture.test.ts`).
 * Sharing the context here — a set both features are already allowed to
 * import — avoids introducing that cross-feature edge for a single value.
 *
 * Empty means "no presentable sections", not "not measured": the wrapper
 * computes the set synchronously from the rendered MDX children (the same
 * technique `SlideDeck` uses to build its slide list), so a mounted
 * document either has a non-empty set or doesn't (`presentation: none`).
 * A page outside any document (catalog, family pages) never mounts the
 * wrapper — the default value below leaves it empty and `docId` null.
 */
interface PresentableSectionsValue {
  /** The document id when we are inside one; null on catalog / anywhere else. */
  docId: string | null;
  /** Slide-title slugs the current document publishes. */
  presentableSlugs: ReadonlySet<string>;
}

const EMPTY: PresentableSectionsValue = { docId: null, presentableSlugs: new Set() };

const PresentableSectionsContext = createContext<PresentableSectionsValue>(EMPTY);

export const PresentableSectionsProvider = PresentableSectionsContext.Provider;

/** The presentable-section spine of the surrounding document; empty when absent. */
export function usePresentableSections(): PresentableSectionsValue {
  return useContext(PresentableSectionsContext);
}
