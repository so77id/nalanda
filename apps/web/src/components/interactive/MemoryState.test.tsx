import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TraceStep } from './trace';
import { MemoryState } from './MemoryState';

const aliased: TraceStep = {
  line: 4,
  frame: 'main',
  frames: [
    {
      name: 'main',
      variables: [
        { name: 'a', value: { kind: 'ref', id: 1 } },
        { name: 'b', value: { kind: 'ref', id: 1 } },
        { name: 'n', value: { kind: 'primitive', type: 'int', text: '7' } },
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
  ],
  truncated: null,
};

// Geometry is NOT asserted here: jsdom lays nothing out and reports every box as
// 0×0, so anything measured would be the fake rather than the drawing
// (apps/web/CLAUDE.md). `memoryLayout.test.ts` checks the arithmetic; the browser
// check at S7 confirms it looks right. What is testable here is the contract.

describe('MemoryState', () => {
  it('describes itself in Spanish for a reader who cannot see it', () => {
    render(<MemoryState step={aliased} />);

    const figure = screen.getByRole('img');
    expect(figure).toHaveAttribute(
      'aria-label',
      expect.stringContaining('apuntan al mismo objeto'),
    );
  });

  it('names every variable and the box they share', () => {
    render(<MemoryState step={aliased} />);

    expect(screen.getByText('a')).toBeInTheDocument();
    expect(screen.getByText('b')).toBeInTheDocument();
    expect(screen.getByText('Punto')).toBeInTheDocument();
  });

  it('draws one arrow per reference and none for a primitive', () => {
    const { container } = render(<MemoryState step={aliased} />);

    // Two refs to the same box, one int: two arrows, not three.
    expect(container.querySelectorAll('path[marker-end]')).toHaveLength(2);
  });

  it('gives each instance its own arrowhead, so two diagrams never share one', () => {
    const { container } = render(
      <>
        <MemoryState step={aliased} />
        <MemoryState step={aliased} />
      </>,
    );

    const markers = [...container.querySelectorAll('marker')].map((one) => one.id);
    expect(new Set(markers).size).toBe(2);
  });

  it('marks a box the step says changed', () => {
    const { container } = render(<MemoryState step={aliased} changed={[1]} />);

    expect(container.querySelector('rect.stroke-accent')).not.toBeNull();
  });
});
