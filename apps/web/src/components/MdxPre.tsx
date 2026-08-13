import type { ReactNode } from 'react';

import { fenceOf } from '../lib/codeFences';
import { RUNTIME_IDS } from '../runtime';
import type { RuntimeId } from '../runtime';
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
 */
export function MdxPre({ children }: Props) {
  const fence = fenceOf(children);
  if (!fence || !isKnownLanguage(fence.language)) return <pre>{children}</pre>;

  return <LazyCodeEditor language={fence.language} variant="snippet" defaultValue={fence.source} />;
}
