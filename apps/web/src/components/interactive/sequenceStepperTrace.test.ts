import { describe, expect, it } from 'vitest';

import {
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceOperation,
  type SequenceRecipe,
} from './sequenceStepperTrace';

/**
 * The trace is the widget's whole truth: the paint is derived from it, and
 * jsdom can check it exactly (the recipe of `apps/web/CLAUDE.md` §2 — "the way
 * out is to not measure"). What the browser is left to confirm is only that
 * the frames look right.
 */

const values = [7, 3, 1, 5];

describe('sequenceStepperTrace · the valid combinations', () => {
  it('rejects insert-ordered on the two array recipes and accepts it on every list', () => {
    expect(isValidCombination('array', 'insert-ordered')).toBe(false);
    expect(isValidCombination('dynamic-array', 'insert-ordered')).toBe(false);
    for (const recipe of RECIPES) {
      if (recipe.startsWith('linked-list')) {
        expect(isValidCombination(recipe, 'insert-ordered')).toBe(true);
      }
    }
  });

  it('accepts every other recipe × operation pair', () => {
    for (const recipe of RECIPES) {
      for (const operation of OPERATIONS) {
        if (operation === 'insert-ordered' && !recipe.startsWith('linked-list')) continue;
        expect(isValidCombination(recipe, operation)).toBe(true);
      }
    }
  });

  // Rule 11 of the widget guide: every valid combination is a fixture, so a
  // change to one animation cannot silently break another.
  it('produces a walkable trace with a listing for every valid combination', () => {
    for (const recipe of RECIPES) {
      for (const operation of OPERATIONS) {
        if (!isValidCombination(recipe, operation)) continue;
        const trace = traceFor(recipe, operation, {
          // insert-ordered is the one operation with a precondition on the
          // input, and it is the widget's job to refuse an unsorted one — so
          // this sweep hands it a sorted list rather than exempting it.
          values: operation === 'insert-ordered' ? [1, 3, 7, 9] : values,
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
    for (const recipe of RECIPES) {
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
          values: operation === 'insert-ordered' ? [1, 3, 7, 9] : values,
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
  it('opens a hole that travels as insert-first copies right', () => {
    const trace = traceFor('array', 'insert-first', { values, value: 9 });
    const shifts = trace.steps.filter((s) => s.kind === 'shift');
    expect(shifts).toHaveLength(values.length);
    for (const step of shifts) {
      // Mid-shift the block always holds exactly one hole among the occupied
      // range — the slot the last copy vacated.
      const occupied = step.slots!.map((s) => s !== null);
      const lastFull = occupied.lastIndexOf(true);
      const holes = occupied.slice(0, lastFull).filter((o) => !o).length;
      expect(holes).toBe(1);
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
    for (const recipe of RECIPES) {
      const { code } = traceFor(recipe, 'insert-first', { values, value: 9 });
      // The array and the dynamic array legitimately share insert-first's
      // shift loop; the three list recipes must each differ from the arrays.
      if (recipe.startsWith('linked-list')) {
        expect(code).toContain('Nodo');
      } else {
        expect(code).not.toContain('Nodo');
      }
      seen.set(code, recipe);
    }
    expect(seen.size).toBeGreaterThan(1);
  });
});
