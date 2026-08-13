import type { ReactNode } from 'react';

import { fenceOf } from '../lib/codeFences';
import { RUNTIME_IDS } from '../lib/runtimeIds';
import type { RuntimeId } from '../lib/runtimeIds';
import { LazyCodeEditor } from './interactive/lazyCodeEditor';

interface Props {
  children?: ReactNode;
}

/**
 * Whether the platform can highlight this fence — the registry is the authority,
 * and asking it is also what narrows the string into a `RuntimeId` without a cast.
 */
function isKnownLanguage(language: string | null): language is RuntimeId {
  return language !== null && (RUNTIME_IDS as readonly string[]).includes(language);
}

/**
 * Every `<pre>` a document produces — the seam where a markdown fence becomes a
 * component.
 *
 * Registered on `pre` and never on `code`: `lib/codeFences.ts` identifies an
 * exercise's `starter` and `test` fences by the literal `code` intrinsic type,
 * so mapping `code` would leave every `<Exercise>` unable to find its own body.
 * Mapping the wrapper leaves that walk untouched — it recurses through and still
 * meets the `code` inside.
 *
 * The lazy wrapper, never the editor itself: the shell builds its MDX map
 * eagerly, so naming `CodeEditor` here would put CodeMirror in the entry chunk
 * for every reader of every page (ADR-0018 §7).
 *
 * One property was measured rather than assumed, because the editor renders by
 * viewport and could in principle keep a listing's tail out of the DOM, where
 * the browser's own `Ctrl+F` would stop finding it: at the sizes a course
 * document uses it does not. Every line stays in the DOM — including lines
 * scrolled out of view inside a slide's capped box — so search keeps working
 * (#85 AC11, measured at 1440px and 390px; the rule for authors is in
 * `guides/add-a-course-document.md` step 3).
 */
export function MdxPre({ children }: Props) {
  const fence = fenceOf(children);
  if (!fence || !isKnownLanguage(fence.language)) return <pre>{children}</pre>;

  return (
    <LazyCodeEditor
      language={fence.language}
      variant="snippet"
      // A fence is not a file. `snippet` turns the filename on, which headed a
      // three-line fragment `Main.java` — two screens from where the document
      // teaches `Hola.java → [javac] → Hola.class`. An authored <CodeEditor>
      // still gets one; a quoted listing has no name to claim.
      showFileName={false}
      defaultValue={fence.source}
    />
  );
}
