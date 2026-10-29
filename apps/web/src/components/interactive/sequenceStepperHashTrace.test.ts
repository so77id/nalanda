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
 * 0: Eva · 1: Juan · 2: Leo → Ana · 3: Bea · 4: Sara, and 5, 6 empty.
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
  // `hash(String key)` — `h = (256 * h + key.charAt(i)) % table.length` — so
  // the number the widget draws is the number the student's program prints.
  it('matches Java for every key the examples use', () => {
    const java: Record<number, Record<string, number>> = {
      3: { Ana: 2, Bea: 0, Eva: 2, Leo: 0, Sara: 1, Juan: 2 },
      5: { Ana: 2, Bea: 4, Eva: 4, Leo: 3, Sara: 1, Juan: 3 },
      7: {
        Ana: 2,
        Bea: 3,
        Eva: 0,
        Leo: 2,
        Sara: 4,
        Juan: 1,
        Pia: 5,
        Ema: 6,
        Ivan: 2,
        Teo: 4,
        // The chaining act's absent key.
        Carla: 2,
      },
      11: {
        Mia: 5,
        Alba: 5,
        Eva: 5,
        Nico: 5,
        Julia: 10,
        Pablo: 10,
        Sara: 0,
        Bea: 4,
        // A key with an accent hashes by its UTF-16 code, 'á' = 225, as
        // charAt reads it.
        Iván: 1,
      },
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
    expect(chains(first)).toEqual([['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []]);
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
    expect(lit(trace, start!)).toEqual(['public boolean contains(String key) {']);
    expect(lit(trace, hashed!)).toEqual(['Node current = table[hash(key)];']);
    expect(hashed!.hash!.bucket).toBe(2);
    expect(hashed!.hash!.pointers).toEqual([{ name: 'current', node: chainIds(hashed!, 2)[0] }]);
    // Only the two nodes of position 2 are ever looked at.
    const touched = new Set(
      trace.steps.flatMap((s) =>
        s.hash!.chains.flatMap((c) => c.filter((n) => n.state !== 'idle').map((n) => n.key)),
      ),
    );
    expect([...touched].sort()).toEqual(['Ana', 'Leo']);
  });

  it('finds a key behind another one, after one step along the list', () => {
    const trace = run('search', 'Ana');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['current = current.next;']);
    const hit = trace.steps.find((s) => s.kind === 'found')!;
    expect(lit(trace, hit)).toEqual(['if (current.key.equals(key)) return true;']);
    expect(hit.hash!.chains[2]!.map((n) => n.state)).toEqual(['visited', 'found']);
    expect(trace.steps.at(-1)!.description).toBe(
      '«Ana» está en la tabla: se comparó con 2 claves, todas de la lista de la posición 2.',
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
      '«Ivan» no está: se comparó con las 2 claves de la lista de la posición 2.',
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
      ['public boolean add(String key) {'],
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
    // Teo hashes to 4, in front of Sara.
    const trace = run('insert', 'Teo');
    const at = (line: string) => trace.steps.find((s) => lit(trace, s)[0] === line)!;
    const created = at('Node fresh = new Node(key);');
    expect(created.hash!.fresh).toEqual({ id: expect.any(Number), key: 'Teo', held: false });
    const linked = at('fresh.next = table[i];');
    expect(linked.hash!.fresh!.next).toBe(chainIds(linked, 4)[0]);
    const held = at('table[i] = fresh;');
    expect(held.hash!.fresh!.held).toBe(true);
    // Until `size++` the list still reads the way it did.
    expect(chains(held)[4]).toEqual(['Sara']);
    const landed = at('size++;');
    expect(landed.hash!.fresh).toBeUndefined();
    expect(chains(landed)[4]).toEqual(['Teo', 'Sara']);
    expect(landed.hash!.chains[4]![0]!.state).toBe('new');
    expect(landed.cells).toHaveLength(KEYS.length + 1);
  });

  it('links a node into an empty list with next = null', () => {
    const trace = run('insert', 'Ema');
    const linked = trace.steps.find((s) => lit(trace, s)[0] === 'fresh.next = table[i];')!;
    expect(linked.hash!.bucket).toBe(6);
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
    expect(chains(trace.steps.at(-1)!)).toEqual([[], [], [], [], [], ['Pia'], ['Ema']]);
  });
});

describe('sequenceStepperTrace · hash-chaining · remove', () => {
  it('removes the first node of a list by moving table[i]', () => {
    const trace = run('remove', 'Leo');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['table[i] = table[i].next;']);
    expect(lines).not.toContainEqual(['Node prev = table[i];']);
    expect(chains(trace.steps.at(-1)!)[2]).toEqual(['Ana']);
  });

  it('removes a node further along through prev, without a node of its own in front', () => {
    const trace = run('remove', 'Ana');
    const lines = trace.steps.map((s) => lit(trace, s));
    expect(lines).toContainEqual(['Node prev = table[i];']);
    const unlinked = trace.steps.find((s) => lit(trace, s)[0] === 'prev.next = prev.next.next;')!;
    // The node is still drawn on the frame that skips it, leaving.
    expect(unlinked.hash!.chains[2]!.map((n) => [n.key, n.state])).toEqual([
      ['Leo', 'active'],
      ['Ana', 'leaving'],
    ]);
    expect(unlinked.hash!.bypass).toEqual({ bucket: 2, from: 0 });
    expect(chains(trace.steps.at(-1)!)[2]).toEqual(['Leo']);
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
      ['remove', 'Leo'],
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
  // nextPrime(2 · 3) = 7, where Bea, Eva and Ana fall in 3, 0 and 2: the
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
      'add(«Bea»): con 7 posiciones, hash(«Bea») = 3; con 3 era 0.',
      'add(«Eva»): con 7 posiciones, hash(«Eva») = 0; con 3 era 2.',
      'add(«Ana»): con 7 posiciones, hash(«Ana») = 2; con 3 también era 2.',
    ]);
    expect(moves.map((s) => s.hash!.bucket)).toEqual([3, 0, 2]);
  });

  it('ends with every key in the list of its position in the new table, and old gone', () => {
    const last = resize().steps.at(-1)!;
    expect(last.hash!.old).toBeUndefined();
    expect(chains(last)).toEqual([['Eva'], [], ['Ana'], ['Bea'], [], [], []]);
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

describe('sequenceStepperTrace · hash-chaining · a program of insertions or removals', () => {
  // The run the class shows after each operation's code (#326 review, as the
  // search trees' «Inserciones en un mismo árbol»): the program on the left,
  // the method it calls on the right, both lit at every frame.
  const program = (
    operation: 'insert' | 'remove',
    key: string[],
    keys: string[] = [],
  ): SequenceTrace =>
    traceFor('hash-chaining', operation, { values: [], keys, key, capacity: M, program: true });

  const litProgram = (trace: SequenceTrace, step: SequenceStep): string[] => {
    const lines = trace.code.split('\n');
    return step.highlightLines.map((n) => lines[n - 1]!.trim());
  };
  const litMethod = (trace: SequenceTrace, step: SequenceStep): string[] => {
    const lines = trace.alongside!.split('\n');
    return (step.alongsideLines ?? []).map((n) => lines[n - 1]!.trim());
  };

  it('writes the program that creates the table and calls add once per key', () => {
    const trace = program('insert', ['Ana', 'Bea', 'Leo']);
    expect(trace.code).toBe(
      [
        'ChainedHashTable names = new ChainedHashTable(7);',
        'names.add("Ana");',
        'names.add("Bea");',
        'names.add("Leo");',
      ].join('\n'),
    );
    expect(trace.listingNames).toEqual(['programa', 'método']);
    expect(trace.alongside).toBe(run('insert', 'Ana').code);
  });

  it('opens on the empty table, with only the line that creates it lit', () => {
    const trace = program('insert', ['Ana', 'Bea']);
    const first = trace.steps[0]!;
    expect(litProgram(trace, first)).toEqual(['ChainedHashTable names = new ChainedHashTable(7);']);
    expect(first.alongsideLines).toEqual([]);
    expect(chains(first).flat()).toEqual([]);
  });

  it('keeps the running call lit while the method walks it', () => {
    const trace = program('insert', ['Ana', 'Leo']);
    const walked = trace.steps.slice(1);
    const calls = walked.map((s) => litProgram(trace, s)[0]);
    const firstOfLeo = calls.indexOf('names.add("Leo");');
    expect(calls.slice(0, firstOfLeo).every((c) => c === 'names.add("Ana");')).toBe(true);
    expect(calls.slice(firstOfLeo).every((c) => c === 'names.add("Leo");')).toBe(true);
    // The method beside it is walked line by line, as a single run walks it.
    expect(litMethod(trace, walked[0]!)).toEqual(['public boolean add(String key) {']);
    expect(litMethod(trace, walked[firstOfLeo]!)).toEqual(['public boolean add(String key) {']);
    // Leo collides with Ana at 2 and goes in front of her.
    expect(chains(trace.steps.at(-1)!)[2]).toEqual(['Leo', 'Ana']);
  });

  it('builds a removal program from the table values give, and lights those lines first', () => {
    const trace = program('remove', ['Ana', 'Leo', 'Carla'], KEYS);
    expect(trace.code.split('\n')).toEqual([
      'ChainedHashTable names = new ChainedHashTable(7);',
      ...KEYS.map((k) => `names.add("${k}");`),
      'names.remove("Ana");',
      'names.remove("Leo");',
      'names.remove("Carla");',
    ]);
    const first = trace.steps[0]!;
    expect(first.highlightLines).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(chains(first)).toEqual(chains(run('remove', 'Ana').steps[0]!));
    expect(trace.alongside).toBe(run('remove', 'Ana').code);
    expect(chains(trace.steps.at(-1)!)[2]).toEqual([]);
  });

  it('runs only insertions and removals as a program', () => {
    expect(() =>
      traceFor('hash-chaining', 'search', {
        values: [],
        keys: KEYS,
        key: ['Ana', 'Bea'],
        capacity: M,
        program: true,
      }),
    ).toThrow(/programa/);
  });
});

describe('sequenceStepperTrace · hash-chaining · insertions that grow the table', () => {
  // `grow` (#326 review): add with the line that resizes, and resize walked
  // inside the run in a listing of its own, so a run of insertions shows the
  // table growing — from 2 positions to 5, then to 11 — and every key moving.
  const GROWN = ['Ana', 'Bea', 'Eva', 'Leo', 'Sara', 'Juan', 'Teo'];
  const grow = (): SequenceTrace =>
    traceFor('hash-chaining', 'insert', {
      values: [],
      keys: [],
      key: GROWN,
      capacity: 2,
      grow: true,
    });

  const lines = (code: string, lit: number[] | undefined): string[] => {
    const all = code.split('\n');
    return (lit ?? []).map((n) => all[n - 1]!.trim());
  };

  it('lists add with the line that resizes, and resize beside it', () => {
    const trace = grow();
    expect(trace.row!.map((l) => l.name)).toEqual(['add', 'resize']);
    expect(trace.code).toContain('if (size == table.length)');
    expect(trace.code).toContain('resize(nextPrime(2 * table.length));');
    expect(trace.row![1]!.code).toContain('private void resize(int capacity) {');
  });

  it('grows from 2 positions to 5 and then to 11, before the third and the sixth key', () => {
    const trace = grow();
    const sizes = trace.steps.map((s) => s.hash!.chains.length);
    expect([...new Set(sizes)]).toEqual([2, 5, 11]);
    const resizing = trace.steps.filter((s) =>
      lines(trace.row![1]!.code, s.rowLines?.[1]).includes('private void resize(int capacity) {'),
    );
    expect(resizing.map((s) => s.hash!.key)).toEqual(['', '']);
    const starts = trace.steps.filter((s) => s.kind === 'start' && s.hash!.key !== '');
    expect(starts.map((s) => s.hash!.chains.length)).toEqual([2, 2, 2, 5, 5, 5, 11]);
  });

  it('keeps the call to resize lit in add while resize runs', () => {
    const trace = grow();
    const inside = trace.steps.filter((s) => (s.rowLines?.[1] ?? []).length > 0);
    expect(inside.length).toBeGreaterThan(0);
    for (const step of inside) {
      expect(lines(trace.code, step.rowLines![0])).toEqual([
        'if (size == table.length)',
        'resize(nextPrime(2 * table.length));',
      ]);
    }
  });

  it('checks the size on every insertion, and only resizes when it equals the positions', () => {
    const trace = grow();
    const checks = trace.steps.filter(
      (s) =>
        lines(trace.code, s.rowLines?.[0]).join() === 'if (size == table.length)' &&
        (s.rowLines?.[1] ?? []).length === 0,
    );
    expect(checks).toHaveLength(GROWN.length);
  });

  it('ends with every key in the list its hash names in the table of 11', () => {
    const last = grow().steps.at(-1)!;
    expect(chains(last)).toEqual([
      ['Ana', 'Sara'],
      [],
      [],
      [],
      ['Teo', 'Bea'],
      ['Eva'],
      [],
      [],
      [],
      ['Juan', 'Leo'],
      [],
    ]);
    for (const [bucket, chain] of last.hash!.chains.entries()) {
      for (const node of chain) expect(hashKey(node.key, 11)).toBe(bucket);
    }
  });

  it('sizes the drawing for the largest table and the largest old one', () => {
    const run = grow().hash!;
    expect(run.buckets).toBe(11);
    expect(run.oldBuckets).toBe(5);
  });

  it('refuses a program: three listings do not fit beside the tables', () => {
    // The slide runs it without one, and the header names the keys instead
    // (#331 review, ARC-4).
    for (const recipe of ['hash-chaining', 'hash-probing'] as const) {
      expect(() =>
        traceFor(recipe, 'insert', {
          values: [],
          keys: [],
          key: ['Ana', 'Bea', 'Eva'],
          capacity: 2,
          grow: true,
          program: true,
        }),
      ).toThrow(/program/);
    }
  });

  it('refuses a starting table add would already have resized', () => {
    // Four keys in three positions: the fourth add would have found
    // size == table.length and grown the table first (#331 review, COR-2).
    expect(() =>
      traceFor('hash-chaining', 'insert', {
        values: [],
        keys: ['Ana', 'Bea', 'Eva', 'Leo'],
        key: 'Sara',
        capacity: 3,
        grow: true,
      }),
    ).toThrow(/redimensionado/);
  });

  it('takes a starting table with as many keys as positions, and grows on its first add', () => {
    // size == table.length is a state add leaves; only past it is refused.
    const trace = traceFor('hash-chaining', 'insert', {
      values: [],
      keys: ['Ana', 'Bea', 'Eva'],
      key: 'Sara',
      capacity: 3,
      grow: true,
    });
    expect(trace.steps.at(-1)!.hash!.chains.length).toBe(7);
  });

  it('refuses a key the run would add twice: the header would strike it as added', () => {
    // add returns false for it, and the list in the header has no state for
    // that (#331 review, COR-7).
    for (const recipe of ['hash-chaining', 'hash-probing'] as const) {
      expect(() =>
        traceFor(recipe, 'insert', {
          values: [],
          keys: [],
          key: ['Ana', 'Ana'],
          capacity: 2,
          grow: true,
        }),
      ).toThrow(/«Ana»/);
      expect(() =>
        traceFor(recipe, 'insert', {
          values: [],
          keys: ['Ana'],
          key: ['Ana'],
          capacity: 3,
          grow: true,
        }),
      ).toThrow(/«Ana»/);
    }
  });

  it('grows only an insertion', () => {
    expect(() =>
      traceFor('hash-chaining', 'search', { values: [], keys: KEYS, key: 'Ana', grow: true }),
    ).toThrow(/grow/);
    expect(() =>
      traceFor('hash-probing', 'search', { values: [], keys: [], key: 'Ana', grow: true }),
    ).toThrow(/grow/);
  });
});

describe('sequenceStepperTrace · hash-chaining · the keys a growing run still has to add', () => {
  // The professor's review: with no program beside it, the run names its
  // keys in the widget's header, the one being added marked and the ones
  // added struck through. The trace says which is which at every frame.
  const GROWN = ['Ana', 'Bea', 'Eva', 'Leo', 'Sara', 'Juan', 'Teo'];
  const trace = traceFor('hash-chaining', 'insert', {
    values: [],
    keys: [],
    key: GROWN,
    capacity: 2,
    grow: true,
  });

  it('lists the keys of the run in order', () => {
    expect(trace.queue).toEqual(GROWN);
  });

  it('marks the key being added, through the resize its insertion runs', () => {
    expect(trace.steps[0]!.queue).toEqual({ done: 0, at: 0 });
    const eva = trace.steps.findIndex((s) => s.kind === 'start' && s.hash!.key === 'Eva');
    const leo = trace.steps.findIndex((s) => s.kind === 'start' && s.hash!.key === 'Leo');
    for (const step of trace.steps.slice(eva, leo - 1)) {
      expect(step.queue).toEqual({ done: 2, at: 2 });
    }
    // Eva's run ends with Eva added; the next frame starts Leo's.
    expect(trace.steps[leo - 1]!.queue).toEqual({ done: 3, at: null });
    expect(trace.steps[leo]!.queue).toEqual({ done: 3, at: 3 });
  });

  it('ends with every key added, and never takes one back', () => {
    expect(trace.steps.at(-1)!.queue).toEqual({ done: GROWN.length, at: null });
    const done = trace.steps.map((s) => s.queue!.done);
    expect(done).toEqual([...done].sort((a, b) => a - b));
  });
});
