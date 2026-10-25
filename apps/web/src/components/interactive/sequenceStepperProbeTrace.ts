/**
 * Pure traces for the probing recipe of `<SequenceStepper>` (#326): the hash
 * table that keeps every key in the array itself. Same contract as
 * `sequenceStepperTrace`, which dispatches here — frames and the Java listing
 * they light, pinned by the suite, the browser left only the paint.
 *
 * `keys[i]` holds a key or null, and a parallel `boolean[] deleted` marks a
 * key removed: the key stays in its cell, a search passes over the mark, and
 * an insertion may reuse it (the professor's choice, S3 — a sentinel compared
 * with `==` would teach the trap the course warns against). The invariant every
 * frame keeps, and the narration names: between the position a key hashes to
 * and the position it sits in there is no empty cell. That is why a search may
 * stop at the first null, and why removing a key cannot empty its cell.
 *
 * `used` counts the cells that are not null — keys and marks — and `add`
 * resizes before a key would leave more than half of them used. That keeps an
 * empty cell for every search to stop at, and keeps the expected cost the one
 * the class quotes for a load factor of at most one half. The widget does not
 * draw the probing table's resize: a slide whose insertion would trigger it is
 * refused, and the class shows that method as code.
 */
import { DEFAULT_BUCKETS, hashKey, MAX_BUCKETS, MIN_BUCKETS } from './sequenceStepperHashTrace';
import { lineOf, requireRuns } from './sequenceStepperTraceShared';
// Types only: the dispatcher imports this module's `traceProbe` as a value, so
// a value imported back from it would close a runtime cycle (ADR-0083 §1).
import type {
  ProbeCell,
  ProbeFrame,
  SequenceCell,
  SequenceCellState,
  SequenceInput,
  SequenceStep,
  SequenceStepKind,
  SequenceTrace,
} from './sequenceStepperTrace';

type ProbeOperation = 'search' | 'insert' | 'remove';

/**
 * The three listings as the class writes them. `contains` stops at the first
 * null — the invariant guarantees the key is not past it — and passes over a
 * mark; `add` asks `contains` first and then takes the first cell that is
 * null or marked; `remove` marks instead of emptying.
 */
const CODE: Record<ProbeOperation, string> = {
  search: `boolean contains(String key) {
    int i = hash(key);
    while (keys[i] != null) {
        if (!deleted[i] && keys[i].equals(key)) return true;
        i = (i + 1) % keys.length;
    }
    return false;
}`,
  insert: `boolean add(String key) {
    if (contains(key)) return false;
    if (2 * (used + 1) > keys.length) resize(nextPrime(2 * keys.length));
    int i = hash(key);
    while (keys[i] != null && !deleted[i]) {
        i = (i + 1) % keys.length;
    }
    if (keys[i] == null) used++;
    keys[i] = key;
    deleted[i] = false;
    size++;
    return true;
}`,
  remove: `boolean remove(String key) {
    int i = hash(key);
    while (keys[i] != null) {
        if (!deleted[i] && keys[i].equals(key)) {
            deleted[i] = true;
            size--;
            return true;
        }
        i = (i + 1) % keys.length;
    }
    return false;
}`,
};

interface Cell {
  key: string | null;
  deleted: boolean;
}

/** A key in the narration. */
const q = (key: string) => `«${key}»`;

/** One more step to the right, around the end of the array. */
const step = (i: number, m: number) => (i + 1) % m;

class ProbeRecorder {
  readonly steps: SequenceStep[] = [];
  readonly state = new Map<number, SequenceCellState>();
  home: number | null = null;
  at: number | null = null;
  cost = 0;
  key = '';
  readonly code: string;
  readonly cells: Cell[];
  /**
   * The listing's `used`: kept as a counter, not read off the cells, because
   * `used++` runs before `keys[i] = key` and its frame must already show it.
   */
  used: number;

  constructor(code: string, cells: Cell[]) {
    this.code = code;
    this.cells = cells;
    this.used = cells.filter((c) => c.key !== null).length;
  }

  reset(key: string): void {
    this.state.clear();
    this.home = null;
    this.at = null;
    this.cost = 0;
    this.key = key;
  }

  /** The cell under the eye becomes a cell already looked at. */
  settle(): void {
    for (const [i, s] of this.state) {
      if (s === 'active') this.state.set(i, 'visited');
    }
  }

  push(kind: SequenceStepKind, lines: number[], description: string): void {
    const cells: ProbeCell[] = this.cells.map((c, i) => ({
      key: c.key,
      deleted: c.deleted,
      state: this.state.get(i) ?? 'idle',
    }));
    const live = cells.filter((c) => c.key !== null && !c.deleted);
    const probe: ProbeFrame = {
      cells,
      key: this.key,
      home: this.home,
      at: this.at,
      size: live.length,
      used: this.used,
    };
    // The size readout counts the keys not marked; nothing reads a value here.
    const mirror: SequenceCell[] = live.map((c, i) => ({ id: i, value: 0, state: c.state }));
    this.steps.push({
      kind,
      cells: mirror,
      pointers: [],
      highlightLines: [...new Set(lines)],
      description,
      cost: this.cost,
      probe,
    });
  }
}

/** The keys a run is asked for. */
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

/** The table the author writes: `keys` added in order with linear probing, then `deleted` marked. */
function buildTable(input: SequenceInput): { m: number; cells: Cell[] } {
  const m = input.capacity ?? DEFAULT_BUCKETS;
  if (!Number.isInteger(m) || m < MIN_BUCKETS || m > MAX_BUCKETS) {
    throw new Error(
      `La tabla tiene ${m} posiciones: entre ${MIN_BUCKETS} y ${MAX_BUCKETS}, que es lo que el dibujo lee bien en una lámina.`,
    );
  }
  const keys = input.keys ?? [];
  // Every key of `values` takes a cell, marked or not, so they all count as used.
  if (2 * keys.length > m) {
    throw new Error(
      `${keys.length} celdas usadas en ${m} posiciones: pasa de la mitad de la tabla, y add la habría redimensionado antes de llegar ahí. Con la tabla llena, una búsqueda de una clave que no está no se detendría nunca.`,
    );
  }
  const cells: Cell[] = Array.from({ length: m }, () => ({ key: null, deleted: false }));
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
    let i = hashKey(key, m);
    while (cells[i]!.key !== null) i = step(i, m);
    cells[i] = { key, deleted: false };
  }
  for (const key of input.deleted ?? []) {
    const at = cells.findIndex((c) => c.key === key);
    if (at < 0) {
      throw new Error(
        `deleted marca ${q(key)}, que no está en values: solo se marca una clave que la tabla guarda.`,
      );
    }
    cells[at] = { key, deleted: true };
  }
  return { m, cells };
}

export function traceProbe(operation: ProbeOperation, input: SequenceInput): SequenceTrace {
  const keys = keysOf(input);
  const { m, cells } = buildTable(input);
  const code = CODE[operation];
  const rec = new ProbeRecorder(code, cells);
  for (const key of keys) {
    rec.reset(key);
    if (operation === 'search') search(rec, m, key);
    else if (operation === 'insert') insert(rec, m, key);
    else remove(rec, m, key);
  }
  return {
    steps: rec.steps,
    code,
    maxCells: Math.max(...rec.steps.map((s) => s.cells.length)),
    align: 'left',
    hasCarry: false,
    probe: { buckets: m },
  };
}

/** Cells in the narration. */
const looked = (n: number) => (n === 1 ? '1 celda' : `${n} celdas`);

/**
 * The walk `contains` and `remove` share: from the hash on, one frame per cell
 * compared and one per step, until the key or a null. Returns the cell where
 * the key is, or null. `lines` names the listing's own lines for each beat.
 */
function walk(
  rec: ProbeRecorder,
  m: number,
  key: string,
  lines: { compare: number[]; hit: number[]; next: number },
): number | null {
  let i = rec.home!;
  while (rec.cells[i]!.key !== null) {
    const cell = rec.cells[i]!;
    rec.settle();
    rec.cost += 1;
    if (!cell.deleted && cell.key === key) {
      rec.state.set(i, 'found');
      rec.push('found', lines.hit, `keys[${i}] es ${q(key)}: es la clave.`);
      return i;
    }
    rec.state.set(i, 'active');
    rec.push(
      'compare',
      lines.compare,
      cell.deleted
        ? `keys[${i}] tiene la marca de borrado: se sigue de largo.`
        : `keys[${i}] es ${q(cell.key!)}, no ${q(key)}.`,
    );
    i = step(i, m);
    rec.settle();
    rec.at = i;
    rec.push(
      'walk',
      [lines.next],
      i === 0 && rec.cells.length > 1
        ? 'i da la vuelta: después de la última celda viene la 0.'
        : `i avanza a la celda ${i}.`,
    );
  }
  return null;
}

// ── search: from the hash on, until the key or an empty cell ──────────────

function search(rec: ProbeRecorder, m: number, key: string): void {
  const code = rec.code;
  const h = hashKey(key, m);
  rec.push('start', [lineOf(code, 'boolean contains(')], `Buscar ${q(key)}.`);
  rec.home = h;
  rec.at = h;
  rec.push(
    'walk',
    [lineOf(code, 'int i = hash(key)')],
    `i = hash(${q(key)}) = ${h}: la búsqueda empieza en la celda ${h}.`,
  );
  const where = walk(rec, m, key, {
    compare: [lineOf(code, 'while (keys[i] != null)'), lineOf(code, 'if (!deleted[i]')],
    hit: [lineOf(code, 'if (!deleted[i]'), lineOf(code, 'return true')],
    next: lineOf(code, 'i = (i + 1) % keys.length'),
  });
  const n = rec.cost;
  if (where === null) {
    rec.push(
      'done',
      [lineOf(code, 'while (keys[i] != null)'), lineOf(code, 'return false')],
      `keys[${rec.at}] es null: ${q(key)} no puede estar más allá, porque entre su hash y su celda nunca hay una vacía. contains devuelve false.`,
    );
  }
  rec.settle();
  rec.push(
    'done',
    [],
    where !== null
      ? `${q(key)} está en la tabla: se ${n === 1 ? 'miró' : 'miraron'} ${looked(n)}, desde la posición ${h}.`
      : n === 0
        ? `${q(key)} no está: la celda ${h}, donde lo pone su hash, está vacía.`
        : `${q(key)} no está: se ${n === 1 ? 'miró' : 'miraron'} ${looked(n)} ${n === 1 ? 'ocupada' : 'ocupadas'} desde la posición ${h}, hasta la celda vacía ${rec.at}.`,
  );
}

// ── insert: contains first, then the first cell free or marked ────────────

function insert(rec: ProbeRecorder, m: number, key: string): void {
  const code = rec.code;
  const h = hashKey(key, m);
  const callLine = lineOf(code, 'if (contains(key))');
  rec.push('start', [lineOf(code, 'boolean add(')], `Agregar ${q(key)}.`);

  // contains runs inside one line of add: each cell it looks at is a frame of
  // that line, and the cursor it walks with is its own, so it is not drawn.
  rec.home = h;
  let i = h;
  while (rec.cells[i]!.key !== null) {
    const cell = rec.cells[i]!;
    rec.settle();
    rec.cost += 1;
    if (!cell.deleted && cell.key === key) {
      rec.state.set(i, 'found');
      rec.push(
        'found',
        [callLine, lineOf(code, 'return false')],
        `contains(${q(key)}) la encuentra en la celda ${i}: la clave ya está, y add devuelve false sin agregarla otra vez.`,
      );
      rec.settle();
      rec.push(
        'done',
        [],
        `${q(key)} ya estaba: la tabla no cambia, porque guarda cada clave una vez.`,
      );
      return;
    }
    rec.state.set(i, 'active');
    rec.push(
      'compare',
      [callLine],
      cell.deleted
        ? `contains(${q(key)}) pasa sobre la marca de la celda ${i}.`
        : `contains(${q(key)}) mira la celda ${i}: ${q(cell.key!)} no es ${q(key)}.`,
    );
    i = step(i, m);
  }
  rec.settle();
  rec.push(
    'walk',
    [callLine],
    `contains(${q(key)}) llega a la celda vacía ${i}: ${q(key)} no está.`,
  );

  // The resize check: one frame on its line, or a refusal when the slide's
  // table is too full for the widget, which does not draw this resize.
  const checkLine = lineOf(code, 'if (2 * (used + 1) > keys.length)');
  if (2 * (rec.used + 1) > m) {
    throw new Error(
      `Con ${rec.used} celdas usadas en ${m}, agregar ${q(key)} pasaría de la mitad de la tabla y add la redimensionaría: el widget no dibuja la redimensión del sondeo. Usa una tabla más grande o menos claves.`,
    );
  }
  rec.state.clear();
  rec.push(
    'compare',
    [checkLine],
    `2 · (used + 1) = ${2 * (rec.used + 1)}, no más que keys.length = ${m}: con la clave nueva, la tabla queda a lo más a medio llenar, y no se redimensiona.`,
  );

  rec.at = h;
  rec.push('walk', [lineOf(code, 'int i = hash(key)')], `i = hash(${q(key)}) = ${h}.`);

  const whileLine = lineOf(code, 'while (keys[i] != null && !deleted[i])');
  let at = h;
  while (rec.cells[at]!.key !== null && !rec.cells[at]!.deleted) {
    rec.settle();
    rec.state.set(at, 'active');
    rec.push('compare', [whileLine], `keys[${at}] está ocupada por ${q(rec.cells[at]!.key!)}.`);
    at = step(at, m);
    rec.settle();
    rec.at = at;
    rec.push(
      'walk',
      [lineOf(code, 'i = (i + 1) % keys.length')],
      at === 0
        ? 'i da la vuelta: después de la última celda viene la 0.'
        : `i avanza a la celda ${at}.`,
    );
  }
  rec.settle();
  const reused = rec.cells[at]!.deleted;
  rec.push(
    'compare',
    [whileLine],
    reused
      ? `keys[${at}] tiene la marca de borrado: su celda se puede usar otra vez.`
      : `keys[${at}] es null: aquí entra ${q(key)}.`,
  );

  const usedLine = lineOf(code, 'if (keys[i] == null) used++');
  if (reused) {
    rec.push(
      'compare',
      [usedLine],
      `keys[${at}] tiene una marca, no es null: la celda ya contaba en used, que sigue en ${rec.used}.`,
    );
  } else {
    rec.used += 1;
    rec.push(
      'grow',
      [usedLine],
      `keys[${at}] es null: una celda más pasa a estar usada, y used sube de ${rec.used - 1} a ${rec.used}.`,
    );
  }

  rec.cells[at] = { key, deleted: reused };
  rec.state.set(at, 'new');
  rec.push(
    'build',
    [lineOf(code, 'keys[i] = key')],
    `keys[${at}] = ${q(key)}. Entre su hash, ${h}, y su celda, ${at}, no hay ninguna vacía: la invariante se mantiene.`,
  );
  rec.cells[at] = { key, deleted: false };
  rec.push(
    'build',
    [lineOf(code, 'deleted[i] = false')],
    reused
      ? `deleted[${at}] = false: la marca se borra, la celda vuelve a tener una clave.`
      : `deleted[${at}] = false.`,
  );
  const before = rec.cells.filter((c) => c.key !== null && !c.deleted).length - 1;
  rec.push('grow', [lineOf(code, 'size++')], `size pasa de ${before} a ${before + 1}.`);
  rec.push(
    'done',
    [lineOf(code, 'return true')],
    `add devuelve true: ${q(key)} quedó en la celda ${at}.`,
  );
  rec.settle();
  rec.push(
    'done',
    [],
    `${q(key)} entró en la celda ${at}, ${at === h ? 'la de su hash' : `${(at - h + m) % m} más allá de la de su hash`}.`,
  );
}

// ── remove: find it as contains does, then mark instead of emptying ───────

function remove(rec: ProbeRecorder, m: number, key: string): void {
  const code = rec.code;
  const h = hashKey(key, m);
  rec.push('start', [lineOf(code, 'boolean remove(')], `Eliminar ${q(key)}.`);
  rec.home = h;
  rec.at = h;
  rec.push('walk', [lineOf(code, 'int i = hash(key)')], `i = hash(${q(key)}) = ${h}.`);
  const where = walk(rec, m, key, {
    compare: [lineOf(code, 'while (keys[i] != null)'), lineOf(code, 'if (!deleted[i]')],
    hit: [lineOf(code, 'if (!deleted[i]')],
    next: lineOf(code, 'i = (i + 1) % keys.length'),
  });
  if (where === null) {
    rec.push(
      'done',
      [lineOf(code, 'while (keys[i] != null)'), lineOf(code, 'return false')],
      `keys[${rec.at}] es null: ${q(key)} no está, y remove devuelve false.`,
    );
    rec.settle();
    rec.push('done', [], `${q(key)} no estaba: la tabla no cambia.`);
    return;
  }
  rec.cells[where] = { key, deleted: true };
  rec.state.set(where, 'leaving');
  rec.push(
    'unlink',
    [lineOf(code, 'deleted[i] = true')],
    `deleted[${where}] = true: la clave queda marcada, no borrada. Si la celda quedara vacía, una búsqueda se detendría en ella y no llegaría a las claves que están después; con la marca, la invariante se mantiene.`,
  );
  const live = rec.cells.filter((c) => c.key !== null && !c.deleted).length;
  rec.push('shrink', [lineOf(code, 'size--')], `size pasa de ${live + 1} a ${live}.`);
  rec.push(
    'done',
    [lineOf(code, 'return true')],
    `remove devuelve true: ${q(key)} salió de la tabla.`,
  );
  rec.state.clear();
  rec.push('done', [], `${q(key)} salió: su celda guarda la marca de borrado.`);
}
