import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { SequenceStepper, type SequenceStepperProps } from './SequenceStepper';

/**
 * jsdom mocks CodeMirror and lays nothing out, so these cases assert the
 * CONTRACT — which frames exist, what the controls do, what the authoring
 * guards refuse and what the accessible name says. The paint itself (the SVG
 * over both themes, on a slide) is the browser check.
 */

const renderIn = (mode: 'book' | 'presentation', ui: React.ReactElement) =>
  render(<ModeProvider mode={mode}>{ui}</ModeProvider>);

const base = {
  eda: 'linked-list-singly' as const,
  operation: 'insert-first' as const,
  values: [7, 3, 1, 5],
  value: 9,
};

describe('<SequenceStepper> · authoring guards', () => {
  it('refuses a missing recipe and names the ones it knows', () => {
    renderIn('book', <SequenceStepper operation="search" values={[1]} target={1} />);
    expect(screen.getByText(/falta la prop/i)).toBeInTheDocument();
    expect(screen.getByText(/linked-list-singly/)).toBeInTheDocument();
  });

  it('refuses an unknown recipe', () => {
    renderIn(
      'book',
      <SequenceStepper eda="skip-list" operation="search" values={[1]} target={1} />,
    );
    expect(screen.getByText(/no es una receta conocida/i)).toBeInTheDocument();
  });

  it('refuses an unknown operation', () => {
    renderIn('book', <SequenceStepper eda="array" operation="rotar" values={[1]} />);
    expect(screen.getByText(/no es una operación conocida/i)).toBeInTheDocument();
  });

  it('refuses insert-ordered over an array, and says why', () => {
    renderIn(
      'book',
      <SequenceStepper eda="array" operation="insert-ordered" values={[1, 2]} target={3} />,
    );
    expect(screen.getByText(/no está definida sobre/i)).toBeInTheDocument();
  });

  it('refuses an index outside the structure', () => {
    renderIn(
      'book',
      <SequenceStepper eda="linked-list-singly" operation="remove-at" values={[1, 2]} index={9} />,
    );
    expect(screen.getByText(/fuera del rango/i)).toBeInTheDocument();
  });

  it('refuses an unsorted list for insert-ordered', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="insert-ordered"
        values={[5, 1, 9]}
        target={3}
      />,
    );
    expect(screen.getByText(/ordenada/i)).toBeInTheDocument();
  });

  it('passes descending through to the trace: a descending chain is accepted', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="insert-ordered"
        values={[9, 5, 1]}
        target={3}
        descending
      />,
    );
    expect(screen.queryByText(/ordenada/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('sequence-structure')).toBeInTheDocument();
  });

  it('refuses a heap operation over a sequence, and points at the heap recipe', () => {
    renderIn(
      'book',
      <SequenceStepper eda="linked-list-singly" operation="extract-max" values={[3, 1]} />,
    );
    expect(screen.getByText(/heap-max/)).toBeInTheDocument();
  });

  it('refuses a sequence operation over the heap, and names the four it has', () => {
    renderIn(
      'book',
      <SequenceStepper eda="heap-max" operation="insert-first" values={[3]} value={1} />,
    );
    expect(screen.getByText(/extraer el máximo/)).toBeInTheDocument();
    expect(screen.getByText(/heapsort/)).toBeInTheDocument();
  });

  it('refuses a starting array that is not a max-heap', () => {
    renderIn(
      'book',
      <SequenceStepper eda="heap-max" operation="insert" values={[1, 5]} value={2} />,
    );
    expect(screen.getByText(/no es un max-heap/)).toBeInTheDocument();
  });

  it('refuses more values than the picture can hold', () => {
    renderIn('book', <SequenceStepper {...base} values={[1, 2, 3, 4, 5, 6, 7, 8, 9]} />);
    expect(screen.getByText(/elementos/i)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the frames', () => {
  it('starts paused on the first step and does not autoplay by default', () => {
    renderIn('book', <SequenceStepper {...base} />);
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '0');
    expect(screen.getByRole('button', { name: /reproducir/i })).toBeInTheDocument();
  });

  it('walks forward and back through the trace', async () => {
    const user = userEvent.setup();
    renderIn('book', <SequenceStepper {...base} />);
    const figure = screen.getByRole('figure');

    await user.click(screen.getByRole('button', { name: /adelante/i }));
    expect(figure).toHaveAttribute('data-step', '1');
    await user.click(screen.getByRole('button', { name: /atrás/i }));
    expect(figure).toHaveAttribute('data-step', '0');
  });

  it('reset returns to the first frame', async () => {
    const user = userEvent.setup();
    renderIn('book', <SequenceStepper {...base} />);
    const figure = screen.getByRole('figure');
    await user.click(screen.getByRole('button', { name: /adelante/i }));
    await user.click(screen.getByRole('button', { name: /reiniciar/i }));
    expect(figure).toHaveAttribute('data-step', '0');
  });

  it('announces the structure in Spanish for a reader who cannot see the SVG', () => {
    renderIn('book', <SequenceStepper {...base} />);
    const picture = screen.getByTestId('sequence-structure');
    expect(picture.getAttribute('aria-label')).toMatch(/La cadena contiene 7, 3, 1, 5/);
  });

  it('narrates each step in a live region', () => {
    // Asked for by test id, not by the aria-live selector: jsdom's CodeMirror
    // mock renders a live region of its own, and it comes first in the DOM.
    renderIn('book', <SequenceStepper {...base} />);
    const live = screen.getByTestId('sequence-narration');
    expect(live).toHaveAttribute('aria-live', 'polite');
    expect(within(live).getByText(/Creamos el nodo 9/)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · per mode', () => {
  it.each(['book', 'presentation'] as const)('renders the widget in %s mode', (mode) => {
    renderIn(mode, <SequenceStepper {...base} />);
    const figure = screen.getByRole('figure');
    expect(figure).toHaveAttribute('data-mode', mode);
    expect(figure).toHaveAttribute('data-recipe', 'linked-list-singly');
    expect(figure).toHaveAttribute('data-operation', 'insert-first');
  });

  it('hides the code panel when the slide already carries the listing', () => {
    const { container } = renderIn('book', <SequenceStepper {...base} showCode={false} />);
    expect(container.textContent).not.toMatch(/código/);
    expect(screen.getByTestId('sequence-structure')).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the runtime identity trap', () => {
  // MDX re-mints `values` on every parent re-render. A memo or reset effect
  // keyed on the ARRAY would snap playback back to step 0 mid-run (#266).
  it('survives a parent re-render with a fresh array of the same content', async () => {
    const user = userEvent.setup();
    const { rerender } = renderIn('book', <SequenceStepper {...base} />);
    await user.click(screen.getByRole('button', { name: /adelante/i }));
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '1');

    rerender(
      <ModeProvider mode="book">
        <SequenceStepper {...base} values={[7, 3, 1, 5]} />
      </ModeProvider>,
    );
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '1');
  });

  it('does reset when the author actually changes the operation', async () => {
    const user = userEvent.setup();
    const { rerender } = renderIn('book', <SequenceStepper {...base} />);
    await user.click(screen.getByRole('button', { name: /adelante/i }));

    rerender(
      <ModeProvider mode="book">
        <SequenceStepper {...base} operation="search" target={1} />
      </ModeProvider>,
    );
    expect(screen.getByRole('figure')).toHaveAttribute('data-step', '0');
  });
});

describe('<SequenceStepper> · a chain that starts empty', () => {
  // The two slides that build a chain from nothing reach frames no other
  // slide does: no live cell at all, and — for the circular recipe — a ring
  // with nothing to close. Both draw from indices derived from the number of
  // LIVE cells, which is -1 when there are none.
  it('renders every frame of insertLast from empty without throwing', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="insert-last"
        values={[]}
        value={[5, 1, 3, 7]}
      />,
    );
    // fireEvent, not userEvent: 21 frames of pointer simulation take seconds,
    // and what is under test is the paint of each frame, not the click. The
    // button is re-queried every iteration — React replaces the node.
    // `aria-disabled`, not the native property: ControlButton stays focusable
    // at the end of a trace so a keyboard reader is not dropped out of the
    // control row.
    const forward = () => screen.getByRole('button', { name: 'Adelante' });
    let guard = 0;
    while (forward().getAttribute('aria-disabled') !== 'true' && guard < 60) {
      fireEvent.click(forward());
      guard += 1;
    }
    // 4 + 5 + 6 + 7 frames: one insertion more expensive than the last.
    expect(guard).toBe(21);
    expect(screen.getByTestId('sequence-structure')).toHaveAccessibleName(/5, 1, 3, 7/);
  });

  it('draws no closing ring while a circular chain has no nodes', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-circular"
        operation="insert-first"
        values={[]}
        value={[4, 2]}
      />,
    );
    expect(screen.queryByText('el último vuelve al primero')).not.toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the chrome', () => {
  it('offers the three playback speeds the other steppers of the unit offer', () => {
    renderIn('book', <SequenceStepper {...base} />);
    const speed = screen.getByLabelText('Velocidad de reproducción');
    expect([...speed.querySelectorAll('option')].map((o) => o.textContent)).toEqual([
      'lenta',
      'normal',
      'rápida',
    ]);
  });

  it('shows `size` and keeps it in step with the structure', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="insert-first"
        values={[7, 3]}
        value={9}
      />,
    );
    const size = screen.getByTestId('sequence-size');
    expect(size).toHaveTextContent(/size\s*2/);
    const forward = () => screen.getByRole('button', { name: 'Adelante' });
    while (forward().getAttribute('aria-disabled') !== 'true') fireEvent.click(forward());
    expect(size).toHaveTextContent(/size\s*3/);
  });

  // The counter came off in #294 (ADR-0074 §Amended by): a single run shows a
  // single number, which is not a growth rate, and seven of the eight slides
  // that mounted the widget never referred to it. The arithmetic it displayed
  // is still computed and still pinned — in `sequenceStepperTrace.test.ts`,
  // where a claim about cost can be checked exactly instead of read off a
  // painted box. This case is here so that putting it back is a decision.
  it('keeps the operation counter off the screen', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="get-at"
        values={[7, 3, 1, 5, 9]}
        index={4}
      />,
    );
    const box = screen.getByTestId('sequence-size');
    expect(box).toHaveTextContent(/size/i);
    expect(box).not.toHaveTextContent(/ops/i);
    const forward = () => screen.getByRole('button', { name: 'Adelante' });
    while (forward().getAttribute('aria-disabled') !== 'true') fireEvent.click(forward());
    expect(box).not.toHaveTextContent(/ops/i);
  });

  it('adds the capacity beside it for a block that reserves one', () => {
    renderIn(
      'book',
      <SequenceStepper eda="array" operation="insert-last" values={[7, 3]} value={9} />,
    );
    expect(screen.getByTestId('sequence-size')).toHaveTextContent('capacidad');
  });
});

describe('<SequenceStepper> · the combinations the documents mount', () => {
  // The narrowing of `isValidCombination` in the #288 review broke the
  // doubly+tail deleteLast slide, and the suite did not see it: the document
  // render test loads the widget lazily, so jsdom paints the fallback and
  // never reaches the guard. These mount the real component.
  it.each([
    ['linked-list-doubly', 'remove-last', true],
    ['linked-list-circular', 'insert-first', false],
    ['linked-list-singly', 'insert-ordered', false],
  ] as const)('accepts %s × %s (tail=%s)', (eda, operation, tail) => {
    renderIn(
      'book',
      <SequenceStepper
        eda={eda}
        operation={operation}
        values={operation === 'insert-ordered' ? [3, 7] : [7, 3, 1, 5]}
        value={9}
        target={5}
        tail={tail}
      />,
    );
    expect(screen.queryByText(/no está definida/i)).not.toBeInTheDocument();
    expect(screen.getByTestId('sequence-structure')).toBeInTheDocument();
  });

  // #294 mounts the widget over BOTH families for the first time: the Stack
  // and Queue class runs the same operations over an array and over a chain,
  // which is what the array recipes were carried for (ADR-0074
  // §Consequences). Each entry is a tag the document actually ships.
  // The act is part of the name because both acts mount some of the same
  // pairs with different arguments, and two cases called the same thing hide
  // which one broke.
  const mounted: { act: string; props: SequenceStepperProps }[] = [
    {
      act: 'Stack',
      props: {
        eda: 'dynamic-array',
        capacity: 4,
        operation: 'insert-last',
        values: [42, 7],
        value: [15, 4, 9, 23],
        pointer: 'top',
        showCode: false,
      },
    },
    {
      act: 'Stack',
      props: {
        eda: 'dynamic-array',
        capacity: 8,
        operation: 'remove-last',
        values: [42, 7, 15, 4, 9, 23],
        times: 3,
        pointer: 'top',
        showCode: false,
      },
    },
    {
      act: 'Stack',
      props: {
        eda: 'linked-list-singly',
        operation: 'insert-first',
        values: [],
        value: [42, 7, 15],
        method: 'push',
        receiver: 'pila',
        receiverType: 'Stack',
      },
    },
    {
      act: 'Stack',
      props: {
        eda: 'linked-list-singly',
        operation: 'remove-first',
        values: [15, 7, 42],
        times: 3,
        method: 'pop',
        receiver: 'pila',
        receiverType: 'Stack',
      },
    },
    // The Queue act. The other pair of ends, and the list side carries
    // `tail` — which is what makes its `enqueue` constant.
    {
      act: 'Queue',
      props: {
        eda: 'dynamic-array',
        capacity: 4,
        operation: 'insert-last',
        values: [3, 8],
        value: [5, 9, 4, 23],
        pointer: 'rear',
        showCode: false,
      },
    },
    {
      act: 'Queue',
      props: {
        eda: 'dynamic-array',
        capacity: 8,
        operation: 'remove-first',
        values: [3, 8, 5, 9, 4],
        times: 3,
        pointer: 'front',
        showCode: false,
      },
    },
    {
      act: 'Queue',
      props: {
        eda: 'linked-list-singly',
        operation: 'insert-last',
        values: [],
        value: [3, 8, 5],
        tail: true,
        method: 'enqueue',
        receiver: 'cola',
        receiverType: 'Queue',
      },
    },
    {
      act: 'Queue',
      props: {
        eda: 'linked-list-singly',
        operation: 'remove-first',
        values: [3, 8, 5],
        times: 3,
        tail: true,
        method: 'dequeue',
        receiver: 'cola',
        receiverType: 'Queue',
      },
    },
  ];

  it.each(mounted)('accepts $act · $props.eda × $props.operation', ({ props }) => {
    renderIn('book', <SequenceStepper {...props} />);
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
    expect(screen.getByTestId('sequence-structure')).toBeInTheDocument();
  });

  // The constraint that decided the shape of every array slide in #294's
  // first pass, and that the second pass lifted: the push slide needs four
  // pushes with the block filling on the third, which one run cannot show.
  // Still invisible to `app/contentRenders.test.tsx` (the widget is lazy
  // there), so the mount is pinned HERE or nowhere.
  it('runs an array recipe as many times as the slide asked', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="dynamic-array"
        capacity={4}
        operation="insert-last"
        values={[42, 7]}
        value={[15, 4, 9, 23]}
      />,
    );
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
    expect(screen.getByTestId('sequence-structure')).toBeInTheDocument();
  });

  it('refuses, in the author own words, a combination whose listing is not written', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-circular"
        operation="remove-at"
        values={[7, 3, 1]}
        index={1}
      />,
    );
    expect(screen.getByText(/no está definida/i)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the circular recipe', () => {
  const ring = () =>
    [...document.querySelectorAll('[data-testid="sequence-structure"] path')].find((el) =>
      (el.getAttribute('d') ?? '').includes('Q'),
    );

  it('re-anchors the closing link as the chain grows', () => {
    // It used to run from the last SLOT to slot 0, so on a chain that does
    // not fill the layout it left one node, arrived at an empty box, and
    // stayed there while the chain grew past it.
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-circular"
        operation="insert-first"
        values={[7, 3, 1]}
        value={[9, 4]}
      />,
    );
    const first = ring()?.getAttribute('d');
    expect(first).toBeDefined();
    const forward = () => screen.getByRole('button', { name: 'Adelante' });
    while (forward().getAttribute('aria-disabled') !== 'true') fireEvent.click(forward());
    expect(ring()?.getAttribute('d')).not.toBe(first);
  });

  it('draws no closing link over a chain with nothing in it', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-circular"
        operation="insert-first"
        values={[]}
        value={[4, 2]}
      />,
    );
    expect(ring()).toBeUndefined();
  });
});

describe('<SequenceStepper> · the heap recipe (#304)', () => {
  const heap = { eda: 'heap-max' as const, values: [12, 8, 10, 3, 7, 9] };

  it('draws the heap twice: as the tree and as the array', () => {
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    const tree = screen.getByTestId('heap-tree');
    const array = screen.getByTestId('heap-array');
    expect(tree.querySelectorAll('[data-k]')).toHaveLength(6);
    // data[0..6]: slot 0 included, and the block is exactly full.
    expect(array.querySelectorAll('[data-slot]')).toHaveLength(7);
  });

  it('marks data[0] as unused, in words', () => {
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    const slot0 = screen.getByTestId('heap-array').querySelector('[data-slot="0"]')!;
    expect(slot0.getAttribute('data-unused')).toBe('true');
    expect(within(screen.getByTestId('heap-array')).getByText('no se usa')).toBeInTheDocument();
  });

  it('stacks the two views in the book and sets them side by side on a slide', () => {
    const { unmount } = renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    expect(screen.getByTestId('heap-views').getAttribute('data-arrangement')).toBe('stacked');
    unmount();
    renderIn('presentation', <SequenceStepper {...heap} operation="extract-max" />);
    expect(screen.getByTestId('heap-views').getAttribute('data-arrangement')).toBe('side-by-side');
  });

  it('shows n, the listing field, and follows it as the heap shrinks', () => {
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    const readout = screen.getByTestId('sequence-size');
    expect(within(readout).getByText('n')).toBeInTheDocument();
    expect(within(readout).getByText('6')).toBeInTheDocument();
    for (let i = 0; i < 40; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
    expect(within(readout).getByText('5')).toBeInTheDocument();
    // The tree lost its last leaf; the array still holds the old maximum.
    expect(screen.getByTestId('heap-tree').querySelectorAll('[data-k]')).toHaveLength(5);
    const stale = screen.getByTestId('heap-array').querySelector('[data-slot="6"]')!;
    expect(stale.getAttribute('data-state')).toBe('stale');
  });

  it('paints the pair being swapped the same in the tree and in the array', () => {
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    const swapping = () =>
      [...screen.getByTestId('heap-tree').querySelectorAll('[data-state="swap"]')].map((n) =>
        n.getAttribute('data-k'),
      );
    for (let i = 0; i < 40 && swapping().length === 0; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    }
    const ks = swapping();
    expect(ks).toHaveLength(2);
    const slots = [...screen.getByTestId('heap-array').querySelectorAll('[data-state="swap"]')].map(
      (n) => n.getAttribute('data-slot'),
    );
    expect(slots).toEqual(ks);
  });

  it('ends heapsort with every array cell sorted', () => {
    renderIn(
      'book',
      <SequenceStepper eda="heap-max" operation="heapsort" values={[5, 2, 9, 1, 7]} />,
    );
    for (let i = 0; i < 200; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
    const cells = [...screen.getByTestId('heap-array').querySelectorAll('[data-state]')];
    expect(cells).toHaveLength(5);
    expect(cells.every((c) => c.getAttribute('data-state') === 'sorted')).toBe(true);
  });

  it('describes both views for a reader who cannot see them', () => {
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    const label = screen.getByTestId('heap-views').getAttribute('aria-label')!;
    expect(label).toMatch(/heap/i);
    expect(label).toContain('12, 8, 10, 3, 7, 9');
  });

  it('names the heap in the chip and the operation in the heading', () => {
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    expect(screen.getByText(/heap \(máximo\)/)).toBeInTheDocument();
    expect(screen.getByText('extraer el máximo')).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the combinations 20-edd-priority-queue-heap mounts', () => {
  // Pinned here because `app/contentRenders.test.tsx` never mounts the lazy
  // widget (apps/web/CLAUDE.md §2, class 4). Named for the act they come
  // from, and each one WALKED to its last frame, not only mounted: a frame
  // that throws or refuses halfway is invisible to a mount.
  const mounted: { act: string; slide: string; props: SequenceStepperProps }[] = [
    {
      act: 'Dos implementaciones ingenuas',
      slide: 'Cinco inserciones en la lista sin orden',
      props: {
        eda: 'linked-list-singly',
        operation: 'insert-first',
        values: [],
        value: [8, 3, 10, 1, 7],
      },
    },
    {
      act: 'Dos implementaciones ingenuas',
      slide: 'Cinco inserciones en la lista ordenada',
      props: {
        eda: 'linked-list-singly',
        operation: 'insert-ordered',
        values: [],
        target: [8, 3, 10, 1, 7],
        descending: true,
        method: 'insert',
        receiver: 'pq',
        receiverType: 'OrderedPQ',
      },
    },
    {
      act: 'El heap binario',
      slide: 'Una inserción en las dos vistas',
      props: {
        eda: 'heap-max',
        operation: 'insert',
        values: [10, 7, 8, 1, 3],
        value: 9,
        capacity: 8,
        showCode: false,
      },
    },
  ];

  it.each(mounted)('$act · $slide', ({ props }) => {
    renderIn('book', <SequenceStepper {...props} />);
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
    for (let i = 0; i < 400; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
    // aria-disabled, never native `disabled` (stepperShell's ControlButton).
    expect(screen.getByRole('button', { name: 'Adelante' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
  });
});
