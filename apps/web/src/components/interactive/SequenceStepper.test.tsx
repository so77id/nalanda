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
    renderIn('book', <SequenceStepper eda="dynamic-array" operation="rotar" values={[1]} />);
    expect(screen.getByText(/no es una operación conocida/i)).toBeInTheDocument();
  });

  it('refuses insert-ordered over an array, and says why', () => {
    renderIn(
      'book',
      <SequenceStepper eda="dynamic-array" operation="insert-ordered" values={[1, 2]} target={3} />,
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

  it('refuses a heap operation over a sequence, and points at the heap recipe', () => {
    renderIn(
      'book',
      <SequenceStepper eda="linked-list-singly" operation="extract-max" values={[3, 1]} />,
    );
    expect(screen.getByText(/heap-max/)).toBeInTheDocument();
  });

  it('refuses a sequence operation over the heap, and names the two it has', () => {
    renderIn(
      'book',
      <SequenceStepper eda="heap-max" operation="insert-first" values={[3]} value={1} />,
    );
    expect(screen.getByText(/extraer el máximo/)).toBeInTheDocument();
    expect(screen.getByText(/insertar/)).toBeInTheDocument();
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

  it('keeps the narration as tall as its longest frame on a slide, hidden from readers', () => {
    // A slide is scaled to fit: a narration one line longer on one frame
    // rescaled the whole slide when the reader stepped onto it (#322).
    renderIn('presentation', <SequenceStepper {...base} />);
    const live = screen.getByTestId('sequence-narration');
    const reserved = live.querySelectorAll('[data-narration-reserve]');
    expect(reserved.length).toBeGreaterThan(1);
    for (const r of reserved) {
      expect(r).toHaveAttribute('aria-hidden', 'true');
      expect(r).toHaveClass('invisible');
    }
    expect(within(live).getAllByText(/Creamos el nodo 9/)).toHaveLength(2);
  });

  it('reserves nothing in the book, where nothing is scaled', () => {
    renderIn('book', <SequenceStepper {...base} />);
    const live = screen.getByTestId('sequence-narration');
    expect(live.querySelectorAll('[data-narration-reserve]')).toHaveLength(0);
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
      <SequenceStepper eda="dynamic-array" operation="insert-last" values={[7, 3]} value={9} />,
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
  // and Queue class runs the same operations over an array and over a chain.
  // Each entry is a tag the document actually ships.
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
  it('runs the dynamic array as many times as the slide asked', () => {
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

  it('writes a cursor under the slot it names, counted from data[1]', () => {
    // The first frame of extractMax points k at the root: data[1], not data[0].
    renderIn('book', <SequenceStepper {...heap} operation="extract-max" />);
    const array = screen.getByTestId('heap-array');
    expect(array.querySelector('[data-slot="1"]')!.textContent).toContain('↑k');
    expect(array.querySelector('[data-slot="0"]')!.textContent).not.toContain('↑k');
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
      act: 'Las operaciones del heap',
      slide: 'insert paso a paso',
      props: { eda: 'heap-max', operation: 'insert', values: [10, 7, 8, 1, 3, 2, 4], value: 9 },
    },
    {
      act: 'Las operaciones del heap',
      slide: 'Una seguidilla de inserciones',
      props: { eda: 'heap-max', operation: 'insert', values: [], value: [1, 7, 2, 3, 8, 4, 10] },
    },
    {
      act: 'Las operaciones del heap',
      slide: 'extractMax paso a paso',
      props: {
        eda: 'heap-max',
        operation: 'extract-max',
        values: [10, 9, 8, 7, 3, 2, 4, 1],
        capacity: 16,
      },
    },
    {
      act: 'Las operaciones del heap',
      slide: 'Una seguidilla de extracciones',
      props: {
        eda: 'heap-max',
        operation: 'extract-max',
        values: [10, 9, 8, 7, 3, 2, 4, 1],
        capacity: 16,
        times: 8,
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

describe('<SequenceStepper> · the binary-tree recipe (#321)', () => {
  const tree = { eda: 'binary-tree' as const, values: [3, 9, 1, 4, 7, null, 6] };
  const walkToEnd = () => {
    for (let i = 0; i < 60; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
  };

  it('draws one node per value, and no node for a gap', () => {
    renderIn('book', <SequenceStepper {...tree} operation="inorder" />);
    expect(screen.getByTestId('tree-view').querySelectorAll('[data-node]')).toHaveLength(6);
  });

  it('puts each node in the column of its inorder position', () => {
    renderIn('book', <SequenceStepper {...tree} operation="inorder" />);
    const columnOf = (value: number) =>
      screen
        .getByTestId('tree-view')
        .querySelector(`[data-node][data-value="${value}"]`)!
        .getAttribute('data-column');
    expect([4, 9, 7, 3, 1, 6].map(columnOf)).toEqual(['0', '1', '2', '3', '4', '5']);
  });

  it('fills the strip with the traversal, slot by slot', () => {
    renderIn('book', <SequenceStepper {...tree} operation="postorder" />);
    const strip = () =>
      [...screen.getByTestId('tree-view').querySelectorAll('[data-slot]')].map(
        (s) => s.getAttribute('data-value') ?? '',
      );
    expect(strip()).toEqual(['', '', '', '', '', '']);
    walkToEnd();
    expect(strip()).toEqual(['4', '7', '9', '6', '1', '3']);
  });

  it('draws the empty subtree a call lands on, and only while that call runs', () => {
    renderIn('book', <SequenceStepper eda="binary-tree" operation="preorder" values={[2, 1, 3]} />);
    const probes = () => screen.getByTestId('tree-view').querySelectorAll('[data-probe]');
    expect(probes()).toHaveLength(0);
    // The start, the visit to 2, its call to 1, the visit to 1 — then 1 calls
    // its left side, which is empty.
    for (let i = 0; i < 4; i += 1)
      fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    expect(probes()).toHaveLength(1);
    expect(probes()[0]!.getAttribute('data-probe')).toBe('left');
    fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    expect(probes()[0]!.getAttribute('data-probe')).toBe('right');
    fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    expect(probes()).toHaveLength(0);
  });

  it('counts the cap on nodes, not on the gaps between them', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="binary-tree"
        operation="preorder"
        values={[1, 2, 3, null, null, 4, 5, null, null, 6, 7, 8]}
      />,
    );
    expect(screen.getByTestId('tree-view')).toBeInTheDocument();
  });

  it('refuses a level order that hangs a value under a missing node', () => {
    renderIn(
      'book',
      <SequenceStepper eda="binary-tree" operation="inorder" values={[3, null, null, 5]} />,
    );
    expect(screen.getByText(/padre/)).toBeInTheDocument();
  });

  it('refuses a gap on any recipe that is not a tree', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-singly"
        operation="search"
        values={[1, null, 2]}
        target={1}
      />,
    );
    expect(screen.getByText(/solo binary-tree/)).toBeInTheDocument();
  });

  it('answers a search asked of a ring with what the ring has, not with the tree', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="linked-list-circular"
        operation="search"
        values={[7, 3, 1]}
        target={3}
      />,
    );
    expect(screen.getByText(/hay listado para: insertar al principio/)).toBeInTheDocument();
    expect(screen.queryByText(/operación de árbol/)).not.toBeInTheDocument();
  });

  it('points a traversal asked of a sequence at the tree recipe', () => {
    renderIn(
      'book',
      <SequenceStepper eda="linked-list-singly" operation="preorder" values={[7, 3, 1]} />,
    );
    expect(screen.getByText(/Úsala con eda="binary-tree"/)).toBeInTheDocument();
  });

  it('refuses a value that is neither a number, a symbol nor a gap', () => {
    // An object would reach the picture as a React child and take the page
    // down; NaN, Infinity and undefined would turn into gaps on the way
    // through the JSON key and change the tree's shape without a word.
    for (const bad of [{}, Number.NaN, Number.POSITIVE_INFINITY, undefined]) {
      const { unmount } = renderIn(
        'book',
        <SequenceStepper eda="binary-tree" operation="preorder" values={[1, bad as never, 2]} />,
      );
      expect(screen.getByText(/values\[1\]/)).toBeInTheDocument();
      unmount();
    }
  });

  it('refuses a values that is not a list at all', () => {
    renderIn(
      'book',
      <SequenceStepper eda="binary-tree" operation="preorder" values={5 as never} />,
    );
    expect(document.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('counts a tree of one node in the singular', () => {
    renderIn('book', <SequenceStepper eda="binary-tree" operation="preorder" values={[7]} />);
    expect(screen.getByTestId('tree-view').getAttribute('aria-label')).not.toMatch(/\b1 nodos\b/);
  });

  it('shows no size readout: the tree listing has no size field', () => {
    renderIn('book', <SequenceStepper {...tree} operation="inorder" />);
    expect(screen.getByTestId('sequence-size')).toHaveAttribute('hidden');
  });

  it('describes the tree for a reader who cannot see it', () => {
    renderIn('book', <SequenceStepper {...tree} operation="inorder" />);
    const label = screen.getByTestId('tree-view').getAttribute('aria-label')!;
    expect(label).toMatch(/árbol/i);
    expect(label).toContain('3');
  });

  it('names the structure in the chip and the traversal in the heading', () => {
    renderIn('book', <SequenceStepper {...tree} operation="inorder" />);
    expect(screen.getByText(/árbol binario/)).toBeInTheDocument();
    expect(screen.getByText('recorrer en inorden')).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · symbols in a binary-tree (#321)', () => {
  it('draws an expression tree with its operators as symbols', () => {
    const { container } = render(
      <SequenceStepper
        eda="binary-tree"
        operation="inorder"
        values={['*', '+', '−', 3, 4, 5, 1]}
      />,
    );
    const values = [...container.querySelectorAll('[data-node]')].map((n) =>
      n.getAttribute('data-value'),
    );
    expect(values.sort()).toEqual(['*', '+', '1', '3', '4', '5', '−'].sort());
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
  });

  it('refuses a symbol on any other recipe', () => {
    render(
      <SequenceStepper
        eda="linked-list-singly"
        operation="search"
        values={[1, '+', 3]}
        target={3}
      />,
    );
    expect(screen.getByText(/solo binary-tree acepta símbolos/)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · height and search on binary-tree (#321)', () => {
  const tree = { eda: 'binary-tree' as const, values: [3, 9, 1, 4, 7, null, 6] };

  it('draws no strip for a height: it writes nothing out', () => {
    renderIn('book', <SequenceStepper {...tree} operation="height" />);
    expect(screen.getByTestId('tree-view').querySelectorAll('[data-slot]')).toHaveLength(0);
  });

  it('marks the node it finds, in words as well as in colour', () => {
    renderIn('book', <SequenceStepper {...tree} operation="search" target={6} />);
    for (let i = 0; i < 60; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
    const six = screen.getByTestId('tree-view').querySelector('[data-node][data-value="6"]')!;
    expect(six.getAttribute('data-state')).toBe('found');
    expect(within(screen.getByTestId('tree-view')).getByText('✓ este')).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the bst recipe (#321)', () => {
  const walkToEnd = () => {
    for (let i = 0; i < 80; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
  };

  it('fades what a search rules out', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="search" values={[4, 2, 7, 1, 3, 6, 9]} target={6} />,
    );
    walkToEnd();
    const faded = [
      ...screen.getByTestId('tree-view').querySelectorAll('[data-node][data-state="discarded"]'),
    ].map((n) => Number(n.getAttribute('data-value')));
    expect(faded.sort((a, b) => a - b)).toEqual([1, 2, 3, 9]);
  });

  it('lands an inserted value in a column that was already there', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="insert" values={[8, 5, 20]} value={12} />,
    );
    const columns = () =>
      Object.fromEntries(
        [...screen.getByTestId('tree-view').querySelectorAll('[data-node]')].map((n) => [
          n.getAttribute('data-value'),
          n.getAttribute('data-column'),
        ]),
      );
    // Column 2 is 12's before 12 exists: nothing moves when it lands.
    expect(columns()).toEqual({ 5: '0', 8: '1', 20: '3' });
    walkToEnd();
    expect(columns()).toEqual({ 5: '0', 8: '1', 12: '2', 20: '3' });
  });

  it('draws no strip under an insertion: a search tree keeps no array', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="insert" values={[8, 5, 20]} value={12} />,
    );
    expect(screen.getByTestId('tree-view').querySelectorAll('[data-slot]')).toHaveLength(0);
  });

  it('shows a double rotation above the two simple ones it calls, side by side', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="avl"
        operation="rotate-left-right"
        values={[12, 4, 14, 2, 8, 6, 10]}
        target={12}
      />,
    );
    const panels = screen.getAllByTestId('sequence-listing');
    expect(panels.map((p) => p.getAttribute('data-listing'))).toEqual([
      'principal',
      'rotación a la izquierda',
      'rotación a la derecha',
    ]);
    expect(panels[0]).toHaveTextContent('rotateLeftRight');
    expect(panels[1]).toHaveTextContent('Node<T> rotateLeft(Node<T> p)');
    expect(panels[2]).toHaveTextContent('Node<T> rotateRight(Node<T> p)');
    expect(screen.getByText('rotación a la izquierda')).toBeInTheDocument();
  });

  it('shows a program of removals beside the method it calls, each listing named', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="bst"
        operation="remove"
        values={[8, 3, 12, 1, 6, 10, 14, 11]}
        target={[1, 3]}
        program
      />,
    );
    const panels = screen.getAllByTestId('sequence-listing');
    expect(panels.map((p) => p.getAttribute('data-listing'))).toEqual(['programa', 'método']);
    expect(panels[0]).toHaveTextContent('tree.remove(1);');
    expect(panels[1]).toHaveTextContent('private Node<T> remove(Node<T> node, T value)');
    // The method is walked, so its legend is the removal's.
    expect(screen.getByText('sucesor')).toBeInTheDocument();
  });

  it('shows a tree built by a program, one line per frame', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="insert" values={[]} value={[8, 4, 12]} program />,
    );
    expect(screen.getByTestId('tree-view').querySelectorAll('[data-node]')).toHaveLength(0);
    walkToEnd();
    expect(screen.getByTestId('tree-view').querySelectorAll('[data-node]')).toHaveLength(3);
  });

  it('names the search tree in the chip', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="search" values={[2, 1, 3]} target={3} />,
    );
    expect(screen.getByText(/árbol binario de búsqueda/)).toBeInTheDocument();
  });

  it('refuses a traversal on the search tree, and says which operations it has', () => {
    // The inorder is the search tree's too (#322); the preorder is not.
    renderIn('book', <SequenceStepper eda="bst" operation="preorder" values={[2, 1, 3]} />);
    expect(screen.getByText(/buscar, insertar, recorrer en inorden/)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the binary search over the array (#322)', () => {
  const walkToEnd = () => {
    for (let i = 0; i < 80; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
  };

  it('fades and dashes every cell the search rules out, and says so in the legend', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="dynamic-array"
        operation="binary-search"
        values={[2, 4, 6, 8, 10, 12, 14]}
        target={7}
      />,
    );
    walkToEnd();
    const out = [
      ...screen.getByTestId('sequence-structure').querySelectorAll('[data-state="discarded"]'),
    ];
    expect(out).toHaveLength(7);
    for (const cell of out) {
      expect(cell.getAttribute('opacity')).toBe('0.45');
      expect(cell.querySelector('rect')?.getAttribute('stroke-dasharray')).not.toBeNull();
    }
    expect(screen.getByText('descartado')).toBeInTheDocument();
    expect(screen.queryByText('libre')).toBeNull();
  });

  it('refuses an array that is not sorted with an authoring error', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="dynamic-array"
        operation="binary-search"
        values={[7, 3, 1]}
        target={3}
      />,
    );
    expect(document.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});

describe('<SequenceStepper> · a search says what it looks for (#322)', () => {
  it('writes the value the binary search looks for', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="dynamic-array"
        operation="binary-search"
        values={[2, 4, 6, 8, 10, 12, 14]}
        target={6}
      />,
    );
    expect(screen.getByTestId('sequence-seek').textContent).toBe('se busca el 6');
  });

  it('writes the value a search tree is searched for', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="search" values={[4, 2, 7, 1, 3, 6, 9]} target={6} />,
    );
    expect(screen.getByTestId('sequence-seek').textContent).toBe('se busca el 6');
  });

  it('writes nothing for an operation that looks for nothing', () => {
    renderIn(
      'book',
      <SequenceStepper eda="dynamic-array" operation="insert-last" values={[1, 2]} value={3} />,
    );
    expect(screen.queryByTestId('sequence-seek')).toBeNull();
  });
});

describe('<SequenceStepper> · two listings of one search (#322)', () => {
  it('shows the recursive listing and the iterative one side by side, each named', () => {
    renderIn(
      'presentation',
      <SequenceStepper
        eda="bst"
        operation="search"
        values={[4, 2, 7, 1, 3, 6, 9]}
        target={6}
        iterative
      />,
    );
    const panels = screen.getAllByTestId('sequence-listing');
    expect(panels).toHaveLength(2);
    expect(panels.map((p) => p.getAttribute('data-listing'))).toEqual(['recursiva', 'iterativa']);
    expect(screen.getByText('recursiva')).toBeInTheDocument();
    expect(screen.getByText('iterativa')).toBeInTheDocument();
  });

  it('keeps one listing when the iterative one is not asked for', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="search" values={[4, 2, 7, 1, 3, 6, 9]} target={6} />,
    );
    expect(screen.getAllByTestId('sequence-listing')).toHaveLength(1);
  });

  it('refuses iterative on an operation that has no iterative listing', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="remove" values={[4, 2, 7]} target={4} iterative />,
    );
    expect(document.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});

describe('<SequenceStepper> · the avl recipe (#322)', () => {
  const forward = (times: number) => {
    for (let i = 0; i < times; i += 1) {
      fireEvent.click(screen.getByRole('button', { name: 'Adelante' }));
    }
  };
  const view = () => screen.getByTestId('tree-view');

  it('draws the reference q.right = p with an arrowhead, since it points up', () => {
    renderIn(
      'book',
      <SequenceStepper eda="avl" operation="rotate-right" values={[6, 4, 7, 2, 5]} target={6} />,
    );
    expect(view().querySelectorAll('[data-edge-up]')).toHaveLength(0);
    forward(3);
    const up = [...view().querySelectorAll('[data-edge-up]')];
    expect(up.map((e) => e.getAttribute('data-edge-up'))).toEqual(['4-6']);
    forward(1);
    expect(view().querySelectorAll('[data-edge-up]')).toHaveLength(0);
  });

  it('keeps the one node only q holds on the drawing', () => {
    renderIn(
      'book',
      <SequenceStepper eda="avl" operation="rotate-right" values={[6, 4, 7, 2, 5]} target={6} />,
    );
    forward(2);
    const values = [...view().querySelectorAll('[data-node]')].map((n) =>
      Number(n.getAttribute('data-value')),
    );
    expect(values.sort((a, b) => a - b)).toEqual([2, 4, 5, 6, 7]);
  });

  it('writes p and q beside the two nodes that rotate', () => {
    renderIn(
      'book',
      <SequenceStepper eda="avl" operation="rotate-left" values={[1, 2, 3]} target={1} />,
    );
    forward(1);
    expect(within(view()).getByText('p')).toBeInTheDocument();
    expect(within(view()).getByText('q')).toBeInTheDocument();
  });

  it('names the AVL tree in the chip, and a rotation in the legend', () => {
    renderIn(
      'book',
      <SequenceStepper eda="avl" operation="rotate-right" values={[3, 2, 1]} target={3} />,
    );
    expect(screen.getByText(/árbol AVL/)).toBeInTheDocument();
    expect(screen.getByText('rotan')).toBeInTheDocument();
    expect(screen.getByText('cambia de padre')).toBeInTheDocument();
  });

  it('refuses a rotation on another tree, and says where it lives', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="rotate-right" values={[3, 2, 1]} target={3} />,
    );
    expect(screen.getByText(/árbol de búsqueda tiene listado/)).toBeInTheDocument();
    renderIn('book', <SequenceStepper eda="dynamic-array" operation="rotate-left" values={[1]} />);
    expect(screen.getByText(/eda="avl"/)).toBeInTheDocument();
  });

  it('writes the balance factor beside every node, and shows the −2 balance finds', () => {
    renderIn('book', <SequenceStepper eda="avl" operation="insert" values={[30, 20]} value={10} />);
    const badges = () => [...view().querySelectorAll('[data-node] text')].map((t) => t.textContent);
    expect(badges()).toContain('−1');
    let sawBroken = false;
    for (let i = 0; i < 20; i += 1) {
      if (badges().includes('−2')) sawBroken = true;
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
    expect(sawBroken).toBe(true);
    expect(badges()).not.toContain('−2');
  });

  it('tells the author which child is missing for the rotation asked', () => {
    renderIn(
      'book',
      <SequenceStepper eda="avl" operation="rotate-right" values={[1, 2, 3]} target={1} />,
    );
    expect(screen.getByText(/hijo izquierdo que suba/)).toBeInTheDocument();
  });
});

describe('<SequenceStepper> · the combinations 21-edd-arboles-i mounts', () => {
  // Pinned here because `app/contentRenders.test.tsx` never mounts the lazy
  // widget (apps/web/CLAUDE.md §2, class 4). Named for the act and slide they
  // come from, and each one WALKED to its last frame, not only mounted.
  // The binary-tree act's guide example: (3 + 4) * (5 − 1).
  const EXPRESSION = ['*', '+', '−', 3, 4, 5, 1];
  const mounted: { act: string; slide: string; props: SequenceStepperProps }[] = [
    {
      act: 'El árbol binario',
      slide: 'El código del preorden en un árbol binario',
      props: { eda: 'binary-tree', operation: 'preorder', values: EXPRESSION },
    },
    {
      act: 'El árbol binario',
      slide: 'El código del inorden',
      props: { eda: 'binary-tree', operation: 'inorder', values: EXPRESSION },
    },
    {
      act: 'El árbol binario',
      slide: 'El código del postorden en un árbol binario',
      props: { eda: 'binary-tree', operation: 'postorder', values: EXPRESSION },
    },
    {
      act: 'El árbol binario',
      slide: 'La altura por recursión',
      props: { eda: 'binary-tree', operation: 'height', values: EXPRESSION },
    },
    {
      act: 'El árbol binario',
      slide: 'El código de la búsqueda',
      // Numbers only, and in no order: the search has to look on both sides.
      props: { eda: 'binary-tree', operation: 'search', values: [4, 9, 2, 7, 1, 8, 3], target: 8 },
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
    expect(screen.getByRole('button', { name: 'Adelante' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
  });
});

describe('<SequenceStepper> · the combinations 22-edd-arboles-ii mounts', () => {
  // Pinned here because `app/contentRenders.test.tsx` never mounts the lazy
  // widget (apps/web/CLAUDE.md §2, class 4). Named for the act and slide they
  // come from, and each one WALKED to its last frame, not only mounted. Kept
  // level with the document by every slice of #322 that rewrites an act.
  const mounted: { act: string; slide: string; props: SequenceStepperProps }[] = [
    {
      act: 'the opening, with no heading',
      slide: 'La búsqueda binaria',
      props: {
        eda: 'dynamic-array',
        operation: 'binary-search',
        values: [2, 4, 6, 8, 10, 12, 14],
        target: 6,
        iterative: true,
      },
    },
    {
      act: 'El árbol binario de búsqueda',
      slide: 'El código de la búsqueda',
      props: {
        eda: 'bst',
        operation: 'search',
        values: [8, 4, 12, 2, 6, 10, 14],
        target: 10,
        iterative: true,
      },
    },
    {
      act: 'El árbol binario de búsqueda',
      slide: 'El código de la inserción',
      props: {
        eda: 'bst',
        operation: 'insert',
        values: [8, 4, 12, 2, 6, 10, 14],
        value: 7,
        iterative: true,
      },
    },
    {
      act: 'El árbol binario de búsqueda',
      slide: 'Un árbol armado con inserciones',
      props: {
        eda: 'bst',
        operation: 'insert',
        values: [],
        value: [8, 4, 12, 2, 6, 10, 14],
        program: true,
      },
    },
    {
      act: 'El árbol binario de búsqueda',
      slide: 'El código del inorden',
      props: { eda: 'bst', operation: 'inorder', values: [8, 4, 12, 2, 6, 10, 14] },
    },
    {
      act: 'El árbol binario de búsqueda',
      slide: 'El código de la eliminación',
      props: {
        eda: 'bst',
        operation: 'remove',
        values: [8, 4, 12, 2, 6, 10, 14],
        target: 8,
      },
    },
    {
      act: 'El árbol binario de búsqueda',
      slide: 'Eliminaciones en un mismo árbol',
      props: {
        eda: 'bst',
        operation: 'remove',
        values: [8, 3, 12, 1, 6, 10, 14, 11],
        target: [1, 3, 8, 12, 14, 5],
        program: true,
      },
    },
    {
      act: 'El desbalance del árbol de búsqueda',
      slide: 'Altura mínima: un árbol balanceado',
      props: {
        eda: 'bst',
        operation: 'insert',
        values: [],
        value: [8, 4, 12, 2, 6, 10, 14],
        program: true,
      },
    },
    {
      act: 'El desbalance del árbol de búsqueda',
      slide: 'Altura máxima: un árbol desbalanceado',
      props: {
        eda: 'bst',
        operation: 'insert',
        values: [],
        value: [2, 4, 6, 8, 10, 12, 14],
        program: true,
      },
    },
    {
      act: 'El desbalance del árbol de búsqueda',
      slide: 'Altura intermedia: un árbol en parte desbalanceado',
      props: {
        eda: 'bst',
        operation: 'insert',
        values: [],
        value: [4, 10, 2, 12, 8, 14, 6],
        program: true,
      },
    },
    {
      act: 'Las rotaciones',
      slide: 'El código de la rotación a la derecha',
      props: { eda: 'avl', operation: 'rotate-right', values: [12, 8, 14, 4, 10, 2], target: 12 },
    },
    {
      act: 'Las rotaciones',
      slide: 'El código de la rotación a la izquierda',
      props: { eda: 'avl', operation: 'rotate-left', values: [4, 2, 8, 6, 10, 12], target: 4 },
    },
    {
      act: 'Las rotaciones',
      slide: 'El código de la rotación doble a la derecha',
      props: {
        eda: 'avl',
        operation: 'rotate-left-right',
        values: [12, 4, 14, 2, 8, 6, 10],
        target: 12,
      },
    },
    {
      act: 'Las rotaciones',
      slide: 'El código de la rotación doble a la izquierda',
      props: {
        eda: 'avl',
        operation: 'rotate-right-left',
        values: [4, 2, 12, 8, 14, 6, 10],
        target: 4,
      },
    },
    {
      act: 'El árbol AVL',
      slide: 'Insertar en un árbol AVL',
      props: {
        eda: 'avl',
        operation: 'insert',
        values: [],
        value: [2, 4, 6, 8, 10, 12, 14],
        program: true,
      },
    },
    {
      act: 'La implementación del árbol AVL',
      slide: 'El código de la inserción en un árbol AVL',
      props: { eda: 'avl', operation: 'insert', values: [8, 4, 12, 2, 6], value: 5 },
    },
    {
      act: 'La implementación del árbol AVL',
      slide: 'El código de la eliminación en un árbol AVL',
      props: { eda: 'avl', operation: 'remove', values: [8, 4, 10, 2, 6], target: 10 },
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
    expect(screen.getByRole('button', { name: 'Adelante' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(document.querySelector('[data-authoring-error]')).toBeNull();
  });
});

describe('<SequenceStepper> · removing from the bst (#321)', () => {
  it('copies the successor into a node with two children, and keeps the node', () => {
    renderIn(
      'book',
      <SequenceStepper
        eda="bst"
        operation="remove"
        values={[8, 5, 1, 4, 6, 7, 20, 12]}
        target={8}
      />,
    );
    const view = () => screen.getByTestId('tree-view');
    const rootColumn = view()
      .querySelector('[data-node][data-value="8"]')!
      .getAttribute('data-column');
    for (let i = 0; i < 80; i += 1) {
      const next = screen.getByRole('button', { name: 'Adelante' });
      if (next.getAttribute('aria-disabled') === 'true') break;
      fireEvent.click(next);
    }
    expect(view().querySelector('[data-node][data-value="8"]')).toBeNull();
    // The root kept its column: only its value changed, to the successor's.
    const twelves = view().querySelectorAll('[data-node][data-value="12"]');
    expect(twelves).toHaveLength(1);
    expect(twelves[0]!.getAttribute('data-column')).toBe(rootColumn);
  });

  it('names the operation and the states it paints in the legend', () => {
    renderIn(
      'book',
      <SequenceStepper eda="bst" operation="remove" values={[2, 1, 3]} target={1} />,
    );
    expect(screen.getByText('eliminar')).toBeInTheDocument();
    expect(screen.getByText('sale')).toBeInTheDocument();
  });
});
