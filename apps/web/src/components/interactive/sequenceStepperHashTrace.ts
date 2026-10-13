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
 * The hash is the class's own, `h = (31 * h + key.charAt(i)) % table.length`,
 * computed here exactly as the JVM computes it (pinned against Java's output
 * in the suite), so the position the widget draws is the one the student's
 * program prints.
 */
import { lineOf, requireRuns } from './sequenceStepperTraceShared';
// Types only: the dispatcher imports this module's `traceHash` as a value, so
// a value imported back from it would close a runtime cycle (ADR-0083 §1).
import type {
  HashFrame,
  HashFrameNode,
  SequenceCell,
  SequenceCellState,
  SequenceInput,
  SequenceStep,
  SequenceStepKind,
  SequenceTrace,
} from './sequenceStepperTrace';

type HashOperation = 'search' | 'insert' | 'remove';

/**
 * The three listings as the class writes them. `add` asks `contains` first,
 * so the table never holds a key twice, and puts the new node at the FRONT of
 * its list — the one place a singly linked list reaches without a walk.
 * `remove` treats the first node apart because it has no node before it: the
 * course's lists never use a node of their own in front.
 */
const CODE: Record<HashOperation, string> = {
  search: `boolean contains(String key) {
    Node current = table[hash(key)];
    while (current != null) {
        if (current.key.equals(key)) {
            return true;
        }
        current = current.next;
    }
    return false;
}`,
  insert: `boolean add(String key) {
    if (contains(key)) {
        return false;
    }
    int i = hash(key);
    Node fresh = new Node(key);
    fresh.next = table[i];
    table[i] = fresh;
    size++;
    return true;
}`,
  remove: `boolean remove(String key) {
    int i = hash(key);
    if (table[i] == null) {
        return false;
    }
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
};

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
const MIN_BUCKETS = 2;
const MAX_BUCKETS = 11;
/** The size the class's examples use when a slide does not say. */
const DEFAULT_BUCKETS = 7;

/**
 * The class's hash: Horner's rule over the characters, reduced modulo `m` at
 * every step so the number never leaves `int`. `charCodeAt` is Java's
 * `charAt`: both read UTF-16 code units.
 */
export function hashKey(key: string, m: number): number {
  let h = 0;
  for (let i = 0; i < key.length; i += 1) {
    h = (31 * h + key.charCodeAt(i)) % m;
  }
  return h;
}

interface Node {
  id: number;
  key: string;
}

let nextId = 0;
const nodeOf = (key: string): Node => ({ id: (nextId += 1), key });

/** A key in the narration. */
const q = (key: string) => `«${key}»`;

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
  readonly code: string;
  readonly chains: Node[][];

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

  push(kind: SequenceStepKind, lines: number[], description: string): void {
    const chains: HashFrameNode[][] = this.chains.map((chain) =>
      chain.map((n) => ({ id: n.id, key: n.key, state: this.state.get(n.id) ?? 'idle' })),
    );
    const hash: HashFrame = {
      chains,
      key: this.key,
      bucket: this.bucket,
      pointers: this.pointers.map((p) => ({ ...p })),
    };
    if (this.fresh !== undefined) hash.fresh = { ...this.fresh };
    if (this.bypass !== undefined) hash.bypass = { ...this.bypass };
    // On the table, cells only count the keys: the view draws `hash.chains`,
    // and the size readout reads their number. A key has no number to mirror.
    const cells: SequenceCell[] = chains
      .flat()
      .map((n) => ({ id: n.id, value: 0, state: n.state }));
    this.steps.push({
      kind,
      cells,
      pointers: [],
      highlightLines: lines,
      description,
      cost: this.cost,
      hash,
    });
  }
}

/** The keys a run is asked for: one runs the operation once, an array once each. */
function keysOf(input: SequenceInput): string[] {
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

/** The table the author writes: `keys` added in order, each at the front of its list. */
function buildTable(input: SequenceInput): { m: number; chains: Node[][] } {
  const m = input.capacity ?? DEFAULT_BUCKETS;
  if (!Number.isInteger(m) || m < MIN_BUCKETS || m > MAX_BUCKETS) {
    throw new Error(
      `La tabla tiene ${m} posiciones: entre ${MIN_BUCKETS} y ${MAX_BUCKETS}, que es lo que el dibujo lee bien en una lámina.`,
    );
  }
  const chains: Node[][] = Array.from({ length: m }, () => []);
  const seen = new Set<string>();
  for (const key of input.keys ?? []) {
    if (typeof key !== 'string' || key.length === 0) {
      throw new Error('Cada clave es un texto no vacío, como "Ana".');
    }
    if (seen.has(key)) {
      throw new Error(
        `La clave ${q(key)} está dos veces en values: una tabla guarda cada clave una vez.`,
      );
    }
    seen.add(key);
    chains[hashKey(key, m)]!.unshift(nodeOf(key));
  }
  return { m, chains };
}

export function traceHash(operation: HashOperation, input: SequenceInput): SequenceTrace {
  const keys = keysOf(input);
  const { m, chains } = buildTable(input);
  const code = CODE[operation];
  const rec = new HashRecorder(code, chains);
  for (const key of keys) {
    rec.reset(key);
    if (operation === 'search') search(rec, m, key);
    else if (operation === 'insert') insert(rec, m, key);
    else remove(rec, m, key);
  }
  const longest = Math.max(
    1,
    ...rec.steps.map((s) => Math.max(...s.hash!.chains.map((c) => c.length))),
  );
  return {
    steps: rec.steps,
    code,
    maxCells: Math.max(...rec.steps.map((s) => s.cells.length)),
    align: 'left',
    hasCarry: false,
    hash: { buckets: m, longest },
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

function insert(rec: HashRecorder, m: number, key: string): void {
  const code = rec.code;
  const h = hashKey(key, m);
  const chain = rec.chains[h]!;
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
      return;
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
