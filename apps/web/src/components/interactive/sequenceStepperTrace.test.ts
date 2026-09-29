import { describe, expect, it } from 'vitest';

import {
  CIRCULAR_OPERATIONS,
  DOUBLY_OPERATIONS,
  HEAP_OPERATIONS,
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceOperation,
  type SequenceRecipe,
  type SequenceTrace,
} from './sequenceStepperTrace';

/**
 * The trace is the widget's whole truth: the paint is derived from it, and
 * jsdom can check it exactly (the recipe of `apps/web/CLAUDE.md` §2 — "the way
 * out is to not measure"). What the browser is left to confirm is only that
 * the frames look right.
 */

const values = [7, 3, 1, 5];

/**
 * The Sequence recipes — every recipe but the heap, whose operations are its
 * own (#304). A sweep over "the operation every structure has" iterates
 * these; a sweep over every valid combination iterates RECIPES and feeds the
 * heap a starting array that already is one.
 */
const SEQUENCE_RECIPES = RECIPES.filter((r) => r !== 'heap-max');
const startFor = (recipe: SequenceRecipe, operation: SequenceOperation): number[] =>
  recipe === 'heap-max' ? [7, 5, 3, 1] : operation === 'insert-ordered' ? [1, 3, 7, 9] : values;

describe('sequenceStepperTrace · the valid combinations', () => {
  it('rejects insert-ordered on the two array recipes', () => {
    expect(isValidCombination('array', 'insert-ordered')).toBe(false);
    expect(isValidCombination('dynamic-array', 'insert-ordered')).toBe(false);
    expect(isValidCombination('linked-list-singly', 'insert-ordered')).toBe(true);
  });

  it('accepts every operation over the two arrays and the singly list', () => {
    for (const recipe of ['array', 'dynamic-array', 'linked-list-singly'] as const) {
      for (const operation of OPERATIONS) {
        if (HEAP_OPERATIONS.includes(operation)) continue;
        if (operation === 'insert-ordered' && !recipe.startsWith('linked-list')) continue;
        expect(isValidCombination(recipe, operation), `${recipe} × ${operation}`).toBe(true);
      }
    }
  });

  // The #288 review found the circular recipe showing the open-chain
  // `insertFirst` — valid Java for a structure the picture was not drawing.
  // A variant recipe now accepts only the operations it has a listing FOR.
  it('lets the ring have only the operation whose listing closes the ring', () => {
    expect(isValidCombination('linked-list-circular', 'insert-first')).toBe(true);
    for (const operation of OPERATIONS) {
      if (operation === 'insert-first') continue;
      expect(isValidCombination('linked-list-circular', operation), `circular × ${operation}`).toBe(
        false,
      );
    }
  });

  it('lets the doubly list read freely and change shape only where prev is kept', () => {
    for (const operation of ['get-at', 'search', 'insert-first', 'remove-first'] as const) {
      expect(isValidCombination('linked-list-doubly', operation), operation).toBe(true);
    }
    // remove-last is the tail form the class teaches; without tail the walk
    // is the singly listing, which never touches `prev`.
    expect(isValidCombination('linked-list-doubly', 'remove-last', true)).toBe(true);
    expect(isValidCombination('linked-list-doubly', 'remove-last', false)).toBe(false);
    for (const operation of ['insert-last', 'insert-at', 'insert-ordered', 'remove-at'] as const) {
      expect(isValidCombination('linked-list-doubly', operation), operation).toBe(false);
    }
  });

  // Rule 11 of the widget guide: every valid combination is a fixture, so a
  // change to one animation cannot silently break another.
  it('produces a walkable trace with a listing for every valid combination', () => {
    for (const recipe of RECIPES) {
      for (const operation of OPERATIONS) {
        // `tail` is what makes the doubly list's remove-last legal, so the
        // sweep asks for it and hands it over.
        const tail = recipe === 'linked-list-doubly' && operation === 'remove-last';
        if (!isValidCombination(recipe, operation, tail)) continue;
        const trace = traceFor(recipe, operation, {
          tail,
          // insert-ordered is the one operation with a precondition on the
          // input, and it is the widget's job to refuse an unsorted one — so
          // this sweep hands it a sorted list rather than exempting it.
          values: startFor(recipe, operation),
          value: 9,
          index: 2,
          target: operation === 'insert-ordered' ? 5 : 1,
        });
        const where = `${recipe} × ${operation}`;
        expect(trace.steps.length, where).toBeGreaterThan(1);
        expect(trace.code, where).toContain('\n');
        for (const step of trace.steps) {
          expect(step.description, where).not.toHaveLength(0);
          // Every highlighted line exists in the listing it points into.
          const lineCount = trace.code.split('\n').length;
          for (const line of step.highlightLines) {
            expect(line, `${where} · línea ${line}`).toBeLessThanOrEqual(lineCount);
            expect(line, where).toBeGreaterThan(0);
          }
        }
        // The last frame is the settled structure: nothing still in flight.
        const last = trace.steps.at(-1)!;
        expect(
          last.cells.every((c) => c.state !== 'active'),
          where,
        ).toBe(true);
      }
    }
  });
});

describe('sequenceStepperTrace · what each operation costs', () => {
  it('insert-first on a singly list is O(1): it never walks the chain', () => {
    const trace = traceFor('linked-list-singly', 'insert-first', { values, value: 9 });
    expect(trace.steps.some((s) => s.kind === 'walk')).toBe(false);
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([9, 7, 3, 1, 5]);
  });

  it('insert-first on an array is O(N): it shifts every element right', () => {
    const trace = traceFor('array', 'insert-first', { values, value: 9 });
    const shifts = trace.steps.filter((s) => s.kind === 'shift');
    expect(shifts).toHaveLength(values.length);
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([9, 7, 3, 1, 5]);
  });

  it('insert-last walks the whole chain without a tail, and does not with one', () => {
    const walked = traceFor('linked-list-singly', 'insert-last', { values, value: 9 });
    const direct = traceFor('linked-list-singly', 'insert-last', { values, value: 9, tail: true });
    const walkSteps = (t: typeof walked) => t.steps.filter((s) => s.kind === 'walk').length;
    expect(walkSteps(walked)).toBeGreaterThan(0);
    expect(walkSteps(direct)).toBe(0);
    // Same outcome, different cost — that is the lesson of the tail variant.
    expect(walked.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3, 1, 5, 9]);
    expect(direct.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3, 1, 5, 9]);
  });

  it('remove-last on a singly list walks even with a tail — the prev is what is missing', () => {
    const trace = traceFor('linked-list-singly', 'remove-last', { values, tail: true });
    expect(trace.steps.some((s) => s.kind === 'walk')).toBe(true);
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3, 1]);
  });

  it('remove-last on a doubly list with a tail is O(1) — prev is already there', () => {
    const trace = traceFor('linked-list-doubly', 'remove-last', { values, tail: true });
    expect(trace.steps.some((s) => s.kind === 'walk')).toBe(false);
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3, 1]);
  });
});

describe('sequenceStepperTrace · the outcomes', () => {
  it('insert-at opens the position and leaves the rest in order', () => {
    const trace = traceFor('linked-list-singly', 'insert-at', { values, value: 9, index: 2 });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3, 9, 1, 5]);
  });

  it('remove-at closes the gap', () => {
    const trace = traceFor('array', 'remove-at', { values, index: 1 });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 1, 5]);
  });

  it('insert-ordered keeps a sorted chain sorted', () => {
    const trace = traceFor('linked-list-singly', 'insert-ordered', {
      values: [1, 3, 7, 9],
      target: 5,
    });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([1, 3, 5, 7, 9]);
  });

  // #304: the naive ordered priority queue keeps its MAXIMUM at `head`, so
  // extractMax is deleteFirst. Ascending would put it last, which a singly
  // linked chain reaches only by walking.
  it('insert-ordered with descending keeps a chain sorted from largest to smallest', () => {
    const trace = traceFor('linked-list-singly', 'insert-ordered', {
      values: [9, 7, 3, 1],
      target: [5, 10, 0],
      descending: true,
    });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([10, 9, 7, 5, 3, 1, 0]);
  });

  it('insert-ordered with descending prints the listing with its comparisons flipped', () => {
    const { code } = traceFor('linked-list-singly', 'insert-ordered', {
      values: [9, 1],
      target: 5,
      descending: true,
    });
    expect(code).toContain('if (head == null || x >= head.value)');
    expect(code).toContain('prev.next.value > x');
    expect(code).not.toContain('x <= head.value');
  });

  it('insert-ordered with descending refuses a chain that is not descending', () => {
    expect(() =>
      traceFor('linked-list-singly', 'insert-ordered', {
        values: [1, 3],
        target: 2,
        descending: true,
      }),
    ).toThrow(/mayor a menor/);
  });

  it('descending means nothing to any operation but insert-ordered, and is refused there', () => {
    expect(() =>
      traceFor('linked-list-singly', 'insert-first', { values, value: 2, descending: true }),
    ).toThrow(/descending/);
  });

  it('search marks the node it found and stops there', () => {
    const trace = traceFor('linked-list-singly', 'search', { values, target: 1 });
    const last = trace.steps.at(-1)!;
    expect(last.cells.filter((c) => c.state === 'found').map((c) => c.value)).toEqual([1]);
    // It stopped at index 2 rather than walking the whole chain.
    expect(trace.steps.filter((s) => s.kind === 'walk').length).toBeLessThan(values.length);
  });

  it('search that finds nothing ends with no found cell and says so', () => {
    const trace = traceFor('linked-list-singly', 'search', { values, target: 42 });
    const last = trace.steps.at(-1)!;
    expect(last.cells.some((c) => c.state === 'found')).toBe(false);
    expect(last.description).toMatch(/no está|no aparece/i);
  });

  it('a dynamic array insert-last that fills the block doubles its capacity', () => {
    const trace = traceFor('dynamic-array', 'insert-last', { values, value: 9 });
    const capacities = trace.steps.map((s) => s.capacity).filter((c) => c !== undefined);
    expect(Math.max(...capacities)).toBeGreaterThan(values.length);
  });

  it('a circular list closes the ring: the last node points back at the first', () => {
    const trace = traceFor('linked-list-circular', 'insert-first', { values, value: 9 });
    const last = trace.steps.at(-1)!;
    expect(last.closesRing).toBe(true);
  });
});

describe('sequenceStepperTrace · what the last frame is allowed to still say', () => {
  // The final frame is what stays on screen when playback ends, so it is
  // where the lesson has to be legible: which node was inserted, which one
  // was found. Only the "the algorithm is looking here right now" states are
  // cleared. Regression guard — an earlier `settle` wiped `new` too, and the
  // inserted node lost its colour the moment it landed.
  it('keeps the inserted node marked as new', () => {
    for (const recipe of SEQUENCE_RECIPES) {
      const trace = traceFor(recipe, 'insert-first', { values, value: 9 });
      const last = trace.steps.at(-1)!;
      expect(
        last.cells.filter((c) => c.state === 'new').map((c) => c.value),
        recipe,
      ).toEqual([9]);
    }
  });

  it('keeps the found node marked, and clears everything in flight', () => {
    const trace = traceFor('linked-list-singly', 'search', { values, target: 1 });
    const last = trace.steps.at(-1)!;
    expect(last.cells.filter((c) => c.state === 'found')).toHaveLength(1);
    expect(last.cells.some((c) => c.state === 'active' || c.state === 'leaving')).toBe(false);
  });

  it('narrates without markdown the strip cannot render', () => {
    for (const recipe of RECIPES) {
      for (const operation of OPERATIONS) {
        if (!isValidCombination(recipe, operation)) continue;
        const trace = traceFor(recipe, operation, {
          values: startFor(recipe, operation),
          value: 9,
          index: 2,
          target: operation === 'insert-ordered' ? 5 : 1,
          tail: true,
        });
        for (const step of trace.steps) {
          expect(step.description, `${recipe} × ${operation}`).not.toContain('`');
        }
      }
    }
  });
});

describe('sequenceStepperTrace · the array block, slot by slot', () => {
  // The cost of an array insertion is N copies, and a reader has to SEE them.
  // The first version of this trace kept only the live elements, so a shift
  // changed nothing on screen and the Theta(N) was a claim rather than a
  // picture. These cases pin the hole.
  it('shows each copy as a duplicate that travels, source still drawn', () => {
    const trace = traceFor('array', 'insert-first', { values, value: 9 });
    const shifts = trace.steps.filter((s) => s.kind === 'shift');
    expect(shifts).toHaveLength(values.length);
    for (const step of shifts) {
      // The shift must stay VISIBLE — that is why this case exists, and the
      // reason is in the block comment above. What changed in #294 is HOW:
      // a copy does not empty its source, so mid-shift the block holds the
      // moved value TWICE — once live at the destination, once stale at the
      // source. Drawing a hole there instead said "move", and drew the
      // picture #277 teaches as the invalid array.
      const occupied = step.slots!.map((s) => s !== null);
      const lastFull = occupied.lastIndexOf(true);
      expect(occupied.slice(0, lastFull).every(Boolean)).toBe(true);

      const stale = step.slots!.filter((s) => s?.state === 'stale');
      expect(stale).toHaveLength(1);
      const active = step.slots!.find((s) => s?.state === 'active');
      expect(active!.value).toBe(stale[0]!.value);
    }
  });

  it('leaves no hole once the value is written', () => {
    const trace = traceFor('array', 'insert-first', { values, value: 9 });
    const slots = trace.steps.at(-1)!.slots!;
    const lastFull = slots.map((s) => s !== null).lastIndexOf(true);
    expect(slots.slice(0, lastFull + 1).every((s) => s !== null)).toBe(true);
    expect(slots.slice(0, lastFull + 1).map((s) => s!.value)).toEqual([9, 7, 3, 1, 5]);
  });

  it('closes the hole again when removing from the middle', () => {
    const trace = traceFor('array', 'remove-at', { values, index: 1 });
    const slots = trace.steps.at(-1)!.slots!;
    const lastFull = slots.map((s) => s !== null).lastIndexOf(true);
    expect(slots.slice(0, lastFull + 1).map((s) => s!.value)).toEqual([7, 1, 5]);
  });

  it('draws free capacity beyond the live elements', () => {
    const trace = traceFor('array', 'search', { values, target: 7 });
    const slots = trace.steps[0]!.slots!;
    expect(slots.length).toBeGreaterThan(values.length);
    expect(slots.at(-1)).toBeNull();
  });

  it('gives a list no slots at all — the block is an array idea', () => {
    const trace = traceFor('linked-list-singly', 'insert-first', { values, value: 9 });
    expect(trace.steps.every((s) => s.slots === undefined)).toBe(true);
  });
});

describe('sequenceStepperTrace · the counts the prose claims', () => {
  // teach-a-data-structure.md's checklist: every arithmetic claim about a
  // sequence is reproduced by simulation, INCLUDING one non-power-of-two N.
  // 18-edd-listas-enlazadas.mdx makes these claims in prose; the widget is
  // what the reader watches, so the two must agree.
  const sizes = [4, 7, 13]; // 7 and 13 are not powers of two

  it.each(sizes)('insertLast without a tail walks N-1 nodes (N=%i)', (n) => {
    const values = Array.from({ length: n }, (_, i) => i + 1);
    const trace = traceFor('linked-list-singly', 'insert-last', { values, value: 99 });
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(n - 1);
  });

  it.each(sizes)('insertFirst on an array copies N elements (N=%i)', (n) => {
    const values = Array.from({ length: n }, (_, i) => i + 1);
    const trace = traceFor('array', 'insert-first', { values, value: 99 });
    expect(trace.steps.filter((s) => s.kind === 'shift')).toHaveLength(n);
  });

  it.each(sizes)('insertFirst on a chain never walks, whatever N is (N=%i)', (n) => {
    const values = Array.from({ length: n }, (_, i) => i + 1);
    const trace = traceFor('linked-list-singly', 'insert-first', { values, value: 99 });
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(0);
  });

  it.each(sizes)('deleteLast walks N-2 nodes even with a tail (N=%i)', (n) => {
    const values = Array.from({ length: n }, (_, i) => i + 1);
    const trace = traceFor('linked-list-singly', 'remove-last', { values, tail: true });
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(n - 2);
  });

  it.each(sizes)('visiting every position from head costs N(N+1)/2 nodes (N=%i)', (n) => {
    // The Theta(N^2) claim of the "Un método, dos estructuras" slide: a loop
    // calling getAt(i) restarts at head every time. Counted with the widget's
    // OWN elementary-operation counter — the number the reader watches — so
    // the prose, the picture and the counter cannot drift apart. Reaching
    // position i visits i+1 nodes, and the sum over i is N(N+1)/2, which is
    // quadratic. (The count of HOPS is one less per position, N(N-1)/2; both
    // are Theta(N^2), and the slide claims the order, not the constant.)
    const values = Array.from({ length: n }, (_, i) => i + 1);
    let visited = 0;
    for (const target of values) {
      const trace = traceFor('linked-list-singly', 'search', { values, target });
      visited += trace.steps.at(-1)!.cost;
    }
    expect(visited).toBe((n * (n + 1)) / 2);
  });
});

describe('sequenceStepperTrace · get-at, the operation that shows the price', () => {
  it.each([0, 1, 2, 3])('walks exactly i hops to reach position %i, skipping none', (i) => {
    const trace = traceFor('linked-list-singly', 'get-at', { values, index: i });
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(i);
    // Every hop names the position it landed on, in order.
    const landed = trace.steps
      .filter((s) => s.kind === 'walk')
      .map((s) => s.pointers.find((p) => p.name === 'current')!.index);
    expect(landed).toEqual(Array.from({ length: i }, (_, k) => k + 1));
  });

  it('ends on the node it was asked for', () => {
    const trace = traceFor('linked-list-singly', 'get-at', { values, index: 2 });
    const last = trace.steps.at(-1)!;
    expect(last.cells.filter((c) => c.state === 'found').map((c) => c.value)).toEqual([1]);
    expect(last.pointers.find((p) => p.name === 'current')!.index).toBe(2);
  });

  // The cost is no longer on screen (#294, ADR-0074 §Amended by): a single
  // run shows a single number, and one number is not a growth rate. It is
  // still the trace's own arithmetic and still worth pinning HERE, which is
  // where a claim about cost can be checked exactly.
  it.each([0, 1, 2, 3])('charges exactly the i hops to reach position %i', (i) => {
    const trace = traceFor('linked-list-singly', 'get-at', { values, index: i });
    // The hops and nothing else: the chain charges `i`, where the array
    // charges a flat 1 for the multiplication (the case below). So at i = 0
    // the chain reads 0 and the array 1 — the two recipes do not count the
    // same unit, which cost nothing while the number was on screen and costs
    // nothing now that it is not. Pinned as it IS rather than as it reads.
    expect(trace.steps.at(-1)!.cost).toBe(i);
  });

  it('costs one step on an array, whatever the position — that is the contrast', () => {
    for (const i of [0, 1, 2, 3]) {
      const trace = traceFor('array', 'get-at', { values, index: i });
      expect(
        trace.steps.filter((s) => s.kind === 'walk'),
        `i=${i}`,
      ).toHaveLength(0);
      expect(trace.steps.at(-1)!.cost, `i=${i}`).toBe(1);
    }
  });

  it('refuses a position outside the structure', () => {
    expect(() => traceFor('linked-list-singly', 'get-at', { values, index: 9 })).toThrow(/rango/i);
  });
});

describe('sequenceStepperTrace · what `tail` changes in the narration', () => {
  // #294's Queue act mounts `insert-last` WITH `tail` and states on the slide
  // that "ninguna de las tres recorre la cadena" — that is the whole point of
  // the prop. The narration said "hay que caminar hasta él" anyway, twice per
  // run, because the string branched only on `empty`. Three reviewers found
  // it independently and the student named it as the thing that hurt most.
  it('does not say the chain has to be walked when `tail` is there', () => {
    const trace = traceFor('linked-list-singly', 'insert-last', {
      values: [],
      value: [3, 8, 5],
      tail: true,
    });
    // The claim to forbid is that walking is NEEDED. "sin recorrer nada" is
    // the opposite claim and is welcome, so match the obligation and not the
    // verb — the first version of this case failed on the good sentence.
    const dicenQueHayQueCaminar = trace.steps.filter((s) =>
      /hay que (caminar|recorrer)/i.test(s.description),
    );
    expect(dicenQueHayQueCaminar).toEqual([]);
    expect(trace.steps.some((s) => /tail ya lo tiene/i.test(s.description))).toBe(true);
  });

  it('still says it when there is no `tail`, because then it is true', () => {
    const trace = traceFor('linked-list-singly', 'insert-last', { values: [7, 3], value: 9 });
    expect(trace.steps.some((s) => /caminar/i.test(s.description))).toBe(true);
  });
});

describe('sequenceStepperTrace · the narration is Spanish prose', () => {
  // Renaming the identifiers to English twice hit the same trap: `previo` and
  // `nuevo` were each doing two jobs — the VARIABLE and the Spanish
  // adjective — so a blanket sweep produced "el nodo prev al último" and
  // "el fresh último". Neither is Spanish and neither is code. The English
  // words that ARE identifiers (head, tail, prev, current, next, null, size)
  // are fine; these are the ones that only ever meant an adjective.
  // `fresh` and `old` ARE identifiers in the listings, so naming them is
  // correct — "fresh.next apunta a…" reads as code, which it is. What the
  // sweep must catch is the two words standing where a Spanish ADJECTIVE
  // belongs, which is what a blanket rename produced: "el fresh último".
  const NOT_SPANISH = /\b(el|un|los|las)\s+(fresh|old)\b|\b(fresh|old)\s+(último|nodo|primero)\b/i;

  it('never lets an English adjective stand in for a Spanish one', () => {
    for (const recipe of RECIPES) {
      for (const operation of OPERATIONS) {
        if (!isValidCombination(recipe, operation)) continue;
        for (const tail of [false, true]) {
          const trace = traceFor(recipe, operation, {
            values: startFor(recipe, operation),
            value: 9,
            index: 2,
            target: operation === 'insert-ordered' ? 5 : 1,
            tail,
          });
          for (const step of trace.steps) {
            expect(step.description, `${recipe} × ${operation}`).not.toMatch(NOT_SPANISH);
          }
        }
      }
    }
  });
});

describe('sequenceStepperTrace · the pointers the reader follows', () => {
  it('every list frame carries a head pointer', () => {
    const trace = traceFor('linked-list-singly', 'insert-at', { values, value: 9, index: 2 });
    for (const step of trace.steps) {
      expect(step.pointers.some((p) => p.name === 'head')).toBe(true);
    }
  });

  it('a tail pointer is drawn only when the author asked for one', () => {
    const withTail = traceFor('linked-list-singly', 'insert-last', {
      values,
      value: 9,
      tail: true,
    });
    const without = traceFor('linked-list-singly', 'insert-last', { values, value: 9 });
    expect(withTail.steps.every((s) => s.pointers.some((p) => p.name === 'tail'))).toBe(true);
    expect(without.steps.some((s) => s.pointers.some((p) => p.name === 'tail'))).toBe(false);
  });

  it('an array frame carries an index cursor rather than named pointers', () => {
    const trace = traceFor('array', 'insert-at', { values, value: 9, index: 2 });
    expect(trace.steps.every((s) => s.pointers.every((p) => p.name !== 'head'))).toBe(true);
  });
});

describe('sequenceStepperTrace · authoring guards the widget surfaces', () => {
  const operations: SequenceOperation[] = ['insert-at', 'remove-at'];
  it.each(operations)('%s refuses an index outside the structure', (operation) => {
    expect(() =>
      traceFor('linked-list-singly', operation, { values, value: 9, index: 99 }),
    ).toThrow(/índice/i);
  });

  it('insert-ordered refuses an unsorted starting list', () => {
    expect(() =>
      traceFor('linked-list-singly', 'insert-ordered', { values: [5, 1, 9], target: 3 }),
    ).toThrow(/ordenad/i);
  });

  const emptyOk: SequenceOperation[] = ['insert-first', 'insert-last'];
  it.each(emptyOk)('%s works on an empty structure', (operation) => {
    const trace = traceFor('linked-list-singly', operation, { values: [], value: 9 });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([9]);
  });

  const needsAnElement: SequenceOperation[] = ['remove-first', 'remove-last'];
  it.each(needsAnElement)('%s refuses an empty structure', (operation) => {
    expect(() => traceFor('linked-list-singly', operation, { values: [] })).toThrow(/vacía/i);
  });
});

describe('sequenceStepperTrace · the listings', () => {
  it('gives each recipe its own listing for the same operation', () => {
    const seen = new Map<string, SequenceRecipe>();
    for (const recipe of SEQUENCE_RECIPES) {
      const { code } = traceFor(recipe, 'insert-first', { values, value: 9 });
      // The array and the dynamic array legitimately share insert-first's
      // shift loop; the three list recipes must each differ from the arrays.
      if (recipe.startsWith('linked-list')) {
        expect(code).toContain('Node');
      } else {
        expect(code).not.toContain('Node');
      }
      seen.set(code, recipe);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});

describe('sequenceStepperTrace · a chain built one insertion at a time', () => {
  // Two slides of 18-edd-listas-enlazadas.mdx grow a chain from empty — one at
  // the front, one at the back — and the whole comparison the class makes
  // rests on what those two traces count. Pinned here rather than watched in
  // the browser: the paint is derived from these frames.
  const four = [5, 1, 3, 7];

  it('insertFirst from empty ends with the values in reverse, and never walks', () => {
    const trace = traceFor('linked-list-singly', 'insert-first', { values: [], value: four });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([...four].reverse());
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(0);
    // Θ(1) each: `cost` restarts per call, so every insertion ends on 4.
    const done = trace.steps.filter((s) => s.kind === 'done').map((s) => s.cost);
    expect(done).toEqual([4, 4, 4, 4]);
  });

  it('insertLast from empty ends in order, walking one node more each time', () => {
    const trace = traceFor('linked-list-singly', 'insert-last', { values: [], value: four });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual(four);
    // The first insertion takes the empty branch and walks nothing; after it,
    // the walk is as long as the chain — 0, 1, 2 hops. That IS the Θ(N).
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(0 + 0 + 1 + 2);
    const done = trace.steps.filter((s) => s.kind === 'done').map((s) => s.cost);
    expect(done).toEqual([4, 5, 6, 7]);
  });

  it('parks the floating node over the slot it is about to land in', () => {
    const trace = traceFor('linked-list-singly', 'insert-last', { values: [], value: four });
    const carried = trace.steps.filter((s) => s.carry !== undefined);
    expect(carried.every((s) => s.carry!.slot === s.cells.length)).toBe(true);
    // insert-first grows at the front, so it keeps the front slot it has
    // always used and names none.
    const front = traceFor('linked-list-singly', 'insert-first', { values: [], value: four });
    expect(front.steps.every((s) => s.carry?.slot === undefined)).toBe(true);
  });

  it('shows the link leaving the last node, once per insertion but the first', () => {
    const trace = traceFor('linked-list-singly', 'insert-last', { values: [], value: four });
    const linking = trace.steps.filter((s) => s.linkToCarry !== undefined);
    expect(linking).toHaveLength(3);
    // Always the node at the end of the chain as it is by then.
    expect(linking.map((s) => s.linkToCarry)).toEqual([0, 1, 2]);
    expect(trace.steps.filter((s) => s.headToCarry === true)).toHaveLength(1);
  });

  it('drives the listing with a calling program that names every insertion', () => {
    const { code } = traceFor('linked-list-singly', 'insert-last', { values: [], value: four });
    for (const x of four) expect(code).toContain(`list.insertLast(${x});`);
  });

  it('asks about the empty chain before dereferencing head', () => {
    for (const tail of [false, true]) {
      const { code } = traceFor('linked-list-singly', 'insert-last', {
        values: [7, 3],
        value: 9,
        tail,
      });
      expect(code).toContain('if (head == null)');
      // One `size++`, so no fragment of the listing appears twice — `lineOf`
      // names lines by text and would silently pick the first of two.
      expect(code.split('\n').filter((l) => l.includes('size++'))).toHaveLength(1);
    }
  });
});

describe('sequenceStepperTrace · one operation, several runs', () => {
  // Every slide of the operations act runs its operation more than once, so
  // the reader sees the cost CHANGE instead of being told it does. The runs
  // share one chain and one counter; these pin what each of them leaves.
  const chain = [7, 3, 1, 5, 9, 2, 8];

  it('getAt walks once per position asked for', () => {
    const trace = traceFor('linked-list-singly', 'get-at', { values: chain, index: [0, 3, 6] });
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(0 + 3 + 6);
    expect(trace.steps.at(-1)!.description).toMatch(/posición 6 tras 6 saltos/);
    // The chain is untouched: getAt reads.
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual(chain);
  });

  it('search stops at the hit and only the absent value costs the whole chain', () => {
    const trace = traceFor('linked-list-singly', 'search', { values: chain, target: [7, 8, 4] });
    const answers = trace.steps.filter((s) => /Encontramos|no está/.test(s.description));
    expect(answers.map((s) => s.description)).toEqual([
      'Encontramos 7 tras recorrer 1 nodo.',
      'Encontramos 8 tras recorrer 7 nodos.',
      'Recorrimos los 7 nodos: 4 no está en la lista.',
    ]);
  });

  it('insertAt validates each index against the chain as it is by then', () => {
    const trace = traceFor('linked-list-singly', 'insert-at', {
      values: [7, 3, 1, 5],
      value: [9, 4, 6],
      index: [2, 0, 5],
    });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([4, 7, 3, 9, 1, 6, 5]);
    // Position 5 is only legal because the two insertions before it grew the
    // chain — validating against the STARTING length would refuse the slide.
    expect(() =>
      traceFor('linked-list-singly', 'insert-at', { values: [7, 3, 1, 5], value: 9, index: 5 }),
    ).toThrow(/índice/i);
  });

  it('insertAt and deleteAt hand position 0 to the operation defined there', () => {
    const insert = traceFor('linked-list-singly', 'insert-at', {
      values: [7, 3],
      value: 9,
      index: 0,
    });
    expect(insert.code).toContain('insertFirst(x);');
    expect(insert.steps.some((s) => s.headToCarry === true)).toBe(true);
    expect(insert.steps.at(-1)!.cells.map((c) => c.value)).toEqual([9, 7, 3]);

    const remove = traceFor('linked-list-singly', 'remove-at', { values: [7, 3], index: 0 });
    expect(remove.code).toContain('return deleteFirst();');
    expect(remove.steps.at(-1)!.cells.map((c) => c.value)).toEqual([3]);
    // No walk: there is no previous node to walk to.
    expect(remove.steps.filter((s) => s.kind === 'walk')).toHaveLength(0);
  });

  it('deleteFirst costs the same every run and deleteLast costs less', () => {
    const first = traceFor('linked-list-singly', 'remove-first', {
      values: [7, 3, 1, 5],
      times: 3,
    });
    const last = traceFor('linked-list-singly', 'remove-last', {
      values: [7, 3, 1, 5, 9],
      times: 3,
    });
    const perRun = (t: SequenceTrace) =>
      t.steps.filter((s) => s.kind === 'done').map((s) => s.cost);
    expect(perRun(first)).toEqual([2, 2, 2]);
    // One hop fewer each time, and never zero: the walk restarts at head.
    expect(perRun(last)).toEqual([5, 4, 3]);
    expect(first.steps.at(-1)!.cells.map((c) => c.value)).toEqual([5]);
    expect(last.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3]);
  });

  it('refuses a slide that would remove more nodes than the chain has', () => {
    expect(() =>
      traceFor('linked-list-singly', 'remove-first', { values: [7, 3], times: 3 }),
    ).toThrow(/lista vacía/i);
  });

  it('drives every multi-run operation with a program that names each call', () => {
    const { code } = traceFor('linked-list-singly', 'remove-at', {
      values: [7, 3, 1, 5, 9],
      index: [3, 0, 1],
    });
    expect(code).toContain('list.deleteAt(3);');
    expect(code).toContain('list.deleteAt(0);');
    // The chain was given, not built here: no constructor line.
    expect(code).not.toContain('new LinkedList()');
  });

  it('lights the call being run, not the first call that reads the same', () => {
    // Two runs of a method that takes no argument write the SAME line twice.
    const trace = traceFor('linked-list-singly', 'remove-first', {
      values: [7, 3, 1, 5],
      times: 3,
    });
    const calls = trace.code
      .split('\n')
      .map((line, i) => (line.includes('list.deleteFirst();') ? i + 1 : 0))
      .filter(Boolean);
    expect(calls).toHaveLength(3);
    const lit = new Set(
      trace.steps.flatMap((s) => s.highlightLines.filter((l) => calls.includes(l))),
    );
    expect([...lit].sort((a, b) => a - b)).toEqual(calls);
  });
});

describe('sequenceStepperTrace · the guards the edge-case slide claims', () => {
  // 18-edd-listas-enlazadas.mdx §Los casos de borde names four cases and the
  // line that handles each. The slide is only true if the listings the widget
  // shows carry those lines, so it is checked here rather than read.
  const singly = 'linked-list-singly' as const;

  it('every removal refuses an empty chain', () => {
    for (const operation of ['remove-first', 'remove-last'] as const) {
      const { code } = traceFor(singly, operation, { values: [7, 3] });
      expect(code).toContain('if (head == null)');
      expect(code).toContain('throw new NoSuchElementException();');
    }
  });

  it('insertLast handles the empty chain rather than dereferencing head', () => {
    const { code } = traceFor(singly, 'insert-last', { values: [], value: 9 });
    expect(code).toContain('if (head == null)');
    expect(code).toContain('head = fresh;');
  });

  it('deleteLast handles a chain of one, where there is no second-to-last', () => {
    const { code } = traceFor(singly, 'remove-last', { values: [7], times: 1 });
    expect(code).toContain('if (head.next == null)');
    // And the trace TAKES that branch rather than walking to a node that is
    // not there: `prev.next.next` would be a null dereference.
    const trace = traceFor(singly, 'remove-last', { values: [7, 3], times: 2 });
    expect(trace.steps.at(-1)!.cells).toEqual([]);
    expect(trace.steps.some((f) => f.description.includes('Queda un solo nodo'))).toBe(true);
  });

  it('insertAt and deleteAt handle position 0, where there is no previous', () => {
    expect(traceFor(singly, 'insert-at', { values: [7], value: 9, index: 0 }).code).toContain(
      'if (i == 0)',
    );
    expect(traceFor(singly, 'remove-at', { values: [7], index: 0 }).code).toContain('if (i == 0)');
  });

  it('insertAt accepts the position past the end, which means "at the end"', () => {
    const trace = traceFor(singly, 'insert-at', { values: [7, 3], value: 9, index: 2 });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([7, 3, 9]);
  });
});

describe('sequenceStepperTrace · insertOrdered', () => {
  // The one operation whose position nobody passes in. Three runs, three
  // different destinations, and the two assignments that link the node are
  // two frames — the same discipline every other insertion follows.
  const start = [3, 7];

  it('sends each value where its own value puts it', () => {
    const trace = traceFor('linked-list-singly', 'insert-ordered', {
      values: start,
      target: [5, 1, 9],
    });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([1, 3, 5, 7, 9]);
  });

  it('hands the front to insertFirst, because the walk cannot reach it', () => {
    const { code, steps } = traceFor('linked-list-singly', 'insert-ordered', {
      values: start,
      target: 1,
    });
    expect(code).toContain('if (head == null || x <= head.value)');
    expect(code).toContain('insertFirst(x);');
    expect(steps.some((f) => f.headToCarry === true)).toBe(true);
    expect(steps.at(-1)!.cells.map((c) => c.value)).toEqual([1, 3, 7]);
  });

  it('compares against prev.next, never against prev', () => {
    // `prev` stands on the node BEFORE the one being compared, which is what
    // makes it the node the insertion will modify.
    const { steps } = traceFor('linked-list-singly', 'insert-ordered', {
      values: [1, 3, 7, 9],
      target: 5,
    });
    const asked = steps.filter((f) => f.description.includes(' < '));
    expect(asked.map((f) => f.description)).toEqual([
      '¿3 < 5? Sí: 5 va más adelante.',
      '¿7 < 5? No: el lugar de 5 es entre 3 y 7.',
    ]);
  });

  it('gives each of the two assignments a frame of its own', () => {
    const { steps } = traceFor('linked-list-singly', 'insert-ordered', {
      values: start,
      target: 5,
    });
    // `fresh.next = prev.next` shows the floating node's link; then
    // `prev.next = fresh` shows the chain's, before the node moves.
    expect(steps.filter((f) => f.carry?.next !== undefined)).not.toHaveLength(0);
    expect(steps.filter((f) => f.linkToCarry !== undefined)).toHaveLength(1);
  });

  it('walks to the end when the value is bigger than everything', () => {
    const { steps } = traceFor('linked-list-singly', 'insert-ordered', {
      values: start,
      target: 9,
    });
    expect(steps.some((f) => f.description.includes('prev.next es null'))).toBe(true);
    expect(steps.at(-1)!.cells.map((c) => c.value)).toEqual([3, 7, 9]);
  });

  it('still refuses a starting list that is not sorted', () => {
    expect(() =>
      traceFor('linked-list-singly', 'insert-ordered', { values: [5, 1, 9], target: 3 }),
    ).toThrow(/ordenad/i);
  });
});

describe('sequenceStepperTrace · the listing belongs to the recipe', () => {
  /**
   * The exhaustive sweep checks that every highlighted line EXISTS. It cannot
   * see a listing that is valid Java for the wrong structure — and the review
   * of this branch found one shipping: the circular recipe was handed the
   * open-chain `insertFirst`, which leaves the last node pointing at the old
   * head and breaks the ring the slide beside it had just defined.
   *
   * These cases read the listing the widget shows and ask whether it belongs
   * to the recipe selected. They are deliberately crude — a walk that stops on
   * `null` cannot be right on a ring, a mutation that never writes `.prev`
   * cannot be right on a doubly-linked chain — because the class of defect is
   * "plausible code for the wrong structure", which no amount of line-number
   * checking reaches.
   */
  const walkLines = (code: string) =>
    code.split('\n').filter((line) => /\bwhile \(|\bfor \(/.test(line));

  // Driven off the allowlist itself, not a copy of it: an operation added to
  // CIRCULAR_OPERATIONS must arrive here already guarded, or the guard grows
  // a hole exactly where the contract grew.
  it.each([...CIRCULAR_OPERATIONS])(
    'a circular listing never ends a walk on null (%s)',
    (operation) => {
      const { code } = traceFor('linked-list-circular', operation, {
        values: [7, 3, 1],
        value: 9,
        index: 1,
        target: 3,
      });
      for (const line of walkLines(code)) expect(line).not.toMatch(/!= null\)/);
    },
  );

  // The other half of the promise this block's docstring makes: on a doubly
  // linked chain, an operation that changes the shape has to fix BOTH links.
  const MUTATES = (operation: SequenceOperation) =>
    operation.startsWith('insert') || operation.startsWith('remove');

  it.each([...DOUBLY_OPERATIONS].filter(MUTATES))(
    'a doubly listing that changes the chain also writes prev (%s)',
    (operation) => {
      const { code } = traceFor('linked-list-doubly', operation, {
        values: [7, 3, 1, 5],
        value: 9,
        index: 1,
        tail: operation === 'remove-last',
      });
      expect(code).toMatch(/\.prev/);
    },
  );

  it('a circular insertFirst closes the ring again, and pays the walk for it', () => {
    const { code, steps } = traceFor('linked-list-circular', 'insert-first', {
      values: [7, 3, 1],
      value: 9,
    });
    // The last node has to be told the first one changed.
    expect(code).toContain('last.next = fresh;');
    expect(code).toContain('while (last.next != head)');
    // And finding it is a walk, so the operation is not constant here.
    expect(steps.filter((f) => f.kind === 'walk').length).toBeGreaterThan(0);
    expect(steps.at(-1)!.cells.map((c) => c.value)).toEqual([9, 7, 3, 1]);
  });

  it('the open-chain recipes keep the constant-time insertFirst', () => {
    for (const recipe of ['linked-list-singly', 'linked-list-doubly'] as const) {
      const { steps } = traceFor(recipe, 'insert-first', { values: [7, 3, 1], value: 9 });
      expect(steps.filter((f) => f.kind === 'walk')).toHaveLength(0);
    }
  });

  it('refuses more runs than a slide can show, before allocating them', () => {
    expect(() =>
      traceFor('linked-list-singly', 'remove-first', { values: [7, 3], times: 100_000_000 }),
    ).toThrow(/entre 1 y/i);
  });
});

describe('sequenceStepperTrace · the block a slide asks for', () => {
  // Without `capacity` the block is sized from the input, so the SAME stack
  // came out four cells wide on the slide that pushes and five on the slide
  // that pops — one structure at two sizes, one slide apart (#294 review).
  it('reserves exactly the slots the author asked for', () => {
    const push = traceFor('array', 'insert-last', { values: [42, 7], value: 15, capacity: 6 });
    const pop = traceFor('array', 'remove-last', { values: [42, 7, 15], capacity: 6 });
    for (const trace of [push, pop]) {
      for (const step of trace.steps) {
        expect(step.slots).toHaveLength(6);
        expect(step.capacity).toBe(6);
      }
    }
  });

  it('still sizes itself from the input when nobody asks', () => {
    const trace = traceFor('array', 'remove-last', { values: [42, 7, 15] });
    expect(trace.steps[0]!.capacity).toBe(5);
  });

  it('refuses a block too small for the elements it is given', () => {
    expect(() => traceFor('array', 'remove-last', { values: [7, 3, 1, 5], capacity: 2 })).toThrow(
      /no alcanza/i,
    );
  });
});

describe('sequenceStepperTrace · what `capacity` refuses', () => {
  // The second pipeline pass measured the guard's holes: 3.7 allocated three
  // slots in silence, NaN allocated a zero-width block, and 1e7 allocated ten
  // million. None is reachable by a reader (MDX is bundled at build time) but
  // all three are authoring mistakes the file refuses everywhere else.
  it.each([3.7, Number.NaN, 0, 1e7])('refuses a capacity of %p', (capacity) => {
    expect(() => traceFor('array', 'remove-last', { values: [7, 3], capacity })).toThrow(
      /no es un entero/i,
    );
  });

  it('lets a dynamic array author choose where the resize falls', () => {
    // It used to refuse this outright, on the reasoning that the recipe
    // starts FULL so that one insertion shows the resize. That reasoning
    // holds for a single run and fails for several: with capacity =
    // values.length the FIRST push always grows, which is the one place a
    // reader least expects it. #294 push slide asks for four pushes with the
    // resize in the middle, and that is only expressible by choosing the
    // starting block.
    const trace = traceFor('dynamic-array', 'insert-last', {
      values: [42, 7],
      value: 9,
      capacity: 4,
    });
    expect(trace.steps.every((s) => s.capacity === 4)).toBe(true);
    expect(trace.steps.some((s) => s.kind === 'grow')).toBe(false);
  });
});

describe('sequenceStepperTrace · a listing that obeys the props the picture obeys', () => {
  // ADR-0074 recorded this as "a listing that is blind to a prop the picture
  // obeys": with `tail`, the singly-linked removals DRAW the tail pointer
  // moving — `remove-first` releases it when the chain empties, `remove-last`
  // has to walk it back — and the listing beside them never mentions `tail`.
  // A student copying it writes a queue whose `tail` dangles.
  it('maintains `tail` in deleteFirst when the chain can empty', () => {
    const conTail = traceFor('linked-list-singly', 'remove-first', {
      values: [7],
      times: 1,
      tail: true,
    });
    expect(conTail.code).toContain('tail = null');
    // and the picture it is beside: the chain empties, so tail points nowhere
    expect(conTail.steps.at(-1)!.pointers.find((p) => p.name === 'tail')!.index).toBeNull();
  });

  it('maintains `tail` in deleteLast, which has to walk it back', () => {
    const conTail = traceFor('linked-list-singly', 'remove-last', {
      values: [3, 8, 5],
      times: 1,
      tail: true,
    });
    expect(conTail.code).toContain('tail = ');
  });

  it('says nothing about `tail` when the slide did not ask for one', () => {
    const sinTail = traceFor('linked-list-singly', 'remove-first', { values: [7], times: 1 });
    expect(sinTail.code).not.toContain('tail');
  });
});

describe('sequenceStepperTrace · the name the listing is shown under', () => {
  // A class that has just taught `pop` = `deleteFirst` then mounts the widget
  // and the widget says `deleteFirst`, three times, in a calling program that
  // names a `list`. The body is the pila's `pop` verbatim; only the name on
  // it belongs to the structure rather than to the TDA the slide is about.
  it('renames the method and the receiver when the slide asks', () => {
    const trace = traceFor('linked-list-singly', 'remove-first', {
      values: [15, 7, 42],
      times: 3,
      method: 'pop',
      receiver: 'pila',
    });
    expect(trace.code).toContain('int pop()');
    expect(trace.code).not.toContain('deleteFirst');
    expect(trace.code).toContain('pila.pop();');
    expect(trace.code).not.toContain('list.');
  });

  // The constructor line of the driving program printed the STRUCTURE's class
  // whatever the method was called, so a slide that had declared `class Stack`
  // four slides earlier got `LinkedList pila = new LinkedList();` with a
  // `push` on it (#294, caught by reading the slide).
  it('names the class the document declared, not the structure', () => {
    const trace = traceFor('linked-list-singly', 'insert-first', {
      values: [],
      value: [42, 7],
      method: 'push',
      receiver: 'pila',
      receiverType: 'Stack',
    });
    expect(trace.code).toContain('Stack pila = new Stack();');
    expect(trace.code).not.toContain('LinkedList');
  });

  it('keeps the structure own names when nobody renames them', () => {
    const trace = traceFor('linked-list-singly', 'remove-first', {
      values: [15, 7, 42],
      times: 3,
    });
    expect(trace.code).toContain('int deleteFirst()');
    expect(trace.code).toContain('list.deleteFirst();');
  });

  it('renames an array listing too', () => {
    const trace = traceFor('dynamic-array', 'insert-last', {
      values: [42, 7],
      value: 15,
      method: 'push',
    });
    expect(trace.code).toContain('push(');
    expect(trace.code).not.toContain('insertLast');
  });
});

describe('sequenceStepperTrace · the pointer a slide keeps on screen', () => {
  // The array frames carried only the CURSOR of the operation running (`i`,
  // `j`), which vanishes between runs. A stack slide wants `top` visible the
  // whole time — it is the field the contract is written in terms of, and the
  // reader should watch it move rather than take the narration's word.
  it('keeps the named pointer on every frame, at the end the operation works on', () => {
    const trace = traceFor('dynamic-array', 'insert-last', {
      values: [42, 7],
      value: [15, 4],
      capacity: 4,
      pointer: 'top',
    });
    for (const step of trace.steps) {
      expect(
        step.pointers.find((ptr) => ptr.name === 'top'),
        step.description,
      ).toBeDefined();
    }
    // Two elements at the start, four at the end: the pointer follows `size`.
    expect(trace.steps[0]!.pointers.find((p) => p.name === 'top')!.index).toBe(1);
    expect(trace.steps.at(-1)!.pointers.find((p) => p.name === 'top')!.index).toBe(3);
  });

  // Naming a pointer is the author saying what the reader should follow. The
  // operation's own cursor then adds a second arrow to the same cell saying
  // the same thing, so the slide that asked for `top` gets `top` alone.
  it('drops the operation cursor when the slide named a pointer', () => {
    const named = traceFor('dynamic-array', 'insert-last', {
      values: [42, 7],
      value: 15,
      capacity: 4,
      pointer: 'top',
    });
    expect(named.steps.flatMap((s) => s.pointers).map((p) => p.name)).not.toContain('i');

    // and keeps it when nobody did — the Queue act reads `j` through a shift.
    const bare = traceFor('array', 'remove-first', { values: [3, 8, 5], capacity: 6 });
    expect(bare.steps.flatMap((s) => s.pointers).map((p) => p.name)).toContain('j');
  });

  it('aims the pointer at the front when the operation works there', () => {
    const trace = traceFor('array', 'remove-first', {
      values: [3, 8, 5],
      capacity: 6,
      pointer: 'front',
    });
    expect(trace.steps[0]!.pointers.find((p) => p.name === 'front')!.index).toBe(0);
  });

  it('aims at nothing when the structure is empty', () => {
    const trace = traceFor('array', 'remove-last', { values: [7], capacity: 4, pointer: 'top' });
    expect(trace.steps.at(-1)!.pointers.find((p) => p.name === 'top')!.index).toBeNull();
  });

  it('leaves the list recipes alone — they name their own pointers', () => {
    const trace = traceFor('linked-list-singly', 'insert-first', {
      values: [7, 3],
      value: 9,
      pointer: 'top',
    });
    expect(trace.steps[0]!.pointers.some((p) => p.name === 'top')).toBe(false);
  });
});

describe('sequenceStepperTrace · an array asked for several runs', () => {
  // The array family animated ONE run, and #294 push slide needs four with
  // the block filling on the way. ADR-0074 had called the restriction a
  // workaround rather than a debt, on the grounds that "three runs of a
  // Theta(1) operation draw the same frame three times". A dynamic array
  // falsifies exactly that: the run that finds the block full draws a frame
  // none of the others draw.
  it('runs insert-last once per value, in order', () => {
    const trace = traceFor('dynamic-array', 'insert-last', {
      values: [42, 7],
      value: [15, 4, 9],
      capacity: 4,
    });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([42, 7, 15, 4, 9]);
  });

  it('grows exactly on the run that finds the block full', () => {
    const trace = traceFor('dynamic-array', 'insert-last', {
      values: [42, 7],
      value: [15, 4, 9, 23],
      capacity: 4,
    });
    const grows = trace.steps.filter((s) => s.kind === 'grow');
    expect(grows).toHaveLength(1);
    // Two starting elements plus 15 and 4 fill the block of four; the third
    // push is the one that has to double it.
    expect(grows[0]!.description).toMatch(/se copian los 4 elementos/);
    expect(trace.steps.at(-1)!.capacity).toBe(8);
  });

  it('runs remove-last `times` times and leaves the rest of the block', () => {
    const trace = traceFor('array', 'remove-last', {
      values: [42, 7, 15, 4, 9],
      times: 3,
      capacity: 6,
    });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([42, 7]);
    expect(trace.steps.filter((s) => s.kind === 'done')).toHaveLength(3);
  });

  it('still refuses more runs than a slide can show', () => {
    expect(() =>
      traceFor('array', 'remove-last', { values: [1, 2], times: 99, capacity: 40 }),
    ).toThrow(/Entre 1 y/i);
  });
});

// ── the heap recipe (#304) ────────────────────────────────────────────────
//
// `cells` is `data[1..]` in array order: cell `i` is the slot `k = i + 1`.
// `heapSize` is the listing's `n` — the cells past it are outside the heap
// (a stale copy after extractMax, the sorted tail during heapsort's
// sortdown). The property checked throughout is the listing's own:
// `data[k / 2] >= data[k]` for every `k` in `2..n`.

const heapOrdered = (cells: { value: number }[], n: number): boolean =>
  cells
    .slice(0, n)
    .every((c, i) => i === 0 || cells[Math.floor((i + 1) / 2) - 1]!.value >= c.value);

const HEAP_OPS = ['insert', 'extract-max', 'build-heap', 'heapsort'] as const;

describe('sequenceStepperTrace · heap-max · which operations it has', () => {
  it('offers exactly the four heap operations, and nothing else', () => {
    for (const operation of OPERATIONS) {
      expect(isValidCombination('heap-max', operation)).toBe(
        (HEAP_OPS as readonly string[]).includes(operation),
      );
    }
  });

  it('refuses the four heap operations on every sequence recipe', () => {
    for (const recipe of RECIPES.filter((r) => r !== 'heap-max')) {
      for (const operation of HEAP_OPS) {
        expect(isValidCombination(recipe, operation)).toBe(false);
      }
    }
  });
});

describe('sequenceStepperTrace · heap-max · insert', () => {
  const heap = [10, 8, 9, 3, 7];

  it('appends at data[++n] and swims the new value up to its place', () => {
    const trace = traceFor('heap-max', 'insert', { values: heap, value: 12, capacity: 8 });
    const last = trace.steps.at(-1)!;
    expect(last.cells.map((c) => c.value)).toEqual([12, 8, 10, 3, 7, 9]);
    expect(last.heapSize).toBe(6);
    expect(heapOrdered(last.cells, 6)).toBe(true);
  });

  it('draws each exchange as its own frame, with exactly the two cells being swapped', () => {
    const trace = traceFor('heap-max', 'insert', { values: heap, value: 12, capacity: 8 });
    const swaps = trace.steps.filter((s) => s.cells.some((c) => c.state === 'swap'));
    expect(swaps).toHaveLength(2);
    for (const s of swaps) {
      expect(s.cells.filter((c) => c.state === 'swap')).toHaveLength(2);
      expect(s.highlightLines).toContain(lineNo(trace, 'swap(k / 2, k);'));
    }
  });

  it('stops at the first parent that is not smaller, without a single swap', () => {
    const trace = traceFor('heap-max', 'insert', { values: heap, value: 1, capacity: 8 });
    expect(trace.steps.some((s) => s.cells.some((c) => c.state === 'swap'))).toBe(false);
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([10, 8, 9, 3, 7, 1]);
  });

  it('keeps the inserted value marked as new on the frame that stays on screen', () => {
    const trace = traceFor('heap-max', 'insert', { values: heap, value: [12, 2], capacity: 8 });
    const last = trace.steps.at(-1)!;
    expect(last.cells.filter((c) => c.state === 'new').map((c) => c.value)).toEqual([2]);
  });

  it('climbs all the way to the root and says it got there', () => {
    const trace = traceFor('heap-max', 'insert', { values: [5], value: 9, capacity: 4 });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual([9, 5]);
    expect(trace.steps.some((s) => /raíz/.test(s.description))).toBe(true);
  });

  it('grows a full block with resize, exactly as the dynamic array does', () => {
    // Default capacity is data.length = n + 1: the block starts FULL, like
    // the dynamic-array recipe's default.
    // The grow frame is the first one and already shows the doubled block,
    // which is what the dynamic array's own grow frame does.
    const trace = traceFor('heap-max', 'insert', { values: heap, value: 4 });
    const grow = trace.steps[0]!;
    expect(grow.kind).toBe('grow');
    expect(grow.capacity).toBe(2 * (heap.length + 1));
    expect(trace.steps.filter((s) => s.kind === 'grow')).toHaveLength(1);
    expect(grow.highlightLines).toContain(lineNo(trace, 'resize(2 * data.length);'));
  });

  it('runs once per value over the same heap, and the calling program names each call', () => {
    const trace = traceFor('heap-max', 'insert', {
      values: [],
      value: [8, 3, 10, 1, 7],
      capacity: 8,
    });
    const last = trace.steps.at(-1)!;
    expect(last.heapSize).toBe(5);
    expect(heapOrdered(last.cells, 5)).toBe(true);
    expect(trace.code).toContain('MaxHeap heap = new MaxHeap();');
    expect(trace.code).toContain('heap.insert(10);');
  });

  it('prints the 1-based listing with swim written out under insert', () => {
    const { code } = traceFor('heap-max', 'insert', { values: heap, value: 12, capacity: 8 });
    expect(code).toContain('data[++n] = x;');
    expect(code).toContain('swim(n);');
    expect(code).toContain('while (k > 1 && data[k / 2] < data[k])');
  });
});

describe('sequenceStepperTrace · heap-max · extract-max', () => {
  const heap = [12, 8, 10, 3, 7, 9];

  it('swaps the root with the last, shrinks n, and sinks the new root', () => {
    const trace = traceFor('heap-max', 'extract-max', { values: heap });
    const last = trace.steps.at(-1)!;
    expect(last.heapSize).toBe(5);
    expect(last.cells.slice(0, 5).map((c) => c.value)).toEqual([10, 8, 9, 3, 7]);
    expect(heapOrdered(last.cells, 5)).toBe(true);
    expect(last.description).toMatch(/12/);
  });

  it('leaves the old maximum in data[n + 1] as a copy nobody reads', () => {
    const trace = traceFor('heap-max', 'extract-max', { values: heap });
    const last = trace.steps.at(-1)!;
    expect(last.cells[5]).toMatchObject({ value: 12, state: 'stale' });
  });

  it('lights the sink lines while it sinks', () => {
    const trace = traceFor('heap-max', 'extract-max', { values: heap });
    const lit = new Set(trace.steps.flatMap((s) => s.highlightLines));
    expect(lit).toContain(lineNo(trace, 'if (j < n && data[j] < data[j + 1]) j++;'));
    expect(lit).toContain(lineNo(trace, 'swap(k, j);'));
  });

  it('runs `times` extractions in a row, each on the heap the previous one left', () => {
    const trace = traceFor('heap-max', 'extract-max', { values: heap, times: 3 });
    const last = trace.steps.at(-1)!;
    expect(last.heapSize).toBe(3);
    expect(heapOrdered(last.cells, 3)).toBe(true);
    // The three maxima sit past n, the latest first.
    expect(last.cells.slice(3).map((c) => c.value)).toEqual([9, 10, 12]);
  });

  it('refuses more extractions than the heap has elements', () => {
    expect(() => traceFor('heap-max', 'extract-max', { values: [3, 1], times: 3 })).toThrow();
  });

  it('refuses an extraction from an empty heap', () => {
    expect(() => traceFor('heap-max', 'extract-max', { values: [] })).toThrow();
  });

  it('refuses a starting array that is not a max-heap', () => {
    expect(() => traceFor('heap-max', 'extract-max', { values: [1, 5, 3] })).toThrow(/heap/);
    expect(() => traceFor('heap-max', 'insert', { values: [1, 5], value: 2 })).toThrow(/heap/);
  });
});

describe('sequenceStepperTrace · heap-max · build-heap and heapsort', () => {
  const unordered = [5, 2, 9, 1, 7, 3, 8, 4];

  it('build-heap sinks from n / 2 down to 1 and leaves a heap of the same values', () => {
    const trace = traceFor('heap-max', 'build-heap', { values: unordered });
    const last = trace.steps.at(-1)!;
    expect(heapOrdered(last.cells, unordered.length)).toBe(true);
    expect([...last.cells.map((c) => c.value)].sort((a, b) => a - b)).toEqual(
      [...unordered].sort((a, b) => a - b),
    );
    // The first sink runs at k = n / 2 = 4: the cursor lands on cell 3.
    const firstK = trace.steps.find((s) => s.pointers.some((p) => p.name === 'k'))!;
    expect(firstK.pointers.find((p) => p.name === 'k')!.index).toBe(3);
  });

  it('heapsort ends with the array ascending and every cell sorted', () => {
    const trace = traceFor('heap-max', 'heapsort', { values: unordered });
    const last = trace.steps.at(-1)!;
    expect(last.cells.map((c) => c.value)).toEqual([...unordered].sort((a, b) => a - b));
    expect(last.cells.every((c) => c.state === 'sorted')).toBe(true);
  });

  it('heapsort names its two phases, construction first', () => {
    const trace = traceFor('heap-max', 'heapsort', { values: unordered });
    const phases = trace.steps.map((s) => s.phase);
    const firstSort = phases.indexOf('sortdown');
    expect(phases[0]).toBe('construction');
    expect(firstSort).toBeGreaterThan(0);
    expect(phases.slice(firstSort).every((p) => p === 'sortdown')).toBe(true);
    // The construction phase hands the sortdown a heap.
    expect(heapOrdered(trace.steps[firstSort - 1]!.cells, unordered.length)).toBe(true);
  });

  it('keeps the sorted tail sorted and never smaller than the heap in front of it', () => {
    const trace = traceFor('heap-max', 'heapsort', { values: unordered });
    for (const s of trace.steps.filter((f) => f.phase === 'sortdown')) {
      const n = s.heapSize!;
      const tail = s.cells.slice(n).map((c) => c.value);
      expect(tail).toEqual([...tail].sort((a, b) => a - b));
      const heapMax = Math.max(...s.cells.slice(0, n).map((c) => c.value));
      expect(tail.every((v) => v >= heapMax)).toBe(true);
    }
  });

  it('draws the same sink under build-heap, extract-max and heapsort', () => {
    const sinkOf = (code: string) => code.slice(code.indexOf('void sink(int k)'));
    const a = traceFor('heap-max', 'build-heap', { values: unordered }).code;
    const b = traceFor('heap-max', 'extract-max', { values: [9, 5, 7] }).code;
    const c = traceFor('heap-max', 'heapsort', { values: unordered }).code;
    expect(sinkOf(a)).toBe(sinkOf(b));
    expect(sinkOf(c)).toBe(sinkOf(b));
  });
});

describe('sequenceStepperTrace · heap-max · every frame', () => {
  const cases: [SequenceOperation, Parameters<typeof traceFor>[2]][] = [
    ['insert', { values: [10, 8, 9, 3, 7], value: [12, 1, 11], capacity: 8 }],
    ['extract-max', { values: [12, 8, 10, 3, 7, 9], times: 4 }],
    ['build-heap', { values: [5, 2, 9, 1, 7, 3, 8, 4] }],
    ['heapsort', { values: [5, 2, 9, 1, 7, 3, 8, 4] }],
  ];

  it.each(cases)('%s: n never exceeds the cells drawn, and every lit line exists', (op, input) => {
    const trace = traceFor('heap-max', op, input);
    const lines = trace.code.split('\n').length;
    for (const s of trace.steps) {
      expect(s.heapSize).toBeDefined();
      expect(s.heapSize!).toBeLessThanOrEqual(s.cells.length);
      expect(s.capacity!).toBeGreaterThan(s.cells.length);
      for (const l of s.highlightLines) expect(l).toBeGreaterThanOrEqual(1);
      for (const l of s.highlightLines) expect(l).toBeLessThanOrEqual(lines);
    }
  });

  it.each(cases)('%s: the heap part is a heap again on the last frame', (op, input) => {
    const last = traceFor('heap-max', op, input).steps.at(-1)!;
    expect(heapOrdered(last.cells, last.heapSize!)).toBe(true);
  });
});

function lineNo(trace: SequenceTrace, fragment: string): number {
  return trace.code.split('\n').findIndex((l) => l.includes(fragment)) + 1;
}

describe('sequenceStepperTrace · heap-max · every size the widget accepts', () => {
  // Every n from 1 to the widget's cap, several orders each — not only the
  // powers of two the hand-picked cases happen to use
  // (teach-a-data-structure.md §Checklist: "one non-power-of-two N").
  // A fixed LCG keeps the orders the same on every run.
  let seed = 304;
  const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31);
  const shuffled = (n: number) => {
    const a = Array.from({ length: n }, (_, i) => (i * 7 + 3) % 23);
    for (let i = a.length - 1; i > 0; i -= 1) {
      const j = next() % (i + 1);
      [a[i], a[j]] = [a[j]!, a[i]!];
    }
    return a;
  };

  for (let n = 1; n <= 8; n += 1) {
    it(`n = ${n}: build-heap makes a heap and heapsort sorts`, () => {
      for (let round = 0; round < 5; round += 1) {
        const input = shuffled(n);
        const built = traceFor('heap-max', 'build-heap', { values: input }).steps.at(-1)!;
        expect(heapOrdered(built.cells, n), `${input}`).toBe(true);
        const sorted = traceFor('heap-max', 'heapsort', { values: input }).steps.at(-1)!;
        expect(
          sorted.cells.map((c) => c.value),
          `${input}`,
        ).toEqual([...input].sort((a, b) => a - b));
      }
    });
  }
});
