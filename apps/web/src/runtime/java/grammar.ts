import { javaLanguage } from '@codemirror/lang-java';
import type { Extension } from '@codemirror/state';

type ParserConfig = NonNullable<Parameters<typeof javaLanguage.configure>[0]>;
type ParseWrapper = NonNullable<ParserConfig['wrap']>;
type Tree = NonNullable<ReturnType<ReturnType<ParseWrapper>['advance']>>;

/** The same grammar entered at a class's body: what a method on its own is. */
const members = javaLanguage.parser.configure({ top: 'ClassContent' });

/** Top-level nodes no class body can hold: a source with one is a whole program. */
const PROGRAM_ONLY = new Set(['ImportDeclaration', 'PackageDeclaration']);

function wholeProgram(tree: Tree): boolean {
  for (let child = tree.topNode.firstChild; child; child = child.nextSibling) {
    if (PROGRAM_ONLY.has(child.name)) return true;
  }
  return false;
}

function errorsIn(tree: Tree): number {
  let errors = 0;
  tree.iterate({
    enter: (node) => {
      if (node.type.isError) errors += 1;
    },
  });
  return errors;
}

/**
 * A course shows methods on their own, outside their class — the AVL's
 * rotations and `balance`, every listing of the search tree. Read as a
 * whole program they are errors, and the highlighter leaves an error black:
 * whole listings read black and white on a slide (#322). So a parse that
 * ends with errors is read again as the members of a class, and the reading
 * with fewer errors is the one highlighted. A whole program, or statements
 * on their own, still parse as a program with none, and keep that reading.
 *
 * The second reading is a whole parse of the document, and this grammar also
 * runs in the editors a student types in, where a parse ends with errors on
 * most keystrokes (#322 review: 34 of 50 keystrokes in the intersection
 * program, and the members reading won none). So it is skipped where it can
 * never win or must not run: a source that imports or declares a package is
 * a whole program, and a parse CodeMirror stopped short — at the viewport, or
 * at its time budget — is left as it is rather than re-read to the end.
 */
const eitherTop: ParseWrapper = (inner, input) => ({
  get parsedPos() {
    return inner.parsedPos;
  },
  get stoppedAt() {
    return inner.stoppedAt;
  },
  stopAt: (pos) => inner.stopAt(pos),
  advance: () => {
    const tree = inner.advance();
    if (tree === null) return null;
    if (tree.length < input.length || wholeProgram(tree)) return tree;
    const errors = errorsIn(tree);
    if (errors === 0) return tree;
    const asMembers = members.parse(input.read(0, input.length));
    return errorsIn(asMembers) < errors ? asMembers : tree;
  },
});

/** The Java language as listings use it: a program, or the members of a class. */
export const javaListing = javaLanguage.configure({ wrap: eitherTop });

/**
 * The Java CodeMirror grammar, in its own chunk. Why: `loadGrammar` in the
 * registry. Shaped as `java()`'s `LanguageSupport` is — the extension, and
 * the language under `language` — because the registry's test asks every
 * grammar its own name there: a swapped switch arm once highlighted every
 * Java listing as Python with the suite green (`registry.test.ts`). The
 * class itself lives in `@codemirror/language`, which is not a dependency of
 * this app, so the shape is written out, and the cast is what an object
 * literal with a key `Extension` does not declare costs (#322 review kept
 * it).
 */
export function grammar(): Extension {
  return { language: javaListing, extension: javaListing } as Extension;
}
