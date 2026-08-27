import type { CatalogEntry } from '../../lib/catalogEntry';

import { RecursionTree } from './RecursionTree';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const recursionTreeCatalogEntry: CatalogEntry = {
  name: 'RecursionTree',
  family: 'interactive',
  description:
    'A drawing of a recursive call that opens one click at a time. The root sits alone at first; a click on any interior node reveals its subcalls, a second click hides them again. Nodes with the same argument share a colour (fib, factorial), so the DUPLICATION that makes recursive Fibonacci slow becomes visible as the reader expands. The `hanoi` recipe uses uniform coloring instead — every call has distinct arguments, and the uniform paint carries the pedagogical signal that no two subproblems repeat (ADR-0051).',
  whenToUse:
    'For a recursive pattern where the shape of the call tree is what the section is teaching — the Fibonacci case study, or the Torres de Hanoi counter-example where the tree without repetitions shows why memoization does not help. ' +
    'NOT for tracing a single execution to teach how it works — a linear recursion (factorial(4)) reads better in prose than as a click-through, and this component is not designed to replace that. Its power is showing REPETITION (or the lack of it). ' +
    'Three recipes today: `fib`, `factorial`, and `hanoi` (with the four-tower arguments `hanoi(n, from → to)`). Adding a recipe is a code change (RECIPES in the source), by design: MDX props do not carry lambdas well. ' +
    'Capped at 300 nodes: fib(15) is 1973, fib(20) is 21891, and hanoi(8) is 511. The pedagogical range (fib(5), hanoi(3)) fits comfortably inside the cap.',
  props: [
    {
      name: 'recipe',
      type: '"fib" | "factorial" | "hanoi"',
      description: 'Which recursion pattern to draw. Adding one is a code change.',
    },
    {
      name: 'arg',
      type: 'number',
      description:
        'Non-negative integer, the argument to the root call. For `hanoi`, this is the number of disks; the widget uses towers A, C, B internally.',
    },
    {
      name: 'title',
      type: 'string',
      description: 'Heading shown in the header. Optional; typically `fib(5)` or `hanoi(3)`.',
    },
  ],
  examples: [
    {
      title: 'fib(5) — the case study, colour-shared duplicates',
      code: `<RecursionTree recipe="fib" arg={5} title="fib(5)" />`,
      render: () => <RecursionTree recipe="fib" arg={5} title="fib(5)" />,
    },
    {
      title: 'factorial(4) — linear, no repetition',
      code: `<RecursionTree recipe="factorial" arg={4} title="factorial(4)" />`,
      render: () => <RecursionTree recipe="factorial" arg={4} title="factorial(4)" />,
    },
    {
      title: 'hanoi(3) — every node distinct, uniform coloring for the counter-example',
      code: `<RecursionTree recipe="hanoi" arg={3} title="hanoi(3)" />`,
      render: () => <RecursionTree recipe="hanoi" arg={3} title="hanoi(3)" />,
    },
  ],
};
