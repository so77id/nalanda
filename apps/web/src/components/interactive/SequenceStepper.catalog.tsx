import type { CatalogEntry } from '../../lib/catalogEntry';

import { LazySequenceStepper as SequenceStepper } from './lazySequenceStepper';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const sequenceStepperCatalogEntry: CatalogEntry = {
  name: 'SequenceStepper',
  family: 'interactive',
  description:
    'One step-through widget for the whole Sequence family. `eda` picks the structure it draws — array, dynamic array, or a singly / doubly / circular linked list — and `operation` picks the animation it replays over it. Code panel on top, the structure as a hand-written SVG below, narration and controls at the foot; the surface is identical across all combinations, so the reader learns one visual vocabulary and reads every structure of the unit through it. ADR-0074.',
  whenToUse:
    'When a class of the Estructuras de Datos unit shows an operation running over a sequence structure — and especially when it shows the SAME operation over two structures to contrast their cost, which is two nearly identical tags. Not for sorting algorithms (`<SortStepper>`) and not for hand-authored memory pictures (`<StepShow>` + `<MemoryVisual>`).',
  props: [
    {
      name: 'eda',
      type: '"array" | "dynamic-array" | "linked-list-singly" | "linked-list-doubly" | "linked-list-circular"',
      description:
        'Required. The recipe: which structure is drawn, and which Java listing is shown beside it.',
    },
    {
      name: 'operation',
      type: '"get-at" | "insert-first" | "insert-last" | "insert-at" | "insert-ordered" | "remove-first" | "remove-last" | "remove-at" | "search"',
      description:
        'Required. Which operation to animate. `insert-ordered` is defined on the list recipes only — the ordered array is not a structure this unit presents — and any other pair is valid.',
    },
    {
      name: 'values',
      type: 'number[]',
      description:
        'Required. The starting contents in reading order. Up to 8; beyond that the nodes stop being legible when projected. May be empty for the two insert operations that do not need an existing element.',
    },
    {
      name: 'value',
      type: 'number | number[]',
      description:
        'The value inserted. Required by `insert-first`, `insert-last` and `insert-at`. An ARRAY inserts each value in turn over the same chain, so a slide can show the list growing — `value={[9, 4, 6]}` runs three insertions end to end.',
    },
    {
      name: 'index',
      type: 'number',
      description:
        'The position acted on. Required by `get-at`, `insert-at` (range `[0, values.length]`) and `remove-at` (range `[0, values.length - 1]`). An index outside the structure is an authoring error.',
    },
    {
      name: 'target',
      type: 'number',
      description:
        'The value looked for. Required by `search` and by `insert-ordered`, which also refuses a starting list that is not already sorted.',
    },
    {
      name: 'tail',
      type: 'boolean',
      description:
        'List recipes only. Draws a `tail` pointer and lets the operations use it: `insert-last` drops to constant cost, and `remove-last` deliberately does NOT — on a singly linked list the missing piece is the PREVIOUS node, which no tail supplies. Default `false`.',
    },
    {
      name: 'autoplay',
      type: 'boolean',
      description: 'Autoplay on mount. Off by default (rule Peli 1/2 — the reader decides when).',
    },
    {
      name: 'speed',
      type: '"slow" | "normal" | "fast"',
      description:
        'Delay between automatic steps. Does not change the number of steps. Default `normal`.',
    },
    {
      name: 'showCode',
      type: 'boolean',
      description:
        'Show the Java listing panel. Set it false when the slide already carries the code. Default `true`.',
    },
    {
      name: 'title',
      type: 'string',
      description:
        'Overrides the widget heading, which otherwise names the operation and the structure.',
    },
  ],
  examples: [
    {
      title: 'insertFirst on a singly linked list — the constant-time insertion',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-first" values={[7, 3, 1, 5]} value={9} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-first"
          values={[7, 3, 1, 5]}
          value={9}
        />
      ),
    },
    {
      title: 'Three insertions in a row — the chain growing',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-first" values={[7, 3]} value={[9, 4, 6]} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-first"
          values={[7, 3]}
          value={[9, 4, 6]}
        />
      ),
    },
    {
      title: 'The same insertion on an array — every element shifts',
      code: '<SequenceStepper eda="array" operation="insert-first" values={[7, 3, 1, 5]} value={9} />',
      render: () => (
        <SequenceStepper eda="array" operation="insert-first" values={[7, 3, 1, 5]} value={9} />
      ),
    },
    {
      title: 'insertLast with a tail pointer — no walk at all',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-last" values={[7, 3, 1]} value={9} tail />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-last"
          values={[7, 3, 1]}
          value={9}
          tail
        />
      ),
    },
    {
      title: 'A doubly linked list deleting its last node in constant time',
      code: '<SequenceStepper eda="linked-list-doubly" operation="remove-last" values={[7, 3, 1, 5]} tail />',
      render: () => (
        <SequenceStepper
          eda="linked-list-doubly"
          operation="remove-last"
          values={[7, 3, 1, 5]}
          tail
        />
      ),
    },
    {
      title: 'A circular list, where the last node points back at the first',
      code: '<SequenceStepper eda="linked-list-circular" operation="insert-first" values={[7, 3, 1]} value={9} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-circular"
          operation="insert-first"
          values={[7, 3, 1]}
          value={9}
        />
      ),
    },
    {
      title: 'getAt on a chain — one frame per hop, none skipped',
      code: '<SequenceStepper eda="linked-list-singly" operation="get-at" values={[7, 3, 1, 5]} index={2} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="get-at"
          values={[7, 3, 1, 5]}
          index={2}
        />
      ),
    },
    {
      title: 'The same getAt on an array — one calculation, whatever the position',
      code: '<SequenceStepper eda="array" operation="get-at" values={[7, 3, 1, 5]} index={2} />',
      render: () => (
        <SequenceStepper eda="array" operation="get-at" values={[7, 3, 1, 5]} index={2} />
      ),
    },
    {
      title: 'Searching a chain, which has no address arithmetic to shortcut with',
      code: '<SequenceStepper eda="linked-list-singly" operation="search" values={[7, 3, 1, 5]} target={1} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="search"
          values={[7, 3, 1, 5]}
          target={1}
        />
      ),
    },
  ],
};
