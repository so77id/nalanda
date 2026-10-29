import { describe, expect, it } from 'vitest';

import { hashKey } from './sequenceStepperHashTrace';
import {
  HASH_PROBING_OPERATIONS,
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceOperation,
  type SequenceStep,
  type SequenceTrace,
} from './sequenceStepperTrace';

/**
 * The hash table with linear probing (#326): the keys live in the array
 * itself, `keys`, and a parallel `boolean[] deleted` marks a key removed —
 * the class's choice (Miguel, S3), so a search passes over the mark and an
 * insertion may reuse it. The invariant every frame keeps: between the
 * position a key hashes to and the position it sits in there is no empty
 * cell.
 */

/**
 * M = 11 (hashes pinned against the JVM in sequenceStepperHashTrace.test.ts):
 * Mia 5, Alba 5 → 6, Julia 10, Pablo 10 → 0 (around the end); Nico and Eva
 * hash to 5 and are not in it. Cells: 0 Pablo · 5 Mia · 6 Alba · 10 Julia —
 * four used of eleven, so one more key still leaves the table at most half
 * full.
 */
const KEYS = ['Mia', 'Alba', 'Julia', 'Pablo'];
const M = 11;

const run = (
  operation: SequenceOperation,
  key: string | string[],
  extra: { keys?: string[]; deleted?: string[] } = {},
): SequenceTrace =>
  traceFor('hash-probing', operation, {
    values: [],
    keys: extra.keys ?? KEYS,
    deleted: extra.deleted,
    key,
    capacity: M,
  });

const lit = (trace: SequenceTrace, step: SequenceStep): string[] => {
  const lines = trace.code.split('\n');
  return step.highlightLines.map((n) => lines[n - 1]!.trim());
};

const keysOf = (step: SequenceStep) => step.probe!.cells.map((c) => c.key);
const marksOf = (step: SequenceStep) => step.probe!.cells.map((c) => c.deleted);

/** The invariant: no empty cell between where a key hashes and where it sits. */
function holds(step: SequenceStep): boolean {
  const cells = step.probe!.cells;
  return cells.every((cell, at) => {
    if (cell.key === null || cell.deleted) return true;
    for (let i = hashKey(cell.key, cells.length); i !== at; i = (i + 1) % cells.length) {
      if (cells[i]!.key === null) return false;
    }
    return true;
  });
}

describe('sequenceStepperTrace · hash-probing · which operations it has', () => {
  it('is a recipe of the widget, with search, insert and remove', () => {
    expect(RECIPES).toContain('hash-probing');
    expect([...HASH_PROBING_OPERATIONS].sort()).toEqual(['insert', 'remove', 'search']);
    for (const operation of OPERATIONS) {
      expect(isValidCombination('hash-probing', operation), operation).toBe(
        HASH_PROBING_OPERATIONS.includes(operation),
      );
    }
  });
});

describe('sequenceStepperTrace · hash-probing · the table the keys build', () => {
  it('puts each key in the first free cell from its hash on, around the end', () => {
    const first = run('search', 'Mia').steps[0]!;
    expect(keysOf(first)).toEqual([
      'Pablo',
      null,
      null,
      null,
      null,
      'Mia',
      'Alba',
      null,
      null,
      null,
      'Julia',
    ]);
    expect(marksOf(first).every((m) => m === false)).toBe(true);
    expect(first.probe!.size).toBe(4);
    expect(first.probe!.used).toBe(4);
    expect(holds(first)).toBe(true);
  });

  it('marks the keys a slide says were removed, and leaves them in their cells', () => {
    const first = run('search', 'Mia', { deleted: ['Alba'] }).steps[0]!;
    expect(first.probe!.cells[6]).toMatchObject({ key: 'Alba', deleted: true });
    expect(first.probe!.size).toBe(3);
    // A marked cell is still used: a search goes past it.
    expect(first.probe!.used).toBe(4);
  });
});

describe('sequenceStepperTrace · hash-probing · search', () => {
  it('starts at the hash and steps one cell at a time until it finds the key', () => {
    const trace = run('search', 'Pablo');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines[0]).toEqual(['public boolean contains(String key) {']);
    expect(lines[1]).toEqual(['int i = hash(key);']);
    expect(trace.steps[1]!.probe!.home).toBe(10);
    expect(trace.steps[1]!.probe!.at).toBe(10);
    // Julia is at 10; the next cell is 0, around the end of the array.
    const advance = trace.steps.find((s) => lit(trace, s)[0] === 'i = (i + 1) % keys.length;')!;
    expect(advance.probe!.at).toBe(0);
    const hit = trace.steps.find((s) => s.kind === 'found')!;
    expect(lit(trace, hit)).toEqual(['if (!deleted[i] && keys[i].equals(key)) return true;']);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Pablo» está en la tabla: se miraron 2 celdas, desde la posición 10.',
    );
  });

  it('stops at the first empty cell: the key cannot be past it', () => {
    const trace = run('search', 'Nico');
    const stop = trace.steps.at(-2)!;
    expect(lit(trace, stop)).toEqual(['while (keys[i] != null) {', 'return false;']);
    expect(stop.probe!.at).toBe(7);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Nico» no está: se miraron 2 celdas ocupadas desde la posición 5, hasta la celda vacía 7.',
    );
  });

  it('passes over a mark without stopping: the key may be after it', () => {
    const trace = run('search', 'Eva', { keys: [...KEYS, 'Eva'], deleted: ['Alba'] });
    const marked = trace.steps.find((s) => s.probe!.at === 6 && s.kind === 'compare')!;
    expect(marked.description).toBe('keys[6] tiene la marca de borrado: se sigue de largo.');
    expect(trace.steps.find((s) => s.kind === 'found')!.probe!.at).toBe(7);
  });
});

describe('sequenceStepperTrace · hash-probing · insert', () => {
  it('asks contains, then takes the first free cell from the hash on', () => {
    const trace = run('insert', 'Eva');
    const lines = trace.steps.map((s) => lit(trace, s)[0] ?? '');
    expect(lines[0]).toBe('public boolean add(String key) {');
    expect(lines).toContain('if (contains(key)) return false;');
    expect(lines).toContain('keys[i] = key;');
    expect(lines).toContain('deleted[i] = false;');
    const placed = trace.steps.find((s) => lit(trace, s)[0] === 'keys[i] = key;')!;
    expect(placed.probe!.at).toBe(7);
    expect(placed.probe!.cells[7]).toMatchObject({ key: 'Eva', state: 'new' });
    expect(holds(trace.steps.at(-1)!)).toBe(true);
    expect(trace.steps.at(-1)!.probe!.size).toBe(5);
  });

  it('checks the table stays at most half full before placing the key', () => {
    const trace = run('insert', 'Eva');
    const check = trace.steps.find((s) => lit(trace, s)[0]!.startsWith('if (2 * (used + 1)'))!;
    expect(lit(trace, check)).toEqual([
      'if (2 * (used + 1) > keys.length) resize(nextPrime(2 * keys.length));',
    ]);
    expect(check.description).toContain('no se redimensiona');
    expect(check.probe!.used).toBe(4);
  });

  it('counts a cell that was null in used, and only that one', () => {
    const fresh = run('insert', 'Eva');
    const counted = fresh.steps.find((s) => lit(fresh, s)[0] === 'if (keys[i] == null) used++;')!;
    expect(counted.probe!.used).toBe(5);
    expect(fresh.steps.at(-1)!.probe!.used).toBe(5);
    const reused = run('insert', 'Eva', { deleted: ['Alba'] });
    expect(reused.steps.at(-1)!.probe!.used).toBe(4);
  });

  it('refuses an insertion that would leave the table more than half full', () => {
    // Five used of eleven: a sixth passes the half, and add would resize.
    expect(() => run('insert', 'Nico', { keys: [...KEYS, 'Eva'] })).toThrow(/redimensiona/);
  });

  it('reuses a marked cell, and clears its mark', () => {
    const trace = run('insert', 'Eva', { deleted: ['Alba'] });
    const placed = trace.steps.find((s) => lit(trace, s)[0] === 'keys[i] = key;')!;
    expect(placed.probe!.at).toBe(6);
    const cleared = trace.steps.find((s) => lit(trace, s)[0] === 'deleted[i] = false;')!;
    expect(cleared.probe!.cells[6]).toMatchObject({ key: 'Eva', deleted: false });
  });

  it('refuses a key that is already there', () => {
    const trace = run('insert', 'Alba');
    expect(lit(trace, trace.steps.at(-2)!)).toEqual(['if (contains(key)) return false;']);
    expect(keysOf(trace.steps.at(-1)!)).toEqual(keysOf(trace.steps[0]!));
  });
});

describe('sequenceStepperTrace · hash-probing · remove', () => {
  it('marks the cell instead of emptying it, and says why', () => {
    const trace = run('remove', 'Alba');
    const marked = trace.steps.find((s) => lit(trace, s)[0] === 'deleted[i] = true;')!;
    expect(marked.probe!.cells[6]).toMatchObject({ key: 'Alba', deleted: true });
    expect(marked.description).toContain('la invariante');
    expect(trace.steps.at(-1)!.probe!.size).toBe(3);
    // The mark keeps the cell used.
    expect(trace.steps.at(-1)!.probe!.used).toBe(4);
    expect(holds(trace.steps.at(-1)!)).toBe(true);
  });

  it('answers false at the first empty cell when the key is not there', () => {
    const trace = run('remove', 'Nico');
    expect(lit(trace, trace.steps.at(-2)!)).toEqual(['while (keys[i] != null) {', 'return false;']);
    expect(marksOf(trace.steps.at(-1)!).every((m) => m === false)).toBe(true);
  });
});

describe('sequenceStepperTrace · hash-probing · authoring guards', () => {
  it('refuses a table more than half full, which the class would have resized', () => {
    expect(() =>
      traceFor('hash-probing', 'search', {
        values: [],
        keys: ['Mia', 'Alba', 'Eva'],
        key: 'Mia',
        capacity: 3,
      }),
    ).toThrow(/mitad/);
  });

  it('refuses a mark on a key the table does not hold', () => {
    expect(() => run('search', 'Mia', { deleted: ['Nico'] })).toThrow(/«Nico»/);
  });

  it('refuses a mark on the chaining table, which has no deleted array', () => {
    expect(() =>
      traceFor('hash-chaining', 'search', {
        values: [],
        keys: ['Mia'],
        deleted: ['Mia'],
        key: 'Mia',
        capacity: 7,
      }),
    ).toThrow(/sondeo/);
  });
});

describe('sequenceStepperTrace · hash-probing · a program of insertions or removals', () => {
  const program = (
    operation: 'insert' | 'remove',
    key: string[],
    extra: { keys?: string[]; deleted?: string[] } = {},
  ): SequenceTrace =>
    traceFor('hash-probing', operation, {
      values: [],
      keys: extra.keys ?? [],
      deleted: extra.deleted,
      key,
      capacity: M,
      program: true,
    });

  it('creates the table with its own class and calls the method once per key', () => {
    const trace = program('insert', ['Mia', 'Alba']);
    expect(trace.code.split('\n')).toEqual([
      'ProbingHashTable names = new ProbingHashTable(11);',
      'names.add("Mia");',
      'names.add("Alba");',
    ]);
    expect(trace.alongside).toBe(run('insert', 'Nico').code);
    // Alba collides with Mia at 5 and lands one cell further.
    expect(keysOf(trace.steps.at(-1)!)[6]).toBe('Alba');
    expect(trace.steps[0]!.probe!.at).toBeNull();
  });

  it('removes from the table the program built, its call lit while remove runs', () => {
    const trace = program('remove', ['Mia'], { keys: KEYS });
    const lines = trace.code.split('\n');
    expect(lines.at(-1)).toBe('names.remove("Mia");');
    expect(trace.steps.slice(1).every((s) => s.highlightLines[0] === lines.length)).toBe(true);
    expect(marksOf(trace.steps.at(-1)!)[5]).toBe(true);
  });

  it('refuses a starting table with marks: no program of adds writes one', () => {
    expect(() => program('remove', ['Mia'], { keys: KEYS, deleted: ['Alba'] })).toThrow(/marca/);
  });
});

describe('sequenceStepperTrace · hash-probing · insertions that grow the table', () => {
  // `grow` on the probing table (#326 review): add with its resize, and the
  // resize walked inside the run — the old arrays over the new ones, every
  // key that is not marked back in through add — from 2 cells to 5, to 11.
  const GROWN = ['Teo', 'Julia', 'Pia', 'Sol', 'Pablo'];
  const trace = traceFor('hash-probing', 'insert', {
    values: [],
    keys: [],
    key: GROWN,
    capacity: 2,
    grow: true,
  });
  const listing = (code: string, lit: number[] | undefined) =>
    (lit ?? []).map((n) => code.split('\n')[n - 1]!.trim());

  it('lists add with its resize call on a line of its own, and resize under it', () => {
    expect(trace.row!.map((l) => l.name)).toEqual(['add', 'resize']);
    // Two fifths of a slide do not hold the one-line check, so the comment
    // and the call each take two lines; the code is the same.
    const lines = trace.code.split('\n').map((l) => l.trim());
    expect(lines).toContain('if (2 * (used + 1) > keys.length)');
    expect(lines).toContain('resize(nextPrime(2 * keys.length));');
    expect(trace.beside).toBe(40);
    expect(trace.row![1]!.code).toContain('if (oldKeys[i] != null && !oldDeleted[i]) {');
  });

  it('grows from 2 cells to 5 and then to 11, before the second and the third key', () => {
    expect([...new Set(trace.steps.map((s) => s.probe!.cells.length))]).toEqual([2, 5, 11]);
    const starts = trace.steps.filter((s) => s.kind === 'start' && s.probe!.key !== '');
    expect(starts.map((s) => s.probe!.cells.length)).toEqual([2, 2, 5, 11, 11]);
    const olds = trace.steps.filter((s) => s.probe!.old !== undefined);
    expect([...new Set(olds.map((s) => s.probe!.old!.cells.length))]).toEqual([2, 5]);
  });

  it('keeps the call to resize lit in add while resize runs', () => {
    const inside = trace.steps.filter((s) => (s.rowLines?.[1] ?? []).length > 0);
    expect(inside.length).toBeGreaterThan(0);
    for (const step of inside) {
      expect(listing(trace.code, step.rowLines![0])).toEqual([
        'if (2 * (used + 1) > keys.length)',
        'resize(nextPrime(2 * keys.length));',
      ]);
    }
  });

  it('puts every old key back in the first free cell from its hash in the new table', () => {
    const settled = trace.steps.filter(
      (s, i) => s.probe!.old === undefined && trace.steps[i - 1]?.probe!.old !== undefined,
    );
    expect(settled.map((s) => keysOf(s))).toEqual([
      [null, 'Teo', null, null, null],
      [null, null, null, null, 'Teo', null, null, null, null, null, 'Julia'],
    ]);
  });

  it('ends with Pia past the end, and Sol and Pablo on the cluster that crosses it', () => {
    const last = trace.steps.at(-1)!;
    expect(keysOf(last)).toEqual([
      'Pia',
      'Sol',
      'Pablo',
      null,
      'Teo',
      null,
      null,
      null,
      null,
      null,
      'Julia',
    ]);
    expect(holds(last)).toBe(true);
    expect(last.probe!.used).toBe(GROWN.length);
  });

  it('names the keys of the run in the header, and sizes the drawing for both tables', () => {
    expect(trace.queue).toEqual(GROWN);
    expect(trace.steps.at(-1)!.queue).toEqual({ done: GROWN.length, at: null });
    expect(trace.probe).toEqual({ buckets: 11, oldBuckets: 5 });
  });
});
