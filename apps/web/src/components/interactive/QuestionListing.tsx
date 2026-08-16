import { isRuntimeId } from '../../lib/runtimeIds';
import { LazyCodeEditor } from './lazyCodeEditor';

export interface QuestionListingProps {
  language: string;
  source: string;
}

/**
 * The code a question shows: coloured, and **never runnable**.
 *
 * A fence in a document body is an editor with a Run button (the shell maps
 * `pre` to one). Inside a question that button would answer "¿qué imprime este
 * programa?" before the student did, so this renders the reading variant
 * instead — which also loads no compiler, so a code question costs a reader
 * nothing extra on a document that had no code.
 *
 * Its own file so `Question.tsx` exports a component and nothing else, which is
 * what the fast-refresh lint rule asks for.
 */
export function QuestionListing({ language, source }: QuestionListingProps) {
  if (isRuntimeId(language)) {
    return (
      <LazyCodeEditor
        language={language}
        variant="read"
        defaultValue={source}
        showCopy={false}
        showFileName={false}
      />
    );
  }
  // No runtime for this language, so no highlighter either — the same fallback
  // an ordinary fence gets.
  return (
    <pre className="overflow-x-auto rounded border border-rule bg-sunk p-3 font-mono text-xs text-ink">
      <code>{source}</code>
    </pre>
  );
}
