import { javaLanguage } from '@codemirror/lang-java';
import type { Extension } from '@codemirror/state';

type ParserConfig = NonNullable<Parameters<typeof javaLanguage.configure>[0]>;
type ParseWrapper = NonNullable<ParserConfig['wrap']>;
type Tree = NonNullable<ReturnType<ReturnType<ParseWrapper>['advance']>>;

/** The same grammar entered at a class's body: what a method on its own is. */
const members = javaLanguage.parser.configure({ top: 'ClassContent' });

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
 * registry. Shaped as `java()`'s language support is — the language it
 * installs, under `language`, so the grammar knows its own name — without
 * a dependency on the package that declares the class.
 */
export function grammar(): Extension {
  return { language: javaListing, extension: javaListing } as Extension;
}
