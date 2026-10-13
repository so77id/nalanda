import { describe, expect, it } from 'vitest';

import { hashKey } from './sequenceStepperHashTrace';
import {
  HASH_CHAINING_OPERATIONS,
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceOperation,
  type SequenceStep,
  type SequenceTrace,
} from './sequenceStepperTrace';

/**
 * The hash table with chaining (#326): an array of `M` lists, each key in the
 * list of the position its hash names. As with every recipe, the frames are
 * the widget's whole truth and are pinned here exactly; the browser is left
 * only "does it look right" (`apps/web/CLAUDE.md` §2).
 */

/**
 * Inserted in this order, each at the front of its list, they leave
 * 0: Bea · 1: Juan → Eva · 4: Sara → Ana · 6: Leo, and 2, 3, 5 empty.
 */
const KEYS = ['Ana', 'Bea', 'Eva', 'Leo', 'Sara', 'Juan'];
const M = 7;

const run = (operation: SequenceOperation, key: string | string[], keys = KEYS): SequenceTrace =>
  traceFor('hash-chaining', operation, { values: [], keys, key, capacity: M });

/** The text of the lines a frame lights, trimmed. */
const lit = (trace: SequenceTrace, step: SequenceStep): string[] => {
  const lines = trace.code.split('\n');
  return step.highlightLines.map((n) => lines[n - 1]!.trim());
};

const chains = (step: SequenceStep): string[][] =>
  step.hash!.chains.map((chain) => chain.map((n) => n.key));

describe('sequenceStepperHashTrace · the hash the listing computes', () => {
  // Computed by the JVM (eclipse-temurin:21) running the class's own
  // `hash(String key)` — `h = (31 * h + key.charAt(i)) % table.length` — so
  // the number the widget draws is the number the student's program prints.
  it('matches Java for every key the examples use', () => {
    const java: Record<number, Record<string, number>> = {
      3: { Ana: 2, Bea: 0, Eva: 2, Leo: 0, Sara: 1, Juan: 2 },
      5: { Ana: 2, Bea: 4, Eva: 4, Leo: 3, Sara: 1, Juan: 3 },
      7: {
        Ana: 4,
        Bea: 0,
        Eva: 1,
        Leo: 6,
        Luis: 0,
        Sara: 4,
        Juan: 1,
        Pia: 5,
        Ema: 2,
        Ivan: 4,
        Mia: 6,
      },
      11: { Ana: 5, Bea: 5, Eva: 5, Leo: 4, Sara: 0, Juan: 1, Olga: 10, Tomas: 10 },
    };
    for (const [m, expected] of Object.entries(java)) {
      for (const [key, h] of Object.entries(expected)) {
        expect(hashKey(key, Number(m)), `hash("${key}") con M = ${m}`).toBe(h);
      }
    }
  });
});

describe('sequenceStepperTrace · hash-chaining · which operations it has', () => {
  it('is a recipe of the widget', () => {
    expect(RECIPES).toContain('hash-chaining');
  });

  it('searches, inserts, removes a key and resizes, and nothing else', () => {
    expect([...HASH_CHAINING_OPERATIONS].sort()).toEqual(['insert', 'remove', 'resize', 'search']);
    for (const operation of OPERATIONS) {
      expect(isValidCombination('hash-chaining', operation), operation).toBe(
        HASH_CHAINING_OPERATIONS.includes(operation),
      );
    }
  });

  it('keeps `remove` on the two hash tables and the search trees, and `resize` on this table', () => {
    for (const recipe of RECIPES) {
      const removes = recipe.startsWith('hash-') || recipe === 'bst' || recipe === 'avl';
      expect(isValidCombination(recipe, 'remove'), recipe).toBe(removes);
      expect(isValidCombination(recipe, 'resize'), recipe).toBe(recipe === 'hash-chaining');
    }
  });
});

describe('sequenceStepperTrace · hash-chaining · the table the keys build', () => {
  it('puts every key in the list of its position, the newest at the front', () => {
    const first = run('search', 'Ana').steps[0]!;
    expect(chains(first)).toEqual([['Bea'], ['Juan', 'Eva'], [], [], ['Sara', 'Ana'], [], ['Leo']]);
  });

  it('counts every key as a cell, so the size readout is the table’s size', () => {
    expect(run('search', 'Ana').steps[0]!.cells).toHaveLength(KEYS.length);
  });

  it('starts with no position chosen: the hash is computed by a line of its own', () => {
    const first = run('search', 'Ana').steps[0]!;
    expect(first.hash!.key).toBe('Ana');
    expect(first.hash!.bucket).toBeNull();
  });
});

describe('sequenceStepperTrace · hash-chaining · search', () => {
  it('goes straight to the list of its position and compares only there', () => {
    const trace = run('search', 'Ana');
    const [start, hashed] = trace.steps;
    expect(lit(trace, start!)).toEqual(['boolean contains(String key) {']);
    expect(lit(trace, hashed!)).toEqual(['Node current = table[hash(key)];']);
    expect(hashed!.hash!.bucket).toBe(4);
    expect(hashed!.hash!.pointers).toEqual([{ name: 'current', node: chainIds(hashed!, 4)[0] }]);
    // Only the two nodes of position 4 are ever looked at.
    const touched = new Set(
      trace.steps.flatMap((s) =>
        s.hash!.chains.flatMap((c) => c.filter((n) => n.state !== 'idle').map((n) => n.key)),
      ),
    );
    expect([...touched].sort()).toEqual(['Ana', 'Sara']);
  });

  it('finds a key behind another one, after one step along the list', () => {
    const trace = run('search', 'Ana');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['current = current.next;']);
    const hit = trace.steps.find((s) => s.kind === 'found')!;
    expect(lit(trace, hit)).toEqual(['if (current.key.equals(key)) return true;']);
    expect(hit.hash!.chains[4]!.map((n) => n.state)).toEqual(['visited', 'found']);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Ana» está en la tabla: se comparó con 2 claves, todas de la lista de la posición 4.',
    );
  });

  it('answers false at once over an empty list', () => {
    const trace = run('search', 'Pia');
    const [, hashed, end] = trace.steps;
    expect(hashed!.hash!.bucket).toBe(5);
    expect(hashed!.hash!.pointers).toEqual([{ name: 'current', node: null }]);
    expect(lit(trace, end!)).toEqual(['while (current != null) {', 'return false;']);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Pia» no está: la lista de la posición 5 está vacía y no se comparó ninguna clave.',
    );
  });

  it('answers false when the list runs out, having compared only that list', () => {
    const trace = run('search', 'Ivan');
    expect(trace.steps.at(-1)!.description).toBe(
      '«Ivan» no está: se comparó con las 2 claves de la lista de la posición 4.',
    );
  });

  it('searches several keys over the same table, one run each', () => {
    const trace = run('search', ['Ana', 'Pia']);
    expect(trace.steps.filter((s) => s.kind === 'start')).toHaveLength(2);
  });
});

/** The ids of the nodes of one list, front first. */
function chainIds(step: SequenceStep, bucket: number): number[] {
  return step.hash!.chains[bucket]!.map((n) => n.id);
}

describe('sequenceStepperTrace · hash-chaining · insert', () => {
  it('runs the lines of add in order, one frame per line', () => {
    const trace = run('insert', 'Ema');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toEqual([
      ['boolean add(String key) {'],
      ['if (contains(key)) return false;'],
      ['int i = hash(key);'],
      ['Node fresh = new Node(key);'],
      ['fresh.next = table[i];'],
      ['table[i] = fresh;'],
      ['size++;'],
      ['return true;'],
      // Every run ends on a settled frame that lights nothing, as search does.
      [],
    ]);
  });

  it('builds the node apart, links it, and only then lets it into the list', () => {
    // Teo hashes to 1, in front of Juan → Eva.
    const trace = run('insert', 'Teo');
    const at = (line: string) => trace.steps.find((s) => lit(trace, s)[0] === line)!;
    const created = at('Node fresh = new Node(key);');
    expect(created.hash!.fresh).toEqual({ id: expect.any(Number), key: 'Teo', held: false });
    const linked = at('fresh.next = table[i];');
    expect(linked.hash!.fresh!.next).toBe(chainIds(linked, 1)[0]);
    const held = at('table[i] = fresh;');
    expect(held.hash!.fresh!.held).toBe(true);
    // Until `size++` the list still reads the way it did.
    expect(chains(held)[1]).toEqual(['Juan', 'Eva']);
    const landed = at('size++;');
    expect(landed.hash!.fresh).toBeUndefined();
    expect(chains(landed)[1]).toEqual(['Teo', 'Juan', 'Eva']);
    expect(landed.hash!.chains[1]![0]!.state).toBe('new');
    expect(landed.cells).toHaveLength(KEYS.length + 1);
  });

  it('links a node into an empty list with next = null', () => {
    const trace = run('insert', 'Ema');
    const linked = trace.steps.find((s) => lit(trace, s)[0] === 'fresh.next = table[i];')!;
    expect(linked.hash!.bucket).toBe(2);
    expect(linked.hash!.fresh!.next).toBeNull();
  });

  it('refuses a key that is already there, and leaves the table as it was', () => {
    const trace = run('insert', 'Sara');
    const last = trace.steps.at(-1)!;
    expect(lit(trace, trace.steps.at(-2)!)).toEqual(['if (contains(key)) return false;']);
    expect(chains(last)).toEqual(chains(trace.steps[0]!));
    expect(last.cells).toHaveLength(KEYS.length);
    expect(trace.steps.some((s) => s.hash!.fresh !== undefined)).toBe(false);
  });

  it('grows the table one key per run when given several', () => {
    const trace = run('insert', ['Ema', 'Pia'], []);
    expect(chains(trace.steps.at(-1)!)).toEqual([[], [], ['Ema'], [], [], ['Pia'], []]);
  });
});

describe('sequenceStepperTrace · hash-chaining · remove', () => {
  it('removes the first node of a list by moving table[i]', () => {
    const trace = run('remove', 'Sara');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['table[i] = table[i].next;']);
    expect(lines).not.toContainEqual(['Node prev = table[i];']);
    expect(chains(trace.steps.at(-1)!)[4]).toEqual(['Ana']);
  });

  it('removes a node further along through prev, without a node of its own in front', () => {
    const trace = run('remove', 'Ana');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['Node prev = table[i];']);
    const unlinked = trace.steps.find((s) => lit(trace, s)[0] === 'prev.next = prev.next.next;')!;
    // The node is still drawn on the frame that skips it, leaving.
    expect(unlinked.hash!.chains[4]!.map((n) => [n.key, n.state])).toEqual([
      ['Sara', 'active'],
      ['Ana', 'leaving'],
    ]);
    expect(unlinked.hash!.bypass).toEqual({ bucket: 4, from: 0 });
    expect(chains(trace.steps.at(-1)!)[4]).toEqual(['Sara']);
    expect(trace.steps.at(-1)!.cells).toHaveLength(KEYS.length - 1);
  });

  it('answers false over an empty list without looking at anything', () => {
    const trace = run('remove', 'Pia');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['if (table[i] == null) return false;']);
    expect(chains(trace.steps.at(-1)!)).toEqual(chains(trace.steps[0]!));
  });

  it('answers false when the key is not in its list', () => {
    const trace = run('remove', 'Ivan');
    expect(lit(trace, trace.steps.at(-2)!)).toEqual([
      'while (prev.next != null) {',
      'return false;',
    ]);
    expect(chains(trace.steps.at(-1)!)).toEqual(chains(trace.steps[0]!));
  });
});

describe('sequenceStepperTrace · hash-chaining · the invariant holds when each run ends', () => {
  it('leaves every key in the list of its position, and none twice', () => {
    const cases: [SequenceOperation, string][] = [
      ['search', 'Ana'],
      ['search', 'Pia'],
      ['insert', 'Teo'],
      ['insert', 'Sara'],
      ['remove', 'Ana'],
      ['remove', 'Sara'],
      ['remove', 'Ivan'],
    ];
    for (const [operation, key] of cases) {
      const last = run(operation, key).steps.at(-1)!;
      const seen = new Set<string>();
      last.hash!.chains.forEach((chain, bucket) => {
        for (const node of chain) {
          expect(hashKey(node.key, M), `${operation} ${key}: ${node.key}`).toBe(bucket);
          expect(seen.has(node.key), `${operation} ${key}: ${node.key} repetida`).toBe(false);
          seen.add(node.key);
        }
      });
      expect(
        last.cells.every((c) => c.state !== 'active'),
        `${operation} ${key}`,
      ).toBe(true);
    }
  });

  it('names the invariant where an operation changes a list', () => {
    for (const [operation, key] of [
      ['insert', 'Teo'],
      ['remove', 'Ana'],
    ] as const) {
      const trace = run(operation, key);
      expect(
        trace.steps.some((s) => s.description.includes('la invariante')),
        `${operation} ${key}`,
      ).toBe(true);
    }
  });
});

describe('sequenceStepperTrace · hash-chaining · authoring guards', () => {
  it('refuses a key written twice: a table keeps each key once', () => {
    expect(() => run('search', 'Ana', ['Ana', 'Bea', 'Ana'])).toThrow(/«Ana».*dos veces/);
  });

  it('refuses a table smaller than 2 or larger than 11 positions', () => {
    for (const capacity of [1, 12, 2.5]) {
      expect(
        () => traceFor('hash-chaining', 'search', { values: [], keys: KEYS, key: 'Ana', capacity }),
        String(capacity),
      ).toThrow(/posiciones/);
    }
  });

  it('asks for the key the operation works with', () => {
    expect(() =>
      traceFor('hash-chaining', 'search', { values: [], keys: KEYS, capacity: M }),
    ).toThrow(/clave/);
  });

  it('caps the runs like every other recipe', () => {
    expect(() =>
      run(
        'search',
        Array.from({ length: 13 }, () => 'Ana'),
      ),
    ).toThrow(/Entre 1 y 12/);
  });
});

describe('sequenceStepperTrace · hash-chaining · resize', () => {
  // Three keys over three positions — size == table.length, the moment add
  // resizes (#326). With 3 positions: 0: Bea · 2: Eva → Ana. The new table has
  // nextPrime(2 · 3) = 7, where Bea, Eva and Ana fall in 0, 1 and 4: the
  // class's running table before Leo, Sara and Juan arrive.
  const resize = () =>
    traceFor('hash-chaining', 'resize', { values: [], keys: ['Ana', 'Bea', 'Eva'], capacity: 3 });

  it('grows to the prime after twice the positions', () => {
    const trace = resize();
    expect(trace.hash).toEqual({ buckets: 7, longest: 2, oldBuckets: 3 });
  });

  it('runs the lines of resize in order, every key back in through add', () => {
    const trace = resize();
    const lines = trace.steps.map((s) => lit(trace, s)[0] ?? '');
    expect(lines.slice(0, 4)).toEqual([
      'private void resize(int capacity) {',
      'Node[] old = table;',
      'table = new Node[capacity];',
      'size = 0;',
    ]);
    expect(lines.filter((l) => l === 'add(current.key);')).toHaveLength(3);
  });

  it('keeps the old table on screen as old while the new one fills', () => {
    const trace = resize();
    const at = (line: string) => trace.steps.find((s) => lit(trace, s)[0] === line)!;
    const kept = at('Node[] old = table;');
    expect(kept.hash!.old!.aliased).toBe(true);
    expect(kept.hash!.old!.chains.map((c) => c.map((n) => n.key))).toEqual([
      ['Bea'],
      [],
      ['Eva', 'Ana'],
    ]);
    const fresh = at('table = new Node[capacity];');
    expect(fresh.hash!.old!.aliased).toBe(false);
    expect(chains(fresh)).toEqual([[], [], [], [], [], [], []]);
    expect(fresh.description).toContain('la invariante');
  });

  it('counts size from zero again, one add at a time', () => {
    const trace = resize();
    const sizes = trace.steps.map((s) => s.hash!.size);
    expect(sizes[0]).toBe(3);
    expect(sizes.at(-1)).toBe(3);
    expect(sizes).toContain(0);
    const zero = sizes.indexOf(0);
    expect(sizes.slice(zero)).toEqual([...sizes.slice(zero)].sort((a, b) => a - b));
  });

  it('says where each key was and where it goes now', () => {
    const trace = resize();
    const moves = trace.steps.filter((s) => lit(trace, s)[0] === 'add(current.key);');
    expect(moves.map((s) => s.description)).toEqual([
      'add(«Bea»): con 7 posiciones, hash(«Bea») = 0; con 3 también era 0.',
      'add(«Eva»): con 7 posiciones, hash(«Eva») = 1; con 3 era 2.',
      'add(«Ana»): con 7 posiciones, hash(«Ana») = 4; con 3 era 2.',
    ]);
    expect(moves.map((s) => s.hash!.bucket)).toEqual([0, 1, 4]);
  });

  it('ends with every key in the list of its position in the new table, and old gone', () => {
    const last = resize().steps.at(-1)!;
    expect(last.hash!.old).toBeUndefined();
    expect(chains(last)).toEqual([['Bea'], ['Eva'], [], [], ['Ana'], [], []]);
    for (const [bucket, chain] of last.hash!.chains.entries()) {
      for (const node of chain) expect(hashKey(node.key, 7)).toBe(bucket);
    }
    expect(last.description).toContain('la invariante');
  });

  it('refuses a resize the drawing cannot hold', () => {
    expect(() =>
      traceFor('hash-chaining', 'resize', { values: [], keys: ['Ana'], capacity: 7 }),
    ).toThrow(/17 posiciones/);
  });
});
