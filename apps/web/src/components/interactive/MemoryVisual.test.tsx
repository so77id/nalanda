import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
    { id: 1, kind: 'object', type: 'Punto', fields: [] },
    { id: 2, kind: 'object', type: 'Punto', fields: [] },
  ],
};

describe('MemoryVisual', () => {
  it('draws two variables sharing one box as one arrow-target from each name', () => {
    const { container } = render(<MemoryVisual state={ALIASING} />);
    // Every reference draws one arrow — two variables to one id → two arrows.
    const arrows = container.querySelectorAll('path[marker-end]');
    expect(arrows).toHaveLength(2);
    // One object box on the heap side.
    const svg = container.querySelector('svg');
    expect(svg?.getAttribute('role')).toBe('img');
  });

  it('describes cross-frame aliasing explicitly in the accessible name', () => {
    const { container } = render(<MemoryVisual state={SWAP} />);
    const label = container.querySelector('svg')?.getAttribute('aria-label') ?? '';
    // Aliasing across frames is named — that is the whole lesson of the swap
    // example (memoryLayout.describeStep records the amendment).
    expect(label).toMatch(/apuntan al mismo objeto/i);
    expect(label).toMatch(/main\.a/);
    expect(label).toMatch(/swap\.y/);
  });

  it('paints the changed set with a stronger stroke', () => {
    // A hint <StepShow> may derive from adjacent steps: which boxes changed.
    // The suite pins the ATTRIBUTE, not the rendered stroke (a colour jsdom
    // never paints — same shape as RecursionTree's `data-arg` earned in #78).
    const { container } = render(<MemoryVisual state={ALIASING} changed={[1]} />);
    // The outer rect of an object box carries `stroke-accent` when changed,
    // `stroke-rule-strong` otherwise. Assert via className (the visible-state
    // attribute here is `class`; the paint itself is the browser check).
    const objectRects = [...container.querySelectorAll('rect')].filter((r) =>
      (r.getAttribute('class') ?? '').includes('stroke-accent'),
    );
    expect(objectRects.length).toBeGreaterThan(0);
  });

  it('renders the empty state (nothing to show yet) as an accessible sentence', () => {
    const { container } = render(<MemoryVisual state={{ frames: [], objects: [] }} />);
    const label = container.querySelector('svg')?.getAttribute('aria-label');
    expect(label).toMatch(/todavía no hay nada/i);
  });

  it('takes state directly and does not touch the runtime', () => {
    // The whole point of #209: no runtime seam, no lazy chunk. A component
    // whose only inputs are its props and pure `memoryLayout` code cannot
    // pull in a Java compiler. Guarded structurally by the architecture
    // test (no static import of runtime seam from this file), and pinned
    // here by rendering with a synchronous `render` (no Suspense boundary).
    const { container } = render(<MemoryVisual state={ALIASING} />);
    expect(container.querySelector('svg')).not.toBeNull();
  });

  it('refuses a state that reuses an object id (authoring mistake)', () => {
    // The tracer used to enforce id uniqueness by construction (identityHashMap);
    // a hand-written state can accidentally reuse an id and silently draw two
    // boxes as one. ADR-0043 §Decision-7 makes the author responsible for the
    // picture being TRUE, but a cheap preflight is worth naming the mistake.
    const state: MemoryState = {
      frames: [],
      objects: [
        { id: 1, kind: 'object', type: 'Punto', fields: [] },
        { id: 1, kind: 'object', type: 'Punto', fields: [] },
      ],
    };
    render(<MemoryVisual state={state} />);
    const banner = document.querySelector('[data-authoring-error]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/id 1/);
  });

  it('refuses a state whose reference points at a missing object', () => {
    const state: MemoryState = {
      frames: [
        {
          name: 'main',
          variables: [{ name: 'a', value: { kind: 'ref', id: 99 } }],
        },
      ],
      objects: [],
    };
    render(<MemoryVisual state={state} />);
    const banner = document.querySelector('[data-authoring-error]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/main\.a/);
    expect(banner!.textContent).toMatch(/id 99/);
  });

  it('refuses a field whose reference points at a missing object', () => {
    const state: MemoryState = {
      frames: [],
      objects: [
        {
          id: 1,
          kind: 'object',
          type: 'Nodo',
          fields: [{ name: 'next', value: { kind: 'ref', id: 42 } }],
        },
      ],
    };
    render(<MemoryVisual state={state} />);
    const banner = document.querySelector('[data-authoring-error]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/next/);
    expect(banner!.textContent).toMatch(/id 42/);
  });

  it('draws a String as its text, not its char[]', () => {
    // Preserved from the tracer era so `new String("hola") == new String("hola")`
    // reads as two boxes both with `"hola"` — merging them into one char array
    // would refute the lesson the diagram exists to teach.
    const state: MemoryState = {
      frames: [
        {
          name: 'main',
          variables: [
            { name: 'a', value: { kind: 'ref', id: 1 } },
            { name: 'b', value: { kind: 'ref', id: 2 } },
          ],
        },
      ],
      objects: [
        { id: 1, kind: 'string', type: 'String', text: 'hola', fields: [] },
        { id: 2, kind: 'string', type: 'String', text: 'hola', fields: [] },
      ],
    };
    const { container } = render(<MemoryVisual state={state} />);
    const texts = [...container.querySelectorAll('text')].map((t) => t.textContent);
    expect(texts.filter((t) => t?.includes('"hola"'))).toHaveLength(2);
  });
});
