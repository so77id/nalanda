import { describe, expect, it } from 'vitest';

import {
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
            values: operation === 'insert-ordered' ? [1, 3, 7, 9] : values,
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
    for (const recipe of RECIPES) {
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
    // Θ(1) each: the counter grows by the same amount on every insertion.
    const done = trace.steps.filter((s) => s.kind === 'done').map((s) => s.cost);
    expect(done.map((c, i) => (i === 0 ? c : c - done[i - 1]!))).toEqual([4, 4, 4, 4]);
  });

  it('insertLast from empty ends in order, walking one node more each time', () => {
    const trace = traceFor('linked-list-singly', 'insert-last', { values: [], value: four });
    expect(trace.steps.at(-1)!.cells.map((c) => c.value)).toEqual(four);
    // The first insertion takes the empty branch and walks nothing; after it,
    // the walk is as long as the chain — 0, 1, 2 hops. That IS the Θ(N).
    expect(trace.steps.filter((s) => s.kind === 'walk')).toHaveLength(0 + 0 + 1 + 2);
    const done = trace.steps.filter((s) => s.kind === 'done').map((s) => s.cost);
    expect(done.map((c, i) => (i === 0 ? c : c - done[i - 1]!))).toEqual([4, 5, 6, 7]);
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
    const perRun = (t: SequenceTrace) => {
      const ends = t.steps.filter((s) => s.kind === 'done').map((s) => s.cost);
      return ends.map((c, i) => (i === 0 ? c : c - ends[i - 1]!));
    };
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
