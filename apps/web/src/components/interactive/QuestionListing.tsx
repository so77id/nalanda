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
 * instead — which loads no compiler.
 *
 * It is NOT free, and the first version of this comment said it was ("costs a
 * reader nothing extra on a document that had no code"). Measured in #144 by
 * appending one `java` question to the code-free `04-planificacion.mdx` and
 * building: that document went from 4 local chunks to 11 — `CodeEditor`,
 * `runtime`, `java`, `useRunShortcut` and three CodeMirror bundles, 486,382
 * bytes raw and ~157 kB gzip. The cause is `CodeEditor.tsx`, which calls
 * `loadRuntime(languageId)` in an effect for EVERY variant, `read` included;
 * only the compiler behind `createWorker` stays untouched.
 *
 * So the honest rule is: on a document that already carries runnable code the
 * listing is free (measured on `07-java-tipos-y-flujo`: same 14 responses, same
 * asset set, +0.37% of the page's JS). On one that carries none, a single code
 * question buys the whole editor stack. Weigh it before adding the first one.
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
