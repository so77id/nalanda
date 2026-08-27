import type { CatalogEntry } from '../../lib/catalogEntry';

import { MemoryVisual } from './MemoryVisual';
import type { MemoryState } from './memoryModel';

const ALIASING: MemoryState = {
  frames: [
    {
      name: 'main',
      variables: [
        { name: 'a', value: { kind: 'ref', id: 1 } },
        { name: 'b', value: { kind: 'ref', id: 1 } },
      ],
    },
  ],
  objects: [
    {
      id: 1,
      kind: 'object',
      type: 'Punto',
      fields: [
        { name: 'x', value: { kind: 'primitive', type: 'int', text: '99' } },
        { name: 'y', value: { kind: 'primitive', type: 'int', text: '2' } },
      ],
    },
  ],
};

const SWAP: MemoryState = {
  frames: [
    {
      name: 'main',
      variables: [
        { name: 'a', value: { kind: 'ref', id: 1 } },
        { name: 'b', value: { kind: 'ref', id: 2 } },
      ],
    },
    {
      name: 'swap',
      variables: [
        { name: 'x', value: { kind: 'ref', id: 2 } },
        { name: 'y', value: { kind: 'ref', id: 1 } },
      ],
    },
  ],
  objects: [
    {
      id: 1,
      kind: 'object',
      type: 'Punto',
      fields: [{ name: 'x', value: { kind: 'primitive', type: 'int', text: '1' } }],
    },
    {
      id: 2,
      kind: 'object',
      type: 'Punto',
      fields: [{ name: 'x', value: { kind: 'primitive', type: 'int', text: '3' } }],
    },
  ],
};

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const memoryVisualCatalogEntry: CatalogEntry = {
  name: 'MemoryVisual',
  family: 'interactive',
  description:
    'A drawing of variables, stack frames and heap objects, taken from AUTHOR-WRITTEN state passed as a prop — no runtime, no compile, no lazy chunk. Preserves the drawing convention of ADR-0028 (arrows on the right, cross-frame aliasing named in the description) while dropping the tracer that used to produce the state at load time.',
  whenToUse:
    'Whenever the lesson IS the shape of memory: aliasing, parameter passing, identity versus equality, and later linked lists and trees. Prose about references is nodded at and not understood; a drawing of two names on one box is not. ' +
    'Introduced in #209 as the reversal of ADR-0028. The predecessor widget compiled a Java class beside the snippet and ran it on mount; this one takes a `state` object and draws it, at a fraction of the load cost. ' +
    'Usually paired with <StepShow> so several photographs of the same program can be walked, with the code side highlighted — <MemoryVisual> is standalone and only draws one picture. ' +
    'The author is responsible for the picture being TRUE: no build gate or test can compare a hand-written state to the snippet beside it. That is the trade-off the superseding ADR records; the pedagogy the trace bought was more machinery than the volumes here needed.',
  props: [
    {
      name: 'state',
      type: 'MemoryState',
      description:
        'The picture: `{ frames, objects }`. A frame carries a name and a list of variables; a variable holds either a primitive, `null`, or a reference to an object id. Objects are boxes: an object (fields), a string (text), or an array (elements as fields indexed 0, 1, …).',
    },
    {
      name: 'changed',
      type: 'number[]',
      description:
        'Object ids to paint with a stronger border, so a reader following a walk sees what moved. Optional. Passed explicitly by the author on the specific <Step> where a box changes; there is no auto-diff between adjacent <Step>s today (ADR-0049 §Alternatives considered — deferred as future automation on top of the same prop).',
    },
  ],
  examples: [
    {
      title: 'Aliasing: two names for one box',
      code: `<MemoryVisual state={{
  frames: [{ name: 'main', variables: [
    { name: 'a', value: { kind: 'ref', id: 1 } },
    { name: 'b', value: { kind: 'ref', id: 1 } },
  ]}],
  objects: [{ id: 1, kind: 'object', type: 'Punto', fields: [
    { name: 'x', value: { kind: 'primitive', type: 'int', text: '99' } },
    { name: 'y', value: { kind: 'primitive', type: 'int', text: '2' } },
  ]}],
}} />`,
      render: () => <MemoryVisual state={ALIASING} />,
    },
    {
      title: 'Two frames on the stack — the swap that does not swap',
      code: `<MemoryVisual state={{
  frames: [
    { name: 'main', variables: [
      { name: 'a', value: { kind: 'ref', id: 1 } },
      { name: 'b', value: { kind: 'ref', id: 2 } },
    ]},
    { name: 'swap', variables: [
      { name: 'x', value: { kind: 'ref', id: 2 } },
      { name: 'y', value: { kind: 'ref', id: 1 } },
    ]},
  ],
  objects: [
    { id: 1, kind: 'object', type: 'Punto', fields: [
      { name: 'x', value: { kind: 'primitive', type: 'int', text: '1' } },
    ]},
    { id: 2, kind: 'object', type: 'Punto', fields: [
      { name: 'x', value: { kind: 'primitive', type: 'int', text: '3' } },
    ]},
  ],
}} />`,
      render: () => <MemoryVisual state={SWAP} />,
    },
  ],
};
