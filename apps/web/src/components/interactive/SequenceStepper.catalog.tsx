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
        'Required. Which operation to animate. `array`, `dynamic-array` and `linked-list-singly` accept all nine (bar `insert-ordered` on the two arrays — the ordered array is not a structure this unit presents). The two VARIANT recipes accept only the operations they have a Java listing FOR, because the widget shows code a student may copy: `linked-list-circular` accepts `insert-first` alone — its listing closes the ring again, and walks to do it — and `linked-list-doubly` accepts `get-at`, `search`, `insert-first`, `remove-first`, and `remove-last` only with `tail`. Anything else renders an `<AuthoringError>` naming the operations that recipe does have.',
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
        'The value inserted. Required by `insert-first`, `insert-last` and `insert-at`. An ARRAY inserts each value in turn over the same chain, so a slide can show the list growing — `value={[9, 4, 6]}` runs three insertions end to end. `insert-first` and `insert-last` also accept `values={[]}`: a chain built from nothing shows the empty-chain branch taken once and, at the back, the walk getting one hop longer every time. `insert-at` needs one `index` per value.',
    },
    {
      name: 'index',
      type: 'number | number[]',
      description:
        'The position acted on. Required by `get-at`, `insert-at` (range `[0, size]`) and `remove-at` (range `[0, size - 1]`). An index outside the structure is an authoring error, checked against the chain as it is BY THEN — three insertions in a row move every position after the first. An ARRAY runs the operation once per index, which is how a slide shows a cost that depends on WHERE.',
    },
    {
      name: 'target',
      type: 'number | number[]',
      description:
        'The value looked for. Required by `search` and by `insert-ordered`, which also refuses a starting list that is not already sorted. An ARRAY searches each in turn — the hit at the front, the hit at the back and the value that is not there, in one widget.',
    },
    {
      name: 'times',
      type: 'number',
      description:
        'How many times to run an operation that takes no argument (`remove-first`, `remove-last`). Default one. Running more times than the structure has elements is an authoring error: the listing throws there, and a trace that ran anyway would be animating an exception.',
    },
    {
      name: 'capacity',
      type: 'number',
      description:
        'The two ARRAY recipes only — the block reserved, drawn as free slots past the live elements. On `array` it is the fixed capacity, and one too small for `values` is refused at boot. On `dynamic-array` it is where the resize falls: the default starts the block FULL so that a single insertion shows the growth, and a slide running several insertions passes a larger one to choose WHICH of them pays for it. The drawing shows the block the current frame has, so filling and doubling happen on screen.',
    },
    {
      name: 'pointer',
      type: 'string',
      description:
        "The two ARRAY recipes only — a named arrow kept on every frame, aimed at the end the operation works on: the last live slot for the `*-last` operations, the first for the rest, and at nothing when the block is empty. `top` for a stack, `front` or `rear` for a queue. The `i` / `j` cursors belong to the OPERATION and vanish between runs; this one is the structure's own field, and naming it stands them down — `i` would land on the same cell and say the same thing with a second arrow.",
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
      title: 'A chain built from nothing, at the back — the walk gets longer',
      code: '<SequenceStepper eda="linked-list-singly" operation="insert-last" values={[]} value={[5, 1, 3, 7]} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="insert-last"
          values={[]}
          value={[5, 1, 3, 7]}
        />
      ),
    },
    {
      title: 'One operation, three positions — the cost is the position',
      code: '<SequenceStepper eda="linked-list-singly" operation="get-at" values={[7, 3, 1, 5, 9, 2, 8]} index={[0, 3, 6]} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="get-at"
          values={[7, 3, 1, 5, 9, 2, 8]}
          index={[0, 3, 6]}
        />
      ),
    },
    {
      title: 'deleteFirst three times — the chain shrinks, the cost does not',
      code: '<SequenceStepper eda="linked-list-singly" operation="remove-first" values={[7, 3, 1, 5]} times={3} />',
      render: () => (
        <SequenceStepper
          eda="linked-list-singly"
          operation="remove-first"
          values={[7, 3, 1, 5]}
          times={3}
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
      title: 'A dynamic array filling up and doubling, with `top` kept on screen',
      code: '<SequenceStepper eda="dynamic-array" capacity={4} operation="insert-last" values={[42, 7]} value={[15, 4, 9, 23]} pointer="top" />',
      render: () => (
        <SequenceStepper
          eda="dynamic-array"
          capacity={4}
          operation="insert-last"
          values={[42, 7]}
          value={[15, 4, 9, 23]}
          pointer="top"
        />
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
