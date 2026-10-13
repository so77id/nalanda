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
 * Ana 5, Bea 5 → 6, Leo 4, Olga 10, Tomas 10 → 0 (around the end).
 * Cells: 0 Tomas · 4 Leo · 5 Ana · 6 Bea · 10 Olga.
 */
const KEYS = ['Ana', 'Bea', 'Leo', 'Olga', 'Tomas'];
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
    const first = run('search', 'Ana').steps[0]!;
    expect(keysOf(first)).toEqual([
      'Tomas',
      null,
      null,
      null,
      'Leo',
      'Ana',
      'Bea',
      null,
      null,
      null,
      'Olga',
    ]);
    expect(marksOf(first).every((m) => m === false)).toBe(true);
    expect(first.probe!.size).toBe(5);
    expect(holds(first)).toBe(true);
  });

  it('marks the keys a slide says were removed, and leaves them in their cells', () => {
    const first = run('search', 'Ana', { deleted: ['Bea'] }).steps[0]!;
    expect(first.probe!.cells[6]).toMatchObject({ key: 'Bea', deleted: true });
    expect(first.probe!.size).toBe(4);
  });
});

describe('sequenceStepperTrace · hash-probing · search', () => {
  it('starts at the hash and steps one cell at a time until it finds the key', () => {
    const trace = run('search', 'Tomas');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines[0]).toEqual(['boolean contains(String key) {']);
    expect(lines[1]).toEqual(['int i = hash(key);']);
    expect(trace.steps[1]!.probe!.home).toBe(10);
    expect(trace.steps[1]!.probe!.at).toBe(10);
    // Olga is at 10; the next cell is 0, around the end of the array.
    const advance = trace.steps.find((s) => lit(trace, s)[0] === 'i = (i + 1) % keys.length;')!;
    expect(advance.probe!.at).toBe(0);
    const hit = trace.steps.find((s) => s.kind === 'found')!;
    expect(lit(trace, hit)).toEqual(['if (!deleted[i] && keys[i].equals(key)) {', 'return true;']);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Tomas» está en la tabla: se miraron 2 celdas, desde la posición 10.',
    );
  });

  it('stops at the first empty cell: the key cannot be past it', () => {
    const trace = run('search', 'Lia');
    const stop = trace.steps.at(-2)!;
    expect(lit(trace, stop)).toEqual(['while (keys[i] != null) {', 'return false;']);
    expect(stop.probe!.at).toBe(7);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Lia» no está: se miraron 3 celdas ocupadas desde la posición 4, hasta la celda vacía 7.',
    );
  });

  it('passes over a mark without stopping: the key may be after it', () => {
    const trace = run('search', 'Eva', { keys: [...KEYS, 'Eva'], deleted: ['Bea'] });
    const marked = trace.steps.find((s) => s.probe!.at === 6 && s.kind === 'compare')!;
    expect(marked.description).toBe('keys[6] tiene la marca de borrado: se sigue de largo.');
    expect(trace.steps.find((s) => s.kind === 'found')!.probe!.at).toBe(7);
  });
});

describe('sequenceStepperTrace · hash-probing · insert', () => {
  it('asks contains, then takes the first free cell from the hash on', () => {
    const trace = run('insert', 'Eva');
    const lines = trace.steps.map((s) => lit(trace, s)[0] ?? '');
    expect(lines[0]).toBe('boolean add(String key) {');
    expect(lines).toContain('if (contains(key)) {');
    expect(lines).toContain('keys[i] = key;');
    expect(lines).toContain('deleted[i] = false;');
    const placed = trace.steps.find((s) => lit(trace, s)[0] === 'keys[i] = key;')!;
    expect(placed.probe!.at).toBe(7);
    expect(placed.probe!.cells[7]).toMatchObject({ key: 'Eva', state: 'new' });
    expect(holds(trace.steps.at(-1)!)).toBe(true);
    expect(trace.steps.at(-1)!.probe!.size).toBe(6);
  });

  it('reuses a marked cell, and clears its mark', () => {
    const trace = run('insert', 'Eva', { deleted: ['Bea'] });
    const placed = trace.steps.find((s) => lit(trace, s)[0] === 'keys[i] = key;')!;
    expect(placed.probe!.at).toBe(6);
    const cleared = trace.steps.find((s) => lit(trace, s)[0] === 'deleted[i] = false;')!;
    expect(cleared.probe!.cells[6]).toMatchObject({ key: 'Eva', deleted: false });
  });

  it('refuses a key that is already there', () => {
    const trace = run('insert', 'Bea');
    expect(lit(trace, trace.steps.at(-2)!)).toEqual(['if (contains(key)) {', 'return false;']);
    expect(keysOf(trace.steps.at(-1)!)).toEqual(keysOf(trace.steps[0]!));
  });
});

describe('sequenceStepperTrace · hash-probing · remove', () => {
  it('marks the cell instead of emptying it, and says why', () => {
    const trace = run('remove', 'Bea');
    const marked = trace.steps.find((s) => lit(trace, s)[0] === 'deleted[i] = true;')!;
    expect(marked.probe!.cells[6]).toMatchObject({ key: 'Bea', deleted: true });
    expect(marked.description).toContain('la invariante');
    expect(trace.steps.at(-1)!.probe!.size).toBe(4);
    expect(holds(trace.steps.at(-1)!)).toBe(true);
  });

  it('answers false at the first empty cell when the key is not there', () => {
    const trace = run('remove', 'Lia');
    expect(lit(trace, trace.steps.at(-2)!)).toEqual(['while (keys[i] != null) {', 'return false;']);
    expect(marksOf(trace.steps.at(-1)!).every((m) => m === false)).toBe(true);
  });
});

describe('sequenceStepperTrace · hash-probing · authoring guards', () => {
  it('keeps at least one cell empty, or a search would never stop', () => {
    expect(() =>
      traceFor('hash-probing', 'search', {
        values: [],
        keys: ['Ana', 'Bea', 'Eva'],
        key: 'Ana',
        capacity: 3,
      }),
    ).toThrow(/celda vacía/);
  });

  it('refuses a mark on a key the table does not hold', () => {
    expect(() => run('search', 'Ana', { deleted: ['Lia'] })).toThrow(/«Lia»/);
  });

  it('refuses a mark on the chaining table, which has no deleted array', () => {
    expect(() =>
      traceFor('hash-chaining', 'search', {
        values: [],
        keys: ['Ana'],
        deleted: ['Ana'],
        key: 'Ana',
        capacity: 7,
      }),
    ).toThrow(/sondeo/);
  });
});
