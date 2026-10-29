/**
 * Pure traces for the hash recipe of `<SequenceStepper>` (#326). Same contract
 * as `sequenceStepperTrace`, which dispatches here: a recipe, an operation and
 * an author-written input become a frame list and the Java listing those
 * frames light lines of — so the suite pins every frame and the browser is
 * left only "does it look right" (`apps/web/CLAUDE.md` §2).
 *
 * `hash-chaining` is the table with one list per position: `table[i]` is the
 * first node of the list of position `i`, and every key lives in the list of
 * the position its hash names. That is the invariant every frame keeps and
 * the narration names. A hash frame carries the whole table (`step.hash`);
 * `cells` mirrors its keys so the size readout counts them.
 *
 * The hash is the class's own, `h = (256 * h + key.charAt(i)) % table.length`:
 * the key read as a number in base 256, as the class builds it, computed here
 * exactly as the JVM computes it (pinned against Java's output in the suite),
 * so the position the widget draws is the one the student's program prints.
 */
import { lineOf, requireRuns } from './sequenceStepperTraceShared';
// Types only: the dispatcher imports this module's `traceHash` as a value, so
// a value imported back from it would close a runtime cycle (ADR-0083 §1).
import type {
  HashChainingOperation,
  HashFrame,
  HashFrameNode,
  SequenceCell,
  SequenceCellState,
  SequenceInput,
  SequenceStep,
  SequenceStepKind,
  SequenceTrace,
} from './sequenceStepperTrace';

/**
 * The listings as the class writes them, a guard that only returns on one
 * line — as the tree's listings write theirs — so the listing over the table
 * fits a slide. `add` asks `contains` first,
 * so the table never holds a key twice, and puts the new node at the FRONT of
 * its list — the one place a singly linked list reaches without a walk.
 * `remove` treats the first node apart because it has no node before it: the
 * course's lists never use a node of their own in front. `resize` is what
 * `add` calls when `size == table.length`: a new array, and every key put back
 * in through `add` itself, because where a key goes depends on the positions.
 */
const CODE: Record<HashChainingOperation, string> = {
  search: `public boolean contains(String key) {
    Node current = table[hash(key)];
    while (current != null) {
        if (current.key.equals(key)) return true;
        current = current.next;
    }
    return false;
}`,
  insert: `public boolean add(String key) {
    if (contains(key)) return false;
    int i = hash(key);
    Node fresh = new Node(key);
    fresh.next = table[i];
    table[i] = fresh;
    size++;
    return true;
}`,
  remove: `public boolean remove(String key) {
    int i = hash(key);
    if (table[i] == null) return false;
    if (table[i].key.equals(key)) {
        table[i] = table[i].next;
        size--;
        return true;
    }
    Node prev = table[i];
    while (prev.next != null) {
        if (prev.next.key.equals(key)) {
            prev.next = prev.next.next;
            size--;
            return true;
        }
        prev = prev.next;
    }
    return false;
}`,
  resize: `private void resize(int capacity) {
    Node[] old = table;
    table = new Node[capacity];
    size = 0;
    for (int i = 0; i < old.length; i++) {
        Node current = old[i];
        while (current != null) {
            add(current.key);
            current = current.next;
        }
    }
}`,
};

/**
 * `add` as the class writes it once the table resizes (#326 review, `grow`):
 * the size check before the key goes in, and the call to `resize` on a line of
 * its own, so the listing fits the column it shares with `resize` (38% of a
 * slide, `beside` below).
 */
const GROW_CODE = `public boolean add(String key) {
    if (contains(key)) return false;
    if (size == table.length)
        resize(nextPrime(2 * table.length));
    int i = hash(key);
    Node fresh = new Node(key);
    fresh.next = table[i];
    table[i] = fresh;
    size++;
    return true;
}`;

/**
 * The 1-based line of the first line containing `fragment` AFTER the line
 * containing `anchor`. `remove` says `return false;`, `size--;` and
 * `return true;` twice each — once for the first node, once further along —
 * and `lineOf` names the first; this names the second without numbering it
 * by hand.
 */
function lineAfter(code: string, anchor: string, fragment: string): number {
  const lines = code.split('\n');
  const from = lineOf(code, anchor);
  const at = lines.findIndex((line, i) => i >= from && line.includes(fragment));
  if (at < 0) throw new Error(`El listado no contiene «${fragment}» después de «${anchor}».`);
  return at + 1;
}

/** The most positions the drawing stays legible with, and the fewest that make a table. */
export const MIN_BUCKETS = 2;
export const MAX_BUCKETS = 11;
/** The size the class's examples use when a slide does not say. */
export const DEFAULT_BUCKETS = 7;

/** The base the class reads a key in: one character per digit. */
export const HASH_BASE = 256;

/**
 * The class's hash: Horner's rule over the characters in base 256, reduced
 * modulo `m` at every step so the number never leaves `int`. `charCodeAt` is
 * Java's `charAt`: both read UTF-16 code units.
 */
export function hashKey(key: string, m: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (HASH_BASE * h + key.charCodeAt(i)) % m;
  }
  return h;
}

/**
 * The positions `resize` grows to: the first prime from `n` on. `add` calls it
 * with `2 * table.length`, so the table keeps the prime size the division
 * method asks for — doubling a prime would give an even number.
 */
export function nextPrime(n: number): number {
  const isPrime = (p: number) => {
    if (p < 2) return false;
    for (let d = 2; d * d <= p; d += 1) if (p % d === 0) return false;
    return true;
  };
  let p = n;
  while (!isPrime(p)) p += 1;
  return p;
}

interface Node {
  id: number;
  key: string;
}

let nextId = 0;
const nodeOf = (key: string): Node => ({ id: (nextId += 1), key });

/** A key in the narration. */
export const q = (key: string) => `«${key}»`;

/**
 * The frame list every operation is written into. It owns the table, the
 * paint per node, the references the listing holds and the node built apart,
 * and turns them into one frame per `push`.
 */
class HashRecorder {
  readonly steps: SequenceStep[] = [];
  readonly state = new Map<number, SequenceCellState>();
  pointers: HashFrame['pointers'] = [];
  bucket: number | null = null;
  fresh: HashFrame['fresh'];
  bypass: HashFrame['bypass'];
  cost = 0;
  key = '';
  /** `resize` only: the old table, and the listing's `size` while it counts again. */
  old: { chains: Node[][]; bucket: number | null; aliased: boolean } | undefined;
  size: number | undefined;
  readonly code: string;
  chains: Node[][];
  /**
   * `grow` only: frames light two listings, `add` and `resize`. While
   * `resize` runs, `lane` holds the lines of `add` that called it, which stay
   * lit; the frame's own lines are then `resize`'s.
   */
  rows = false;
  lane: number[] | null = null;

  constructor(code: string, chains: Node[][]) {
    this.code = code;
    this.chains = chains;
  }

  /** Starts a new run: nothing painted, no position chosen, cost zero. */
  reset(key: string): void {
    this.state.clear();
    this.pointers = [];
    this.bucket = null;
    this.fresh = undefined;
    this.bypass = undefined;
    this.cost = 0;
    this.key = key;
  }

  /** The node under the eye goes back to what it was; a compared one stays compared. */
  settle(): void {
    for (const [id, s] of this.state) {
      if (s === 'active') this.state.set(id, 'visited');
    }
  }

  private paint(chains: Node[][]): HashFrameNode[][] {
    return chains.map((chain) =>
      chain.map((n) => ({ id: n.id, key: n.key, state: this.state.get(n.id) ?? 'idle' })),
    );
  }

  push(kind: SequenceStepKind, lines: number[], description: string): void {
    const chains = this.paint(this.chains);
    const hash: HashFrame = {
      chains,
      key: this.key,
      bucket: this.bucket,
      // The field the listing keeps: the keys in `table`, except while
      // `resize` has set it back to 0 and counts them in again.
      size: this.size ?? chains.flat().length,
      pointers: this.pointers.map((p) => ({ ...p })),
    };
    if (this.old !== undefined) {
      hash.old = {
        chains: this.paint(this.old.chains),
        bucket: this.old.bucket,
        aliased: this.old.aliased,
      };
    }
    if (this.fresh !== undefined) hash.fresh = { ...this.fresh };
    if (this.bypass !== undefined) hash.bypass = { ...this.bypass };
    // On the table, cells only count the keys: the view draws `hash.chains`,
    // and the size readout reads their number. A key has no number to mirror.
    const cells: SequenceCell[] = chains
      .flat()
      .map((n) => ({ id: n.id, value: 0, state: n.state }));
    const own = [...new Set(lines)];
    this.steps.push({
      kind,
      cells,
      pointers: [],
      highlightLines: this.lane ?? own,
      ...(this.rows ? { rowLines: this.lane === null ? [own, []] : [this.lane, own] } : {}),
      description,
      cost: this.cost,
      hash,
    });
  }
}

// ── shared with the probing trace ─────────────────────────────────────────

/** The keys a run is asked for: one runs the operation once, an array once each. */
export function keysOf(input: SequenceInput): string[] {
  const key = input.key;
  if (key === undefined) {
    throw new Error(
      'Falta la clave con que trabaja la operación: target para buscar o eliminar, value para insertar.',
    );
  }
  const keys = Array.isArray(key) ? key : [key];
  requireRuns(keys.length);
  for (const k of keys) {
    if (typeof k !== 'string' || k.length === 0) {
      throw new Error('Cada clave es un texto no vacío, como "Ana".');
    }
  }
  return keys;
}

/**
 * The table the author writes, checked: its positions within what a slide
 * reads, and its keys text, each once.
 */
export function tableKeys(input: SequenceInput): { m: number; keys: string[] } {
  const m = input.capacity ?? DEFAULT_BUCKETS;
  if (!Number.isInteger(m) || m < MIN_BUCKETS || m > MAX_BUCKETS) {
    throw new Error(
      `La tabla tiene ${m} posiciones: entre ${MIN_BUCKETS} y ${MAX_BUCKETS}, que es lo que el dibujo lee bien en una lámina.`,
    );
  }
  const keys = input.keys ?? [];
  const seen = new Set<string>();
  for (const key of keys) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Cada clave es un texto no vacío, como "Ana".');
    }
    if (seen.has(key)) {
      throw new Error(
        `La clave ${q(key)} está dos veces en values: una tabla guarda cada clave una vez.`,
      );
    }
    seen.add(key);
  }
  return { m, keys };
}

/** A growing run's header: every frame of a key's run is about it, and its last has added it. */
export function stampQueue(steps: SequenceStep[], from: number, run: number): void {
  for (const step of steps.slice(from)) step.queue = { done: run, at: run };
  steps.at(-1)!.queue = { done: run + 1, at: null };
}

/** The table the author writes: `keys` added in order, each at the front of its list. */
function buildTable(input: SequenceInput): { m: number; chains: Node[][] } {
  const { m, keys } = tableKeys(input);
  const chains: Node[][] = Array.from({ length: m }, () => []);
  for (const key of keys) chains[hashKey(key, m)]!.unshift(nodeOf(key));
  return { m, chains };
}

export function traceHash(operation: HashChainingOperation, input: SequenceInput): SequenceTrace {
  const walked = walkHash(operation, input);
  return input.program === true
    ? hashProgram('ChainedHashTable', operation, input, walked)
    : walked;
}

/**
 * Insertions or removals on a hash table run by a program (#326 review, the
 * shape of the search trees' programs, #322): the program on the left — the
 * table created, the keys of `keys` added, one call per key of the run — and
 * the method it calls on the right, walked for every call the way a single
 * run walks it. The program's line stays lit while the method runs, so the
 * reader sees which call the method is in.
 */
export function hashProgram(
  type: 'ChainedHashTable' | 'ProbingHashTable',
  operation: HashChainingOperation,
  input: SequenceInput,
  walked: SequenceTrace,
): SequenceTrace {
  const keys = input.keys ?? [];
  const runs = Array.isArray(input.key) ? input.key : [input.key];
  const call = operation === 'insert' ? 'add' : 'remove';
  const capacity = input.capacity ?? walked.hash?.buckets ?? walked.probe?.buckets;
  const built = 1 + keys.length;
  const code = [
    `${type} names = new ${type}(${capacity});`,
    ...keys.map((k) => `names.add("${k}");`),
    ...runs.map((k) => `names.${call}("${k}");`),
  ].join('\n');
  const first = walked.steps[0]!;
  const openingLines = Array.from({ length: built }, (_, i) => i + 1);
  const opening: SequenceStep = {
    ...first,
    kind: 'start',
    highlightLines: openingLines,
    alongsideLines: [],
    description:
      keys.length === 0
        ? `La tabla, vacía: ${capacity} posiciones.`
        : `La tabla, con las ${keys.length} claves que el programa agregó.`,
    ...(first.hash ? { hash: { ...first.hash, key: '', bucket: null, pointers: [] } } : {}),
    ...(first.probe ? { probe: { ...first.probe, key: '', home: null, at: null } } : {}),
  };
  // A run starts where the method is called, at its public method's frame.
  let run = -1;
  const steps = walked.steps.map((step) => {
    if (step.kind === 'start') run += 1;
    const lit = [built + run + 1];
    return { ...step, highlightLines: lit, alongsideLines: step.highlightLines };
  });
  return {
    ...walked,
    code,
    alongside: walked.code,
    listingNames: ['programa', 'método'],
    steps: [opening, ...steps],
  };
}

function walkHash(operation: HashChainingOperation, input: SequenceInput): SequenceTrace {
  const { m, chains } = buildTable(input);
  const growing = input.grow === true;
  const start = (input.keys ?? []).length;
  if (growing && start > m) {
    // Probing refuses its unreachable starts in buildTable; this is the
    // chaining one (#331 review).
    throw new Error(
      `${start} claves en ${m} posiciones: add habría redimensionado la tabla al encontrar size == table.length, así que con grow la tabla empieza con a lo más ${m} claves.`,
    );
  }
  const code = growing ? GROW_CODE : CODE[operation];
  const rec = new HashRecorder(code, chains);
  rec.rows = growing;
  let buckets = m;
  if (operation === 'resize') {
    // One run: `resize` takes no key, and the table it leaves is the end.
    buckets = resize(rec, m);
  } else {
    for (const [run, key] of keysOf(input).entries()) {
      const from = rec.steps.length;
      rec.reset(key);
      if (operation === 'search') search(rec, buckets, key);
      else if (operation === 'insert') buckets = insert(rec, buckets, key, growing);
      else remove(rec, buckets, key);
      if (growing) stampQueue(rec.steps, from, run);
    }
  }
  const lengths = (frame: HashFrameNode[][] | undefined) => (frame ?? []).map((c) => c.length);
  const longest = Math.max(
    1,
    ...rec.steps.flatMap((s) => [...lengths(s.hash!.chains), ...lengths(s.hash!.old?.chains)]),
  );
  if (growing) {
    // The canvas keeps one size for the whole run: the largest table any frame
    // holds, and the largest old one a resize draws beside or above it.
    const widest = Math.max(...rec.steps.map((s) => s.hash!.chains.length));
    const oldest = Math.max(0, ...rec.steps.map((s) => s.hash!.old?.chains.length ?? 0));
    return {
      steps: rec.steps,
      code,
      row: [
        { name: 'add', code },
        { name: 'resize', code: CODE.resize },
      ],
      // The listings' share: the least that keeps add's and resize's longest
      // lines whole at the slide's font; above the stacked tables instead,
      // the professor measured the nodes too small (#326 review).
      beside: 38,
      queue: keysOf(input),
      maxCells: Math.max(...rec.steps.map((s) => s.cells.length)),
      align: 'left',
      hasCarry: false,
      hash:
        oldest > 0
          ? { buckets: widest, longest, oldBuckets: oldest }
          : { buckets: widest, longest },
    };
  }
  return {
    steps: rec.steps,
    code,
    maxCells: Math.max(...rec.steps.map((s) => s.cells.length)),
    align: 'left',
    hasCarry: false,
    hash: operation === 'resize' ? { buckets, longest, oldBuckets: m } : { buckets, longest },
  };
}

/** How many keys were compared, in the narration. */
const compared = (n: number) => (n === 1 ? '1 clave' : `${n} claves`);

// ── search: straight to one list, and only that list ──────────────────────

function search(rec: HashRecorder, m: number, key: string): void {
  const code = rec.code;
  const h = hashKey(key, m);
  const chain = rec.chains[h]!;
  rec.push('start', [lineOf(code, 'boolean contains(')], `Buscar ${q(key)}.`);

  rec.bucket = h;
  rec.pointers = [{ name: 'current', node: chain[0]?.id ?? null }];
  rec.push(
    'walk',
    [lineOf(code, 'Node current = table[hash(key)]')],
    chain.length === 0
      ? `hash(${q(key)}) = ${h}: la búsqueda va directo a la lista de la posición ${h}, que está vacía; current queda en null.`
      : `hash(${q(key)}) = ${h}: la búsqueda va directo a la lista de la posición ${h}; current apunta a su primer nodo, ${q(chain[0]!.key)}.`,
  );

  let found = false;
  for (let k = 0; k < chain.length; k += 1) {
    const node = chain[k]!;
    rec.settle();
    rec.cost += 1;
    if (node.key === key) {
      rec.state.set(node.id, 'found');
      rec.push(
        'found',
        [lineOf(code, 'if (current.key.equals(key))'), lineOf(code, 'return true')],
        `${q(node.key)} es la clave buscada: contains devuelve true.`,
      );
      found = true;
      break;
    }
    rec.state.set(node.id, 'active');
    rec.push(
      'compare',
      [lineOf(code, 'while (current != null)'), lineOf(code, 'if (current.key.equals(key))')],
      `${q(node.key)} no es ${q(key)}.`,
    );
    const next = chain[k + 1];
    rec.settle();
    rec.pointers = [{ name: 'current', node: next?.id ?? null }];
    rec.push(
      'walk',
      [lineOf(code, 'current = current.next')],
      next === undefined
        ? 'current avanza a null: la lista se acabó.'
        : `current avanza al siguiente nodo, ${q(next.key)}.`,
    );
  }

  if (!found) {
    rec.push(
      'done',
      [lineOf(code, 'while (current != null)'), lineOf(code, 'return false')],
      chain.length === 0
        ? 'current es null desde el principio: contains devuelve false sin comparar ninguna clave.'
        : `current es null: ${q(key)} no está en la lista de la posición ${h}; contains devuelve false.`,
    );
  }

  rec.settle();
  rec.pointers = [];
  const n = rec.cost;
  rec.push(
    'done',
    [],
    found
      ? n === 1
        ? `${q(key)} está en la tabla: se comparó con 1 clave, la primera de la lista de la posición ${h}.`
        : `${q(key)} está en la tabla: se comparó con ${compared(n)}, todas de la lista de la posición ${h}.`
      : n === 0
        ? `${q(key)} no está: la lista de la posición ${h} está vacía y no se comparó ninguna clave.`
        : n === 1
          ? `${q(key)} no está: se comparó con la única clave de la lista de la posición ${h}.`
          : `${q(key)} no está: se comparó con las ${compared(n)} de la lista de la posición ${h}.`,
  );
}

// ── insert: contains first, then a new node at the front of its list ──────

function insert(rec: HashRecorder, m: number, key: string, growing = false): number {
  const code = rec.code;
  let h = hashKey(key, m);
  let chain = rec.chains[h]!;
  const callLine = lineOf(code, 'if (contains(key))');
  rec.push('start', [lineOf(code, 'boolean add(')], `Agregar ${q(key)}.`);

  // contains runs inside one line of add: each key it compares is a frame of
  // that line, so the walk is seen without a listing of its own.
  rec.bucket = h;
  if (chain.length === 0) {
    rec.push(
      'walk',
      [callLine],
      `contains(${q(key)}) va a la lista de la posición ${h}: está vacía, así que ${q(key)} no está.`,
    );
  }
  for (let k = 0; k < chain.length; k += 1) {
    const node = chain[k]!;
    rec.settle();
    rec.cost += 1;
    if (node.key === key) {
      rec.state.set(node.id, 'found');
      rec.push(
        'found',
        [callLine, lineOf(code, 'return false')],
        `contains(${q(key)}) la encuentra en la lista de la posición ${h}: la clave ya está, y add devuelve false sin agregarla otra vez.`,
      );
      rec.settle();
      rec.push(
        'done',
        [],
        `${q(key)} ya estaba: la tabla no cambia, porque guarda cada clave una vez.`,
      );
      return m;
    }
    rec.state.set(node.id, 'active');
    const last = k === chain.length - 1;
    rec.push(
      'compare',
      [callLine],
      last
        ? `contains(${q(key)}) compara ${q(node.key)}: no es, y la lista se acabó. ${q(key)} no está.`
        : `contains(${q(key)}) recorre la lista de la posición ${h}: ${q(node.key)} no es ${q(key)}.`,
    );
  }

  rec.settle();
  if (growing) {
    const check = lineOf(code, 'if (size == table.length)');
    const size = rec.chains.flat().length;
    if (size === m) {
      rec.push(
        'compare',
        [check],
        `size == table.length: hay ${size} claves en ${m} posiciones. Antes de agregar ${q(key)}, la tabla crece.`,
      );
      rec.lane = [check, lineOf(code, 'resize(nextPrime')];
      m = resize(rec, m, CODE.resize);
      rec.lane = null;
      // resize counted its keys back in on its own `size`; from here the
      // readout is the table's again.
      rec.size = undefined;
      rec.key = key;
      h = hashKey(key, m);
      chain = rec.chains[h]!;
    } else {
      rec.push(
        'compare',
        [check],
        `size es ${size} y table.length es ${m}: queda espacio, y la tabla no crece.`,
      );
    }
    rec.bucket = h;
  }
  rec.push('walk', [lineOf(code, 'int i = hash(key)')], `i = hash(${q(key)}) = ${h}.`);

  const fresh = nodeOf(key);
  rec.fresh = { id: fresh.id, key, held: false };
  rec.state.set(fresh.id, 'new');
  rec.push(
    'build',
    [lineOf(code, 'Node fresh = new Node(key)')],
    `Se crea el nodo de ${q(key)}: todavía no está en ninguna lista.`,
  );

  const first = chain[0];
  rec.fresh = { ...rec.fresh, next: first?.id ?? null };
  rec.push(
    'link',
    [lineOf(code, 'fresh.next = table[i]')],
    first === undefined
      ? `fresh.next = table[${h}], que es null: la lista de la posición ${h} está vacía.`
      : `fresh.next apunta al primer nodo de la lista de la posición ${h}, ${q(first.key)}.`,
  );

  rec.fresh = { ...rec.fresh, held: true };
  rec.push(
    'link',
    [lineOf(code, 'table[i] = fresh')],
    `table[${h}] apunta ahora al nodo nuevo: ${q(key)} queda al frente de la lista de la posición ${h}, y la invariante se mantiene — cada clave está en la lista de la posición que nombra su hash.`,
  );

  const before = rec.chains.flat().length;
  chain.unshift(fresh);
  rec.fresh = undefined;
  rec.push('grow', [lineOf(code, 'size++')], `size pasa de ${before} a ${before + 1}.`);
  rec.push(
    'done',
    [lineOf(code, 'return true')],
    `add devuelve true: ${q(key)} quedó en la tabla.`,
  );

  rec.settle();
  rec.push(
    'done',
    [],
    `${q(key)} entró al frente de la lista de la posición ${h}, sin recorrer nada más que esa lista.`,
  );
  return m;
}

// ── remove: the first node apart, the rest through prev ───────────────────

function remove(rec: HashRecorder, m: number, key: string): void {
  const code = rec.code;
  const h = hashKey(key, m);
  const chain = rec.chains[h]!;
  const afterWalk = 'prev = prev.next';
  rec.push('start', [lineOf(code, 'boolean remove(')], `Eliminar ${q(key)}.`);

  rec.bucket = h;
  rec.push('walk', [lineOf(code, 'int i = hash(key)')], `i = hash(${q(key)}) = ${h}.`);

  if (chain.length === 0) {
    rec.push(
      'done',
      [lineOf(code, 'if (table[i] == null)'), lineOf(code, 'return false')],
      `La lista de la posición ${h} está vacía: ${q(key)} no está, y remove devuelve false.`,
    );
    rec.push('done', [], `${q(key)} no estaba: la tabla no cambia.`);
    return;
  }
  rec.push(
    'compare',
    [lineOf(code, 'if (table[i] == null)')],
    `La lista de la posición ${h} no está vacía.`,
  );

  const first = chain[0]!;
  rec.cost += 1;
  rec.state.set(first.id, 'active');
  if (first.key === key) {
    rec.push(
      'compare',
      [lineOf(code, 'if (table[i].key.equals(key))')],
      `El primer nodo de la lista, ${q(first.key)}, es la clave.`,
    );
    rec.state.set(first.id, 'leaving');
    rec.bypass = { bucket: h, from: null };
    const after = chain[1];
    rec.push(
      'unlink',
      [lineOf(code, 'table[i] = table[i].next')],
      after === undefined
        ? `table[${h}] pasa a null: la lista de la posición ${h} queda vacía.`
        : `table[${h}] salta el nodo de ${q(key)} y apunta a ${q(after.key)}.`,
    );
    shrink(rec, chain, 0, lineOf(code, 'size--'), lineOf(code, 'return true'), key, h);
    return;
  }
  rec.push(
    'compare',
    [lineOf(code, 'if (table[i].key.equals(key))')],
    `El primer nodo, ${q(first.key)}, no es ${q(key)}.`,
  );

  let p = 0;
  rec.pointers = [{ name: 'prev', node: first.id }];
  rec.push(
    'walk',
    [lineOf(code, 'Node prev = table[i]')],
    `prev apunta al primer nodo, ${q(first.key)}.`,
  );

  while (p + 1 < chain.length) {
    const next = chain[p + 1]!;
    rec.cost += 1;
    rec.state.set(chain[p]!.id, 'active');
    rec.state.set(next.id, 'active');
    if (next.key === key) {
      rec.push(
        'compare',
        [lineOf(code, 'while (prev.next != null)'), lineOf(code, 'if (prev.next.key.equals(key))')],
        `prev.next es ${q(next.key)}: es la clave.`,
      );
      rec.state.set(next.id, 'leaving');
      rec.bypass = { bucket: h, from: p };
      const after = chain[p + 2];
      rec.push(
        'unlink',
        [lineOf(code, 'prev.next = prev.next.next')],
        after === undefined
          ? `prev.next pasa a null: el nodo de ${q(chain[p]!.key)} queda último.`
          : `prev.next salta el nodo de ${q(key)}: ${q(chain[p]!.key)} apunta ahora a ${q(after.key)}.`,
      );
      shrink(
        rec,
        chain,
        p + 1,
        lineAfter(code, 'prev.next = prev.next.next', 'size--'),
        lineAfter(code, 'prev.next = prev.next.next', 'return true'),
        key,
        h,
      );
      return;
    }
    rec.push(
      'compare',
      [lineOf(code, 'while (prev.next != null)'), lineOf(code, 'if (prev.next.key.equals(key))')],
      `prev.next es ${q(next.key)}: no es ${q(key)}.`,
    );
    rec.state.set(chain[p]!.id, 'visited');
    p += 1;
    rec.pointers = [{ name: 'prev', node: next.id }];
    rec.push('walk', [lineOf(code, afterWalk)], `prev avanza a ${q(next.key)}.`);
  }

  rec.push(
    'done',
    [lineOf(code, 'while (prev.next != null)'), lineAfter(code, afterWalk, 'return false')],
    `prev.next es null: la lista se acabó sin ${q(key)}, y remove devuelve false.`,
  );
  rec.settle();
  rec.pointers = [];
  rec.push('done', [], `${q(key)} no estaba: la tabla no cambia.`);
}

/** The node at `at` leaves its list: `size--`, `return true`, and the settled frame. */
function shrink(
  rec: HashRecorder,
  chain: Node[],
  at: number,
  sizeLine: number,
  returnLine: number,
  key: string,
  h: number,
): void {
  const before = rec.chains.flat().length;
  chain.splice(at, 1);
  rec.bypass = undefined;
  rec.push(
    'shrink',
    [sizeLine],
    `size pasa de ${before} a ${before - 1}, y la invariante se mantiene: las claves que quedan siguen en la lista de su posición.`,
  );
  rec.push('done', [returnLine], `remove devuelve true: ${q(key)} salió de la tabla.`);
  rec.settle();
  rec.pointers = [];
  rec.push('done', [], `${q(key)} salió de la lista de la posición ${h}.`);
}

// ── resize: a new array, every key back in through add ────────────────────

/** Runs `resize` over a table of `m` positions; returns the new number of positions. */
function resize(rec: HashRecorder, m: number, code: string = rec.code): number {
  const grown = nextPrime(2 * m);
  if (grown > MAX_BUCKETS) {
    throw new Error(
      `resize llevaría la tabla de ${m} a ${grown} posiciones, y el dibujo lee bien hasta ${MAX_BUCKETS}: usa una tabla de a lo más ${MAX_BUCKETS >> 1} posiciones.`,
    );
  }
  const total = rec.chains.flat().length;
  rec.reset('');
  rec.size = total;
  rec.push(
    'start',
    [lineOf(code, 'private void resize(')],
    `resize(${grown}): la tabla de ${m} posiciones pasa a tener ${grown}, el primo siguiente a 2 · ${m}.`,
  );

  const old = rec.chains;
  rec.old = { chains: old, bucket: null, aliased: true };
  rec.push(
    'walk',
    [lineOf(code, 'Node[] old = table')],
    `old guarda la tabla de ${m} posiciones: sus claves no se pierden mientras table cambia.`,
  );

  rec.chains = Array.from({ length: grown }, () => []);
  rec.old = { ...rec.old, aliased: false };
  rec.push(
    'build',
    [lineOf(code, 'table = new Node[capacity]')],
    `table es ahora un arreglo nuevo de ${grown} posiciones, vacío. Hasta que cada clave vuelva a entrar, la invariante no se cumple: cada clave está en la lista de su posición con ${m} posiciones, no con ${grown}.`,
  );

  rec.size = 0;
  rec.push(
    'shrink',
    [lineOf(code, 'size = 0')],
    'size vuelve a 0: add va a contar cada clave otra vez.',
  );

  for (let i = 0; i < m; i += 1) {
    const chain = old[i]!;
    rec.settle();
    rec.old = { ...rec.old, bucket: i };
    rec.pointers = [{ name: 'current', node: chain[0]?.id ?? null, old: true }];
    if (chain.length === 0) {
      rec.push(
        'walk',
        [lineOf(code, 'Node current = old[i]'), lineOf(code, 'while (current != null)')],
        `old[${i}] está vacía: no hay claves que mover.`,
      );
      continue;
    }
    rec.push(
      'walk',
      [lineOf(code, 'Node current = old[i]')],
      `current apunta al primer nodo de old[${i}], ${q(chain[0]!.key)}.`,
    );
    for (let k = 0; k < chain.length; k += 1) {
      const node = chain[k]!;
      const j = hashKey(node.key, grown);
      // `add` builds a node of its own in the new table; the old one stays in
      // `old`, already moved, as long as `old` names it.
      const moved = nodeOf(node.key);
      rec.chains[j]!.unshift(moved);
      rec.state.set(node.id, 'visited');
      rec.state.set(moved.id, 'new');
      rec.key = node.key;
      rec.bucket = j;
      rec.size += 1;
      rec.cost += 1;
      rec.push(
        'build',
        [lineOf(code, 'add(current.key)')],
        `add(${q(node.key)}): con ${grown} posiciones, hash(${q(node.key)}) = ${j}; con ${m} ${
          j === i ? 'también era' : 'era'
        } ${i}.`,
      );
      const next = chain[k + 1];
      rec.state.set(moved.id, 'idle');
      rec.pointers = [{ name: 'current', node: next?.id ?? null, old: true }];
      rec.push(
        'walk',
        [lineOf(code, 'current = current.next')],
        next === undefined
          ? `current avanza a null: old[${i}] no tiene más claves.`
          : `current avanza al siguiente nodo de old[${i}], ${q(next.key)}.`,
      );
    }
  }

  rec.old = undefined;
  rec.pointers = [];
  rec.bucket = null;
  rec.key = '';
  rec.state.clear();
  rec.push(
    'done',
    [],
    `${total === 1 ? 'La clave está' : `Las ${total} claves están`} en la tabla de ${grown} posiciones, cada una en la lista que nombra su hash: la invariante se cumple otra vez. old ya no la usa nadie.`,
  );
  return grown;
}
