import type { ReactNode } from 'react';

import type { CatalogEntry } from '../../lib/catalogEntry';

// The wrapper, not the component. The entries are no longer eager (#122), so
// this no longer guards the ENTRY chunk — it guards the catalog's own: a static
// import here would pull CodeMirror into the chunk /catalog fetches, for a page whose
// examples the reader may never scroll to. It is also what a document writes,
// which is what an example must render. Aliased for exactly that.
import { LazyExercise as Exercise } from './lazyExercise';

/** What the MDX pipeline hands the component for an annotated fence. */
function fence(meta: string, code: string): ReactNode {
  return (
    <pre>
      <code className="language-java" data-meta={meta}>
        {code}
      </code>
    </pre>
  );
}

const STARTER = `class Solution {
    static boolean esPar(int n) {
        // tu código aquí
        return false;
    }
}
`;

const CASES = `check(Solution.esPar(4), true);
check(Solution.esPar(7), false);
check(Solution.esPar(0), true);
`;

const SOLUTION = `class Solution {
    static boolean esPar(int n) {
        return n % 2 == 0;
    }
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const exerciseCatalogEntry: CatalogEntry = {
  name: 'Exercise',
  family: 'interactive',
  description:
    "A problem the student solves in place, checked automatically in their own browser. The cases are compiled into a separate harness class that calls the student's method, so what is verified is the method rather than what the program printed — nobody fails for formatting their output differently.",
  whenToUse:
    'When a page asks the student to write code rather than read it. Author the statement as ordinary prose and add annotated fences: ```java starter``` seeds the editor, ```java test``` is inlined as the body of the harness’s `main` — statements only, no method declarations, and `check(obtenido, esperado)` in that order or the feedback reads backwards. Optional: ```java solution``` — a reference implementation revealed by a toggle button. It is display-only and never inlined into the harness, so nothing about it constrains the class name or reserved-name rules. Its absence hides the button. ' +
    'The cases stay hidden until the first run — that is pacing, not secrecy: everything under `content/` is published, so the page source reveals them to anyone who looks. Never author an exercise whose cases must stay private. ' +
    'A verdict is feedback, never evidence: it travels in-band on stdout, so a student who prints the markers themselves gets a green board. That is fine for practice and disqualifying for anything a mark depends on. ' +
    'Only Java validates today; Python and C++ reject a harness rather than pretend to check one. The class name in the starter and the one the cases call must agree — if a student renames their class the harness stops resolving it, which surfaces as a compile error. ' +
    "And the sharp edge Java brings (ADR-0017): it runs on the page's main thread, so a student's endless loop freezes the tab and nothing recovers it. That is likeliest here, of all places, because here is where students write the loops. The editor is saved to localStorage immediately before every run, so a frozen tab costs a reload rather than their work — but only what was there at that run: edits made and never run are not saved. Reiniciar clears the saved draft as well as the editor — and so does editing the starter fence, which changes the key the drafts live under and orphans every attempt saved against the old one. " +
    'The class names `NalandaLauncher` and `NalandaCheck` are reserved: a student program declaring one of them at TOP LEVEL is refused before it compiles, entry class or not (#123), with a message saying so. A nested declaration is fine — it compiles to `Solucion$NalandaLauncher.class` and overwrites nothing. The rule reaches the `test` fence too, where the failure is reported to the document author rather than blamed on the student.',
  props: [
    {
      name: 'title',
      type: 'string',
      description: "Shown as the exercise's heading. Optional.",
    },
    {
      name: 'language',
      type: "'java' | 'cpp' | 'python'",
      default: "'java'",
      description:
        'Which runtime compiles and runs it. Only Java can validate: the other two refuse a harness instead of reporting a pass for something they never checked.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'The statement as prose, plus a fence marked `starter` (seeds the editor), one marked `test` (the harness body), and optionally one marked `solution` (a reference implementation the reader can reveal). Prose renders; the fences do not — they would show the code twice and spoil the cases.',
    },
  ],
  examples: [
    {
      title: 'A complete exercise',
      code: `<Exercise title="¿Es par?">

Escribe \`esPar\`, que recibe un entero y devuelve \`true\` si es par.

\`\`\`java starter
class Solution {
    static boolean esPar(int n) {
        // tu código aquí
        return false;
    }
}
\`\`\`

\`\`\`java test
check(Solution.esPar(4), true);
check(Solution.esPar(7), false);
check(Solution.esPar(0), true);
\`\`\`

</Exercise>`,
      render: () => (
        <Exercise title="¿Es par?">
          <p>
            Escribe <code>esPar</code>, que recibe un entero y devuelve <code>true</code> si es par.
          </p>
          {fence('starter', STARTER)}
          {fence('test', CASES)}
        </Exercise>
      ),
    },
    {
      title: 'With a reference solution (revealed by a toggle button)',
      code: `<Exercise title="¿Es par?">

Escribe \`esPar\`, que recibe un entero y devuelve \`true\` si es par.

\`\`\`java starter
class Solution {
    static boolean esPar(int n) {
        // tu código aquí
        return false;
    }
}
\`\`\`

\`\`\`java test
check(Solution.esPar(4), true);
check(Solution.esPar(7), false);
\`\`\`

\`\`\`java solution
class Solution {
    static boolean esPar(int n) {
        return n % 2 == 0;
    }
}
\`\`\`

</Exercise>`,
      render: () => (
        <Exercise title="¿Es par?">
          <p>
            Escribe <code>esPar</code>, que recibe un entero y devuelve <code>true</code> si es par.
          </p>
          {fence('starter', STARTER)}
          {fence('test', CASES)}
          {fence('solution', SOLUTION)}
        </Exercise>
      ),
    },
    {
      title: 'No starter fence: the warning is for the author, not the student',
      code: `<Exercise title="Sin bloque starter">

Un ejercicio al que le falta el código inicial.

</Exercise>`,
      render: () => (
        <Exercise title="Sin bloque starter">
          <p>Un ejercicio al que le falta el código inicial.</p>
        </Exercise>
      ),
    },
  ],
};
