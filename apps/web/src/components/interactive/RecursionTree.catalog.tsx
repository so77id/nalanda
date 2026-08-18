import type { CatalogEntry } from '../../lib/catalogEntry';

import { RecursionTree } from './RecursionTree';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const recursionTreeCatalogEntry: CatalogEntry = {
  name: 'RecursionTree',
  family: 'interactive',
  description:
    'A drawing of a recursive call that opens one click at a time. The root sits alone at first; a click on any interior node reveals its subcalls, a second click hides them again. Nodes with the same argument share a colour, so the DUPLICATION that makes recursive Fibonacci slow becomes visible as the reader expands — rather than asserted in the prose.',
  whenToUse:
    'For a recursive pattern where the shape of the call tree is what the section is teaching — the case study of §8 in "Arrays y funciones", where three implementations of Fibonacci run beside it and the tree explains why the recursive one loses. ' +
    'NOT for tracing a single execution to teach how it works — a linear recursion (factorial(4)) reads better in prose than as a click-through, and this component is not designed to replace that. Its power is showing REPETITION. ' +
    'Two recipes today: `fib` (n < 2 → base; else recurses into n-1 and n-2) and `factorial` (n ≤ 1 → base; else n-1). Adding a recipe is a code change (RECIPES in the source), by design: MDX props do not carry lambdas well, and every use in the course sits at one of these two shapes. ' +
    'Capped at 300 nodes: fib(15) is 1973, fib(20) is 21891, and a reader would not click through them. fib(5) is the pedagogical example (33 nodes) and reaches all six hues the palette cycles through.',
  props: [
    {
      name: 'recipe',
      type: '"fib" | "factorial"',
      description: 'Which recursion pattern to draw. Adding one is a code change.',
    },
    {
      name: 'arg',
      type: 'number',
      description: 'Non-negative integer, the argument to the root call.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Heading shown in the header. Optional; typically `fib(5)`.',
    },
  ],
  examples: [
    {
      title: 'fib(5) — the case study',
      code: `<RecursionTree recipe="fib" arg={5} title="fib(5)" />`,
      render: () => <RecursionTree recipe="fib" arg={5} title="fib(5)" />,
    },
    {
      title: 'factorial(4) — linear, no repetition',
      code: `<RecursionTree recipe="factorial" arg={4} title="factorial(4)" />`,
      render: () => <RecursionTree recipe="factorial" arg={4} title="factorial(4)" />,
    },
  ],
};
