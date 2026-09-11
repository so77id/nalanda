/**
 * Pure traces for `<SequenceStepper>` (ADR-0074). One function turns a recipe
 * (which structure), an operation (which animation) and an author-written
 * input into a frame list the widget replays — and into the Java listing the
 * frames highlight lines of.
 *
 * Exported so the suite can pin every valid combination without touching the
 * DOM: the paint is derived from these frames, so a frame list checked exactly
 * leaves the browser only "does it look right" (`apps/web/CLAUDE.md` §2).
 *
 * Frame conventions the widget renders:
 * - `cells` is the structure AFTER this step's effect, in reading order. Each
 *   carries a STABLE `id`, so a node that merely moved is the same node to the
 *   view and can be animated rather than re-created.
 * - `pointers` are the named arrows drawn under (array) or over (list) the
 *   structure. `index: null` means the pointer points at `null` — past the end
 *   of the chain, which is the terminating case every walk ends on.
 * - `cost` is the running count of elementary operations, so the reader can
 *   read $$\Theta(1)$$ against $$\Theta(N)$$ off the counter rather than
 *   memorising it.
 * - `capacity` is the reserved block, for the two array recipes only. The
 *   dynamic array's grows mid-trace; the static array's never does.
 * - `closesRing` marks the circular recipe, whose last node points back at the
 *   first rather than at `null`.
 */

export const RECIPES = [
  'array',
  'dynamic-array',
  'linked-list-singly',
  'linked-list-doubly',
  'linked-list-circular',
] as const;
export type SequenceRecipe = (typeof RECIPES)[number];

export const OPERATIONS = [
  'get-at',
  'insert-first',
  'insert-last',
  'insert-at',
  'insert-ordered',
  'remove-first',
  'remove-last',
  'remove-at',
  'search',
] as const;
export type SequenceOperation = (typeof OPERATIONS)[number];

export type SequenceStepKind =
  'start' | 'walk' | 'compare' | 'shift' | 'grow' | 'build' | 'link' | 'unlink' | 'found' | 'done';

export type SequenceCellState = 'idle' | 'new' | 'active' | 'found' | 'leaving';

export interface SequenceCell {
  /** Stable across frames — the view animates by identity, not by position. */
  id: number;
  value: number;
  state: SequenceCellState;
}

export interface SequencePointer {
  /** `head`, `tail`, `current`, `prev` for lists; `i`, `j` for arrays. */
  name: string;
  /** Index into `cells`, or `null` for a pointer aimed past the end. */
  index: number | null;
}

export interface SequenceStep {
  kind: SequenceStepKind;
  cells: SequenceCell[];
  pointers: SequencePointer[];
  /** 1-based lines of `trace.code` this frame is executing. */
  highlightLines: number[];
  description: string;
  /** Array recipes only: the reserved block size. */
  capacity?: number;
  /**
   * Array recipes only: the block slot by slot, `null` where a slot holds
   * nothing. This is what makes a shift VISIBLE — the element leaves its slot
   * and the hole travels — and a shift the reader cannot see is a
   * $$\Theta(N)$$ the reader has to take on faith. `cells` stays the live
   * elements in order, so everything reading it is unaffected.
   */
  slots?: (SequenceCell | null)[];
  /**
   * A node that EXISTS but is not in the chain yet — drawn as a real node
   * with its own `next` field, because that field is what the operation
   * assigns and the reader has to watch it happen. `next` is the index of
   * the cell it points at, `null` for a link that points at null, and
   * `undefined` while the field has not been assigned at all.
   */
  carry?: {
    value: number;
    label: string;
    next?: number | null;
    /**
     * The slot the floating node is parked ABOVE. Set by an operation that
     * grows at the BACK, so the node hovers over the place it is about to
     * land instead of over the front of the chain. Absent for the rest,
     * which keeps their node where it has always been.
     */
    slot?: number;
  };
  /** Circular recipe: the chain closes back on its first node. */
  closesRing?: boolean;
  /**
   * `head` points at the FLOATING node rather than at the chain. True for the
   * one frame between `head = fresh` running and the node taking its place in
   * the chain — the frame that shows the reassignment before the move, so the
   * two are not conflated into a single jump.
   */
  headToCarry?: boolean;
  /**
   * The index of the node whose `next` points at the FLOATING node rather
   * than where it used to. The mirror of `headToCarry` for a node instead of
   * a variable: the one frame between the assignment running and the node
   * taking its place in the chain. `insertLast` names the last node,
   * `insertAt` the previous one — the assignment is the same, and so is the
   * frame that shows it before the move.
   */
  linkToCarry?: number;
  /** Running elementary-operation count. */
  cost: number;
}

export interface SequenceTrace {
  steps: SequenceStep[];
  code: string;
  /**
   * The most cells any frame holds. The view lays out for THIS, not for the
   * current frame, so the drawing keeps one size from the first frame to the
   * last — a chain that resizes under the reader on every insertion is a
   * chain nobody can follow.
   */
  maxCells: number;
  /**
   * Which end the structure grows from. `right` means new cells arrive at the
   * FRONT, so the existing ones are drawn flush right and a new node lands in
   * the slot already reserved above it, moving nothing.
   */
  align: 'left' | 'right';
  /**
   * Whether ANY frame floats a node above the structure. The row is reserved
   * for the whole trace when so: reserving it per frame made the drawing
   * change height — and therefore width — every time a node appeared or
   * landed, which is the resizing that makes an animation unreadable.
   */
  hasCarry: boolean;
}

export interface SequenceInput {
  values: number[];
  /**
   * Required by every `insert-*` except `insert-ordered`. An ARRAY inserts
   * each value in turn over the same chain, so a slide can show the list
   * growing rather than one insertion in isolation.
   */
  value?: number | number[];
  /**
   * Required by `get-at`, `insert-at` and `remove-at`. An ARRAY runs the
   * operation once per index, over the same chain and in order — which is
   * how a slide shows a cost that depends on WHERE, rather than asserting it.
   */
  index?: number | number[];
  /** Required by `search` and `insert-ordered`. An ARRAY searches each. */
  target?: number | number[];
  /**
   * How many times to run an operation that takes no argument
   * (`remove-first`, `remove-last`). Default one.
   */
  times?: number;
  /** Lists only: draw a `tail` pointer and let the operations use it. */
  tail?: boolean;
}

/**
 * The 1-based line of the first line containing `fragment`.
 *
 * Every frame names the line it is executing by a piece of that line's TEXT,
 * never by a number. `lines` is unvalidated data — `CodeStepper` silently
 * drops an out-of-range number, so a wrong-but-in-range one survives the
 * build, the suite and the preview alike, and #277 shipped two of them,
 * both from renumbering by hand after re-wrapping a listing
 * (`teach-a-data-structure.md` §6bis). Looking the number up removes the
 * class: edit a listing and the frames follow, and a fragment that stops
 * existing throws here instead of lighting the wrong line.
 */
function lineOf(code: string, fragment: string): number {
  const at = code.split('\n').findIndex((line) => line.includes(fragment));
  if (at < 0) throw new Error(`El listado no contiene «${fragment}».`);
  return at + 1;
}

const isList = (recipe: SequenceRecipe) => recipe.startsWith('linked-list');

/**
 * `insert-ordered` is a LIST operation in this course: the ordered list is
 * presented as a variant of the list, and the ordered array is not presented
 * at all. Offering it over an array recipe would put a structure on the page
 * that no slide defines. Every other pair is valid.
 */
/**
 * Which operations each variant recipe has a listing FOR. The widget shows
 * Java the student may copy, so a combination is only valid when the listing
 * belongs to the structure the picture is drawing — and most of them do not:
 *
 * - On a ring, a walk that stops at `null` never stops. Only `insert-first`
 *   has a circular listing (it closes the ring again, and pays a walk for
 *   it); every other circular listing is still the open-chain one.
 * - On a doubly-linked chain, an operation that changes the shape has to fix
 *   BOTH links. Only `insert-first` and `remove-first` do; the read-only
 *   operations are fine because they change nothing, and `remove-last` is
 *   fine only in the `tail` form the class actually teaches.
 *
 * Refusing them is not a limitation to apologise for: it is the difference
 * between a widget that says "not defined here" to its AUTHOR and one that
 * prints wrong Java to a student. The review of #288 found the second.
 */
const CIRCULAR_OPERATIONS: readonly SequenceOperation[] = ['insert-first'];
const DOUBLY_OPERATIONS: readonly SequenceOperation[] = [
  'get-at',
  'search',
  'insert-first',
  'remove-first',
  'remove-last',
];

export function isValidCombination(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  tail = false,
): boolean {
  if (operation === 'insert-ordered' && !isList(recipe)) return false;
  if (recipe === 'linked-list-circular') return CIRCULAR_OPERATIONS.includes(operation);
  if (recipe === 'linked-list-doubly') {
    if (!DOUBLY_OPERATIONS.includes(operation)) return false;
    // Without `tail` the walk to the second-to-last node is the singly
    // listing, which never touches `prev`.
    return operation !== 'remove-last' || tail;
  }
  return true;
}

export function traceFor(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  if (!isValidCombination(recipe, operation, input.tail === true)) {
    throw new Error(`La operación «${operation}» no está definida sobre «${recipe}».`);
  }
  return isList(recipe)
    ? traceList(recipe, operation, input)
    : traceArray(recipe, operation, input);
}

// ── shared helpers ────────────────────────────────────────────────────────

let nextId = 0;
const cellsFrom = (values: number[]): SequenceCell[] =>
  values.map((value) => ({ id: (nextId += 1), value, state: 'idle' as const }));

const snapshot = (cells: SequenceCell[]): SequenceCell[] => cells.map((c) => ({ ...c }));

/**
 * Clears the IN-FLIGHT paint states on the final frame — the ones that mean
 * "the algorithm is looking at this right now". `new` and `found` survive: the
 * last frame of an insertion is exactly where the reader should still see
 * which node was added, and the last frame of a search where the hit was.
 */
const settle = (cells: SequenceCell[]): SequenceCell[] =>
  cells.map((c) =>
    c.state === 'new' || c.state === 'found' ? { ...c } : { ...c, state: 'idle' as const },
  );

/**
 * An author-written argument, read as the list of RUNS it asks for: one value
 * runs the operation once, an array runs it once per element over the same
 * structure. Everything the widget animates several times reads its arguments
 * through here, so the multi-run shape is one rule rather than one per
 * operation.
 */
const asRuns = (v: number | number[] | undefined): number[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

function checkIndex(i: number | undefined, length: number, inclusive: boolean): number {
  const max = inclusive ? length : length - 1;
  if (i === undefined || !Number.isInteger(i) || i < 0 || i > max) {
    throw new Error(`El índice ${i ?? '(ausente)'} está fuera del rango válido [0, ${max}].`);
  }
  return i;
}

function requireIndex(input: SequenceInput, length: number, inclusive: boolean): number {
  return checkIndex(asRuns(input.index)[0], length, inclusive);
}

/**
 * Refuses a slide that would run a removal more times than the chain has
 * nodes — the listing throws `NoSuchElementException` there, and a trace that
 * ran anyway would be animating an exception. Addressed to the AUTHOR, at
 * boot, like every other authoring guard.
 */
function requireRoom(runs: number, length: number, method: string): void {
  if (runs > length) {
    throw new Error(
      `La cadena tiene ${length} nodo${length === 1 ? '' : 's'} y ${method} se ejecuta ${runs} veces: la última correría sobre una lista vacía.`,
    );
  }
}

function requireNonEmpty(values: number[]): void {
  if (values.length === 0) {
    throw new Error('La estructura está vacía: no hay elemento que eliminar.');
  }
}

function requireValues(input: SequenceInput): number[] {
  if (input.value === undefined) throw new Error('Falta el valor a insertar.');
  const list = Array.isArray(input.value) ? input.value : [input.value];
  if (list.length === 0) throw new Error('La lista de valores a insertar está vacía.');
  return list;
}

function requireTarget(input: SequenceInput): number {
  const [t] = asRuns(input.target);
  if (t === undefined) throw new Error('Falta el valor buscado.');
  return t;
}

/** The Java name of each operation, for the program that drives it. */
const METHOD_NAME: Record<SequenceOperation, string> = {
  'get-at': 'getAt',
  'insert-first': 'insertFirst',
  'insert-last': 'insertLast',
  'insert-at': 'insertAt',
  'insert-ordered': 'insertOrdered',
  'remove-first': 'deleteFirst',
  'remove-last': 'deleteLast',
  'remove-at': 'deleteAt',
  search: 'search',
};

// ── the array family ──────────────────────────────────────────────────────

const ARRAY_CODE: Record<Exclude<SequenceOperation, 'insert-ordered'>, string> = {
  'get-at': `int getAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    return data[i];
}`,
  'insert-first': `void insertFirst(int x) {
    if (size == data.length) {
        throw new IllegalStateException("lleno");
    }
    for (int j = size; j > 0; j--) {
        data[j] = data[j - 1];
    }
    data[0] = x;
    size++;
}`,
  'insert-last': `void insertLast(int x) {
    if (size == data.length) {
        throw new IllegalStateException("lleno");
    }
    data[size] = x;
    size++;
}`,
  'insert-at': `void insertAt(int i, int x) {
    if (i < 0 || i > size) {
        throw new IndexOutOfBoundsException();
    }
    if (size == data.length) {
        throw new IllegalStateException("lleno");
    }
    for (int j = size; j > i; j--) {
        data[j] = data[j - 1];
    }
    data[i] = x;
    size++;
}`,
  'remove-first': `int deleteFirst() {
    if (size == 0) {
        throw new NoSuchElementException();
    }
    int x = data[0];
    for (int j = 0; j < size - 1; j++) {
        data[j] = data[j + 1];
    }
    size--;
    return x;
}`,
  'remove-last': `int deleteLast() {
    if (size == 0) {
        throw new NoSuchElementException();
    }
    int x = data[size - 1];
    size--;
    return x;
}`,
  'remove-at': `int deleteAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    int x = data[i];
    for (int j = i; j < size - 1; j++) {
        data[j] = data[j + 1];
    }
    size--;
    return x;
}`,
  search: `int search(int x) {
    for (int i = 0; i < size; i++) {
        if (data[i] == x) {
            return i;
        }
    }
    return -1;
}`,
};

const DYNAMIC_INSERT_CODE: Record<'insert-first' | 'insert-last' | 'insert-at', string> = {
  'insert-first': `void insertFirst(int x) {
    if (size == data.length) {
        resize(2 * data.length);
    }
    for (int j = size; j > 0; j--) {
        data[j] = data[j - 1];
    }
    data[0] = x;
    size++;
}`,
  'insert-last': `void insertLast(int x) {
    if (size == data.length) {
        resize(2 * data.length);
    }
    data[size] = x;
    size++;
}`,
  'insert-at': `void insertAt(int i, int x) {
    if (i < 0 || i > size) {
        throw new IndexOutOfBoundsException();
    }
    if (size == data.length) {
        resize(2 * data.length);
    }
    for (int j = size; j > i; j--) {
        data[j] = data[j - 1];
    }
    data[i] = x;
    size++;
}`,
};

function arrayCode(recipe: SequenceRecipe, operation: SequenceOperation): string {
  if (recipe === 'dynamic-array' && operation in DYNAMIC_INSERT_CODE) {
    return DYNAMIC_INSERT_CODE[operation as keyof typeof DYNAMIC_INSERT_CODE];
  }
  return ARRAY_CODE[operation as Exclude<SequenceOperation, 'insert-ordered'>];
}

/**
 * The array family animates ONE run. Its trace was written before the
 * multi-run arguments existed and reads only the first of each — which the
 * #288 review caught as a contract the catalog and the guide were already
 * advertising. Refused at boot rather than silently honoured in part: a slide
 * that asks for three runs and gets one is a slide whose cost claim is wrong.
 */
function refuseMultiRun(operation: SequenceOperation, input: SequenceInput): void {
  const runs = Math.max(
    asRuns(input.value).length,
    asRuns(input.index).length,
    asRuns(input.target).length,
    input.times ?? 1,
  );
  if (runs > 1) {
    throw new Error(
      `Las recetas de arreglo animan una sola corrida; «${operation}» recibió ${runs}. Sobre una lista enlazada sí se puede.`,
    );
  }
}

function traceArray(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  refuseMultiRun(operation, input);
  const code = arrayCode(recipe, operation);
  const grows = recipe === 'dynamic-array';
  // The static array is drawn with room to spare — its capacity is fixed at
  // creation and the class's point is that it can run out. The dynamic array
  // is drawn FULL, so that a single insertion shows the resize it exists for.
  let capacity = grows ? Math.max(input.values.length, 1) : input.values.length + 2;

  // The block, slot by slot. A move empties the slot it came from, so the
  // reader watches the hole travel and counts the copies — which is the whole
  // lesson of an array insertion.
  const slots: (SequenceCell | null)[] = Array.from({ length: capacity }, () => null);
  cellsFrom(input.values).forEach((cell, i) => {
    slots[i] = cell;
  });
  const live = (): SequenceCell[] => slots.filter((s): s is SequenceCell => s !== null);
  /** Index of the last occupied slot, + 1 — the array's `size`. */
  const size = (): number => {
    let n = 0;
    slots.forEach((s, i) => {
      if (s !== null) n = i + 1;
    });
    return n;
  };

  const steps: SequenceStep[] = [];
  let cost = 0;
  const push = (
    kind: SequenceStepKind,
    highlightLines: number[],
    description: string,
    extra: Partial<SequenceStep> = {},
  ) => {
    steps.push({
      kind,
      cells: snapshot(live()),
      slots: slots.map((s) => (s === null ? null : { ...s })),
      pointers: [],
      highlightLines,
      description,
      capacity,
      cost,
      ...extra,
    });
  };

  const clearTransient = () => {
    slots.forEach((s, i) => {
      if (s !== null && s.state === 'active') slots[i] = { ...s, state: 'idle' };
    });
  };

  const growIfNeeded = (): number => {
    // Only the dynamic array grows, and only when the block is actually full.
    if (!grows || live().length < capacity) return 0;
    const copied = live().length;
    capacity = capacity * 2;
    while (slots.length < capacity) slots.push(null);
    cost += copied;
    push(
      'grow',
      [lineOf(code, 'size == data.length'), lineOf(code, 'resize(')],
      `El bloque está lleno: se reserva uno del doble (${capacity}) y se copian los ${copied} elementos.`,
    );
    return 3;
  };

  switch (operation) {
    case 'insert-first':
    case 'insert-last':
    case 'insert-at': {
      const [x] = requireValues(input) as [number];
      const at =
        operation === 'insert-first'
          ? 0
          : operation === 'insert-last'
            ? size()
            : requireIndex(input, size(), true);
      growIfNeeded();
      const n = size();
      push('start', [1], `Insertamos ${x} en la posición ${at} de un arreglo de ${n} elementos.`, {
        carry: { value: x, label: 'x' },
      });
      // Copy right, from the last element down to the insertion point. Each
      // copy vacates its source, so a hole opens at `at`.
      const shiftLines =
        operation === 'insert-last'
          ? []
          : [lineOf(code, 'for (int j = size'), lineOf(code, 'data[j] = data[j - 1]')];
      for (let j = n; j > at; j -= 1) {
        cost += 1;
        const moved = slots[j - 1]!;
        slots[j] = { ...moved, state: 'active' };
        slots[j - 1] = null;
        push('shift', shiftLines, `Copiamos ${moved.value} de la posición ${j - 1} a la ${j}.`, {
          pointers: [{ name: 'j', index: j }],
          carry: { value: x, label: 'x' },
        });
        clearTransient();
      }
      cost += 1;
      slots[at] = { id: (nextId += 1), value: x, state: 'new' };
      const writeLine = lineOf(
        code,
        operation === 'insert-last'
          ? 'data[size] = x'
          : operation === 'insert-first'
            ? 'data[0] = x'
            : 'data[i] = x',
      );
      push(
        'link',
        [writeLine],
        `Escribimos ${x} en la posición ${at}. El largo pasa a ${size()}.`,
        {
          pointers: [{ name: 'i', index: at }],
        },
      );
      break;
    }
    case 'remove-first':
    case 'remove-last':
    case 'remove-at': {
      requireNonEmpty(input.values);
      const n = size();
      const at =
        operation === 'remove-first'
          ? 0
          : operation === 'remove-last'
            ? n - 1
            : requireIndex(input, n, false);
      const removed = slots[at]!;
      slots[at] = { ...removed, state: 'leaving' };
      cost += 1;
      push(
        'start',
        [lineOf(code, 'int x = data[')],
        `Guardamos ${removed.value}, el elemento de la posición ${at}.`,
        {
          pointers: [{ name: 'i', index: at }],
        },
      );
      slots[at] = null;
      // Copy left, closing the hole the removal opened.
      const shiftLines =
        operation === 'remove-last'
          ? []
          : [lineOf(code, 'for (int j = '), lineOf(code, 'data[j] = data[j + 1]')];
      for (let j = at; j < n - 1; j += 1) {
        cost += 1;
        const moved = slots[j + 1]!;
        slots[j] = { ...moved, state: 'active' };
        slots[j + 1] = null;
        push('shift', shiftLines, `Copiamos ${moved.value} de la posición ${j + 1} a la ${j}.`, {
          pointers: [{ name: 'j', index: j }],
        });
        clearTransient();
      }
      push(
        'done',
        [lineOf(code, 'size--')],
        `El largo pasa a ${size()}. Devolvemos ${removed.value}.`,
      );
      break;
    }
    case 'get-at': {
      const at = requireIndex(input, size(), false);
      push('start', [lineOf(code, 'i >= size')], `Pedimos el elemento de la posición ${at}.`);
      cost += 1;
      slots[at] = { ...slots[at]!, state: 'found' };
      push(
        'found',
        [lineOf(code, 'return data[i]')],
        `La posición ${at} vive en base + ${at} × tamaño: una cuenta, y ya estamos ahí.`,
        { pointers: [{ name: 'i', index: at }] },
      );
      break;
    }
    case 'search': {
      const target = requireTarget(input);
      const n = size();
      push(
        'start',
        [lineOf(code, 'for (int i = 0')],
        `Buscamos ${target} recorriendo el arreglo desde la posición 0.`,
      );
      let found = -1;
      for (let j = 0; j < n; j += 1) {
        cost += 1;
        const cell = slots[j]!;
        const hit = cell.value === target;
        slots[j] = { ...cell, state: hit ? 'found' : 'active' };
        push(
          'compare',
          [lineOf(code, 'for (int i = 0'), lineOf(code, 'if (data[i] == x')],
          `¿data[${j}] = ${cell.value} es ${target}? ${hit ? 'Sí.' : 'No.'}`,
          {
            pointers: [{ name: 'j', index: j }],
          },
        );
        if (hit) {
          found = j;
          break;
        }
        clearTransient();
      }
      push(
        found >= 0 ? 'found' : 'done',
        found >= 0 ? [lineOf(code, 'return i;')] : [lineOf(code, 'return -1;')],
        found >= 0
          ? `Encontramos ${target} en la posición ${found}.`
          : `Recorrimos las ${n} posiciones: ${target} no está en el arreglo.`,
      );
      break;
    }
    default:
      throw new Error(`Operación no soportada sobre un arreglo: ${operation}`);
  }

  const last = steps.at(-1)!;
  steps[steps.length - 1] = {
    ...last,
    cells: settle(last.cells),
    slots: (last.slots ?? []).map((s) => (s === null ? null : settle([s])[0]!)),
  };
  return {
    steps,
    code,
    maxCells: Math.max(...steps.map((f) => f.cells.length)),
    align: 'left',
    hasCarry: steps.some((f) => f.carry !== undefined),
  };
}

// ── the list family ───────────────────────────────────────────────────────

/**
 * The listings differ by recipe where the CODE differs, and only there: the
 * doubly-linked recipe maintains `prev`, and the circular recipe terminates
 * its walks on `head` rather than on `null`. Everything else is shared, which
 * is the point the class makes — the operations are the same, what changes is
 * where the cost lives.
 */
/**
 * The program that drives the operation, appended under the method when a
 * slide inserts several values. Without it the reader watches three identical
 * runs of one method with no way to tell which call is running; with it, the
 * frame lights the call AND the line inside the method, so both halves of
 * "where are we" are on screen.
 */
function callingProgram(args: string[], method: string, fresh: boolean): string {
  return [
    '',
    // Only a chain that STARTS empty was built by this program. Printing the
    // constructor over a populated `values` would be a listing that
    // contradicts the picture beside it.
    ...(fresh ? ['LinkedList list = new LinkedList();'] : []),
    ...args.map((a) => `list.${method}(${a});`),
  ].join('\n');
}

/**
 * The arguments each run of `operation` is called with, as they are written
 * in Java. One entry per run: `['5', '1']` is two calls, `['', '']` two calls
 * that take none. Empty when the author asked for a single run, which is what
 * suppresses the driving program.
 */
function runArgs(operation: SequenceOperation, input: SequenceInput): string[] {
  switch (operation) {
    case 'insert-first':
    case 'insert-last':
      return asRuns(input.value).map(String);
    case 'insert-at': {
      const values = asRuns(input.value);
      const indices = asRuns(input.index);
      if (values.length !== indices.length) {
        throw new Error(
          `insertAt necesita un índice por cada valor: ${values.length} valores y ${indices.length} índices.`,
        );
      }
      return values.map((v, i) => `${indices[i]}, ${v}`);
    }
    case 'get-at':
    case 'remove-at':
      return asRuns(input.index).map(String);
    case 'search':
      return asRuns(input.target).map(String);
    case 'remove-first':
    case 'remove-last': {
      const times = input.times ?? 1;
      requireRuns(times);
      return Array.from({ length: times }, () => '');
    }
    case 'insert-ordered':
      return asRuns(input.target).map(String);
  }
}

function listCode(recipe: SequenceRecipe, operation: SequenceOperation, tail: boolean): string {
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const end = circular ? 'current.next != head' : 'current.next != null';

  switch (operation) {
    case 'insert-first':
      // The circular recipe cannot share the open-chain listing: the node
      // that used to point at `head` is the LAST one, and on a ring it still
      // exists. Left unchanged it points at the old first node and the ring
      // is broken — the invariant the slide introducing the variant states.
      // Finding it is a walk, so the ring costs this operation its Θ(1).
      if (circular) {
        return `void insertFirst(int x) {
    Node fresh = new Node(x);
    if (head == null) {
        fresh.next = fresh;
    } else {
        Node last = head;
        while (last.next != head) {
            last = last.next;
        }
        fresh.next = head;
        last.next = fresh;
    }
    head = fresh;
    size++;
}`;
      }
      return doubly
        ? `void insertFirst(int x) {
    Node fresh = new Node(x);
    fresh.next = head;
    if (head != null) head.prev = fresh;
    head = fresh;
    size++;
}`
        : `void insertFirst(int x) {
    Node fresh = new Node(x);
    fresh.next = head;
    head = fresh;
    size++;
}`;
    case 'insert-last':
      // Both variants branch on the empty chain first: with no nodes there is
      // no last node to link to, and the previous listing dereferenced `head`
      // without asking. One `size++` at the end, not one per branch, so no
      // fragment of this listing appears twice — `lineOf` names lines by text.
      return tail
        ? `void insertLast(int x) {
    Node fresh = new Node(x);
    if (head == null) {
        head = fresh;
    } else {
        tail.next = fresh;
    }
    tail = fresh;
    size++;
}`
        : `void insertLast(int x) {
    Node fresh = new Node(x);
    if (head == null) {
        head = fresh;
    } else {
        Node current = head;
        while (${end}) {
            current = current.next;
        }
        current.next = fresh;
    }
    size++;
}`;
    case 'insert-at':
      // Position 0 has no previous node to modify, and the walk below cannot
      // produce one: `prev` would still be `head` and the insertion would
      // land in the wrong place. The branch delegates to the operation that
      // is defined there, which is also how the reader should think of it.
      return `void insertAt(int i, int x) {
    if (i < 0 || i > size) {
        throw new IndexOutOfBoundsException();
    }
    if (i == 0) {
        insertFirst(x);
        return;
    }
    Node fresh = new Node(x);
    Node prev = head;
    for (int j = 0; j < i - 1; j++) {
        prev = prev.next;
    }
    fresh.next = prev.next;
    prev.next = fresh;
    size++;
}`;
    case 'insert-ordered':
      // The walk looks at `prev.next`, so it can never place a value that
      // belongs BEFORE the first node: `prev` would still be `head` and the
      // value would land second. The front is a case of its own, and it is
      // the operation the front already has.
      return `void insertOrdered(int x) {
    if (head == null || x <= head.value) {
        insertFirst(x);
        return;
    }
    Node fresh = new Node(x);
    Node prev = head;
    while (prev.next != null && prev.next.value < x) {
        prev = prev.next;
    }
    fresh.next = prev.next;
    prev.next = fresh;
    size++;
}`;
    case 'remove-first':
      return doubly
        ? `int deleteFirst() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = head;
    head = head.next;
    if (head != null) head.prev = null;
    size--;
    return old.value;
}`
        : `int deleteFirst() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = head;
    head = head.next;
    size--;
    return old.value;
}`;
    case 'remove-last':
      // A chain of ONE has no second-to-last node, and both bodies below
      // assume there is one: `prev.next.next` dereferences `null`, and
      // `tail.prev` walks off the front. The branch is the guard, and one
      // `size--` at the end keeps every fragment of the listing unique —
      // `lineOf` names lines by text.
      return doubly && tail
        ? `int deleteLast() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = tail;
    if (head == tail) {
        head = null;
        tail = null;
    } else {
        tail = tail.prev;
        tail.next = null;
    }
    size--;
    return old.value;
}`
        : `int deleteLast() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old;
    if (head.next == null) {
        old = head;
        head = null;
    } else {
        Node prev = head;
        while (prev.next.next != null) {
            prev = prev.next;
        }
        old = prev.next;
        prev.next = null;
    }
    size--;
    return old.value;
}`;
    case 'remove-at':
      // Same hole as insertAt's, and the same branch: at position 0 there is
      // no previous node, so `deleteFirst` is what the operation means there.
      return `int deleteAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    if (i == 0) {
        return deleteFirst();
    }
    Node prev = head;
    for (int j = 0; j < i - 1; j++) {
        prev = prev.next;
    }
    Node old = prev.next;
    prev.next = old.next;
    size--;
    return old.value;
}`;
    case 'get-at':
      return `int getAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
    }
    Node current = head;
    for (int j = 0; j < i; j++) {
        current = current.next;
    }
    return current.value;
}`;
    case 'search':
      return `int search(int x) {
    Node current = head;
    for (int i = 0; current != null; i++) {
        if (current.value == x) {
            return i;
        }
        current = current.next;
    }
    return -1;
}`;
  }
}

/**
 * The most times an author may ask for one operation. The chain-length guard
 * in the component counts cells, not RUNS, so `times={1e8}` used to allocate
 * its driving program before any guard could refuse it — measured: a heap
 * exhaustion that takes the tab down instead of printing an authoring error.
 */
const MAX_RUNS = 12;

function requireRuns(runs: number): void {
  if (!Number.isInteger(runs) || runs < 1 || runs > MAX_RUNS) {
    throw new Error(
      `La operación se ejecuta ${runs} veces. Entre 1 y ${MAX_RUNS}: más pasos de los que nadie sigue en una slide.`,
    );
  }
}

function traceList(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  const tail = input.tail === true;
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  // How many times the author asked for the operation, and the program that
  // drives it. A single run keeps the listing alone — the widget shows one
  // operation and the slide's prose does the talking. Several runs append the
  // calls, so every frame lights BOTH the line inside the method and the call
  // that is running, and the reader can see which run they are watching.
  const base = listCode(recipe, operation, tail);
  const args = runArgs(operation, input);
  requireRuns(args.length);
  // A zero-length argument list traces nothing, and `steps.at(-1)!` at the
  // settle step turns that into an English JS message rendered to the page.
  if (args.length === 0) {
    throw new Error('La operación no se ejecuta ninguna vez: falta el argumento que la corre.');
  }
  const many = args.length > 1;
  const fresh = input.values.length === 0;
  const code = many ? base + callingProgram(args, METHOD_NAME[operation], fresh) : base;
  // Computed, not searched: two runs of a method that takes no argument write
  // the SAME call line twice, and `lineOf` would hand both the first one.
  const runLine = (run: number): number[] =>
    many ? [base.split('\n').length + (fresh ? 1 : 0) + run + 1] : [];
  // How wide the drawing will get, so an operation that grows at the FRONT
  // can park its floating node over the slot it is about to occupy.
  const maxSlots = input.values.length + (operation.startsWith('insert') ? args.length : 0);
  const cells = cellsFrom(input.values);
  const steps: SequenceStep[] = [];
  let cost = 0;

  const basePointers = (extra: SequencePointer[] = []): SequencePointer[] => {
    const pointers: SequencePointer[] = [{ name: 'head', index: cells.length > 0 ? 0 : null }];
    if (tail) pointers.push({ name: 'tail', index: cells.length > 0 ? cells.length - 1 : null });
    return [...pointers, ...extra];
  };

  const push = (
    kind: SequenceStepKind,
    highlightLines: number[],
    description: string,
    extra: Partial<SequenceStep> & { pointers?: SequencePointer[] } = {},
  ) => {
    const { pointers, ...rest } = extra;
    steps.push({
      kind,
      cells: snapshot(cells),
      pointers: pointers ?? basePointers(),
      highlightLines,
      description,
      cost,
      ...(circular ? { closesRing: true } : {}),
      ...rest,
    });
  };

  /**
   * Walks `prev` from head to `stop`, one frame per hop. `extra` carries what
   * has to survive the walk: the floating node an insertion is holding, and
   * the call line of the run being watched.
   */
  const walkTo = (
    stop: number,
    lines: number[],
    label: string,
    extra: Partial<SequenceStep> & { lead?: number[] } = {},
  ) => {
    const { lead = [], ...rest } = extra;
    for (let j = 0; j < stop; j += 1) {
      cost += 1;
      cells[j] = { ...cells[j]!, state: 'active' };
      push(
        'walk',
        [...lead, ...lines],
        `${label} avanza al nodo ${cells[j]!.value} (paso ${j + 1}).`,
        {
          ...rest,
          pointers: basePointers([{ name: label, index: j }]),
        },
      );
      cells[j] = { ...cells[j]!, state: 'idle' };
    }
  };

  switch (operation) {
    case 'insert-first': {
      // Four frames per value, one per line of the method, and each one is a
      // state the reader can name: the node exists pointing at null; its link
      // is aimed at the old first node; `head` is aimed at IT, still floating;
      // and only then does it take its place in the chain. Collapsing the last
      // two would show the pointer move and the node move as one jump.
      requireValues(input).forEach((x, run) => {
        const wasFirst = cells.length > 0 ? cells[0]!.value : null;
        const callLine = runLine(run);
        if (circular) {
          // Same four-frame discipline, with the walk the ring forces in the
          // middle: the last node has to be found before it can be told the
          // first one changed.
          const held = { value: x, label: 'fresh', slot: Math.max(maxSlots - cells.length - 1, 0) };
          cost += 1;
          push('build', [...callLine, lineOf(code, 'new Node(x)')], `Creamos el nodo ${x}.`, {
            carry: held,
          });
          if (cells.length === 0) {
            cost += 1;
            push(
              'link',
              [...callLine, lineOf(code, 'fresh.next = fresh')],
              `La cadena estaba vacía: ${x} se apunta a sí mismo y el anillo tiene un solo nodo.`,
              { carry: held },
            );
          } else {
            cost += 1;
            push(
              'start',
              [...callLine, lineOf(code, 'Node last = head')],
              `last parte en head, sobre el nodo ${cells[0]!.value}.`,
              { carry: held, pointers: basePointers([{ name: 'last', index: 0 }]) },
            );
            for (let j = 1; j < cells.length; j += 1) {
              cost += 1;
              cells[j] = { ...cells[j]!, state: 'active' };
              push(
                'walk',
                [
                  ...callLine,
                  lineOf(code, 'while (last.next != head)'),
                  lineOf(code, 'last = last.next'),
                ],
                `last.next todavía no es head: avanzamos al nodo ${cells[j]!.value}.`,
                { carry: held, pointers: basePointers([{ name: 'last', index: j }]) },
              );
              cells[j] = { ...cells[j]!, state: 'idle' };
            }
            cost += 1;
            push(
              'link',
              [...callLine, lineOf(code, 'fresh.next = head')],
              `${x} apunta a ${wasFirst}, que era el primero.`,
              {
                carry: { ...held, next: 0 },
                pointers: basePointers([{ name: 'last', index: cells.length - 1 }]),
              },
            );
            cost += 1;
            push(
              'link',
              [...callLine, lineOf(code, 'last.next = fresh')],
              `El último cierra el anillo sobre ${x} en vez de sobre ${wasFirst}.`,
              {
                carry: { ...held, next: 0 },
                linkToCarry: cells.length - 1,
                pointers: basePointers([{ name: 'last', index: cells.length - 1 }]),
              },
            );
          }
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'head = fresh')],
            `head pasa a apuntar al nodo ${x}.`,
            { carry: { ...held, next: cells.length > 0 ? 0 : null }, headToCarry: true },
          );
          cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
          cost += 1;
          push(
            'done',
            [...callLine, lineOf(code, 'size++')],
            `El nodo ${x} queda primero y el anillo está cerrado. El largo pasa a ${cells.length}.`,
          );
          cells[0] = { ...cells[0]!, state: 'idle' };
          return;
        }
        cost += 1;
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x}. Su next todavía no apunta a nadie.`,
          { carry: { value: x, label: 'fresh', next: null } },
        );
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'fresh.next = head')],
          wasFirst === null
            ? `fresh.next toma el valor de head, que es null: la cadena estaba vacía.`
            : `fresh.next toma el valor de head, así que apunta a ${wasFirst}.`,
          { carry: { value: x, label: 'fresh', next: cells.length > 0 ? 0 : null } },
        );
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'head = fresh')],
          `head pasa a apuntar al nodo ${x}, que ya está enlazado a la cadena.`,
          {
            carry: { value: x, label: 'fresh', next: cells.length > 0 ? 0 : null },
            headToCarry: true,
          },
        );
        cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `El nodo ${x} queda como primero de la cadena. El largo pasa a ${cells.length}.`,
        );
        cells[0] = { ...cells[0]!, state: 'idle' };
      });
      break;
    }
    case 'insert-last': {
      // The same four-frame discipline as insert-first, with one branch more:
      // an empty chain has no last node to link to, so what the insertion
      // assigns is `head` itself. Starting from zero shows that branch taken
      // once and never again — and the walk getting one hop longer on every
      // insertion, which is the $$\Theta(N)$$ this slide is about.
      requireValues(input).forEach((x, run) => {
        const callLine = runLine(run);
        // Parked above the slot the node will land in, so it lands where it
        // has been hovering rather than jumping across the chain.
        const held = { value: x, label: 'fresh', next: null, slot: cells.length };
        const empty = cells.length === 0;
        cost += 1;
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x}. Es el que quedará último, así que su next es null.`,
          { carry: held },
        );
        cost += 1;
        push(
          'compare',
          [...callLine, lineOf(code, 'if (head == null)')],
          empty
            ? 'head es null: la cadena está vacía, así que el nodo nuevo es también el primero.'
            : 'head no es null: hay un último nodo, y hay que caminar hasta él.',
          { carry: held },
        );
        if (empty) {
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'head = fresh')],
            `head pasa a apuntar al nodo ${x}: la cadena deja de estar vacía.`,
            { carry: held, headToCarry: true },
          );
        } else if (tail) {
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'tail.next = fresh')],
            `tail ya apunta al último: enlazamos ${x} sin recorrer nada.`,
            { carry: held, linkToCarry: cells.length - 1 },
          );
        } else {
          // `current` starts at head and stops on the node whose next is null.
          // The last hop leaves it THERE, so the linking frame still shows
          // which node is being modified.
          for (let j = 0; j < cells.length; j += 1) {
            cost += 1;
            cells[j] = { ...cells[j]!, state: 'active' };
            push(
              // `current = head` is not a hop: the walk frames are exactly the
              // hops, so counting them reproduces the $$N - 1$$ the prose claims.
              j === 0 ? 'start' : 'walk',
              j === 0
                ? [...callLine, lineOf(code, 'Node current = head')]
                : [
                    ...callLine,
                    lineOf(
                      code,
                      `while (${circular ? 'current.next != head' : 'current.next != null'}`,
                    ),
                    lineOf(code, 'current = current.next'),
                  ],
              j === 0
                ? `current parte en head, sobre el nodo ${cells[0]!.value}.`
                : `current.next no era null: avanzamos al nodo ${cells[j]!.value} (salto ${j}).`,
              { carry: held, pointers: basePointers([{ name: 'current', index: j }]) },
            );
            if (j < cells.length - 1) cells[j] = { ...cells[j]!, state: 'idle' };
          }
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'current.next = fresh')],
            `current.next deja de ser null y pasa a apuntar al nodo ${x}.`,
            {
              carry: held,
              linkToCarry: cells.length - 1,
              pointers: basePointers([{ name: 'current', index: cells.length - 1 }]),
            },
          );
          cells[cells.length - 1] = { ...cells[cells.length - 1]!, state: 'idle' };
        }
        cells.push({ id: (nextId += 1), value: x, state: 'new' });
        if (tail) {
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'tail = fresh')],
            `tail pasa a apuntar al nodo ${x}, que ya es el último de la cadena.`,
          );
        }
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `El nodo ${x} queda al final de la cadena. El largo pasa a ${cells.length}.`,
        );
        cells[cells.length - 1] = { ...cells[cells.length - 1]!, state: 'idle' };
      });
      break;
    }
    case 'insert-at': {
      const values = requireValues(input);
      const indices = asRuns(input.index);
      values.forEach((x, run) => {
        const callLine = runLine(run);
        // Validated against the chain as it is NOW: three insertions in a row
        // move every position after the first one.
        const at = checkIndex(indices[run] ?? indices[0], cells.length, true);
        if (at === 0) {
          // No previous node exists at the front, so the method hands the
          // work to insertFirst. Two frames, drawn in insertFirst's own
          // vocabulary — the node floats, head reaches it, then it lands.
          // Parked over slot 0 — the slot it will occupy. Left at the
          // default the floating node sits mid-chain, and `head` reaching up
          // to it crosses both the first node and the link coming down from
          // the node itself.
          const held = {
            value: x,
            label: 'fresh',
            next: cells.length > 0 ? 0 : null,
            slot: 0,
          };
          cost += 1;
          push(
            'compare',
            [...callLine, lineOf(code, 'if (i == 0)')],
            `La posición es 0: no hay nodo previo que modificar, así que el trabajo es el de insertFirst.`,
            { carry: held },
          );
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `head pasa a apuntar al nodo ${x}, que ya está enlazado a la cadena.`,
            { carry: held, headToCarry: true },
          );
          cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
          push(
            'done',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `El nodo ${x} queda en la posición 0. El largo pasa a ${cells.length}.`,
          );
          cells[0] = { ...cells[0]!, state: 'idle' };
          return;
        }
        const held = { value: x, label: 'fresh', slot: at };
        // Inserting AT `size` is legal and means "at the end": there is no
        // node to displace, and what the new node's `next` takes is `null`.
        const displaced = cells[at];
        cost += 1;
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x} para la posición ${at}.`,
          { carry: held },
        );
        walkTo(at - 1, [lineOf(code, 'for (int j'), lineOf(code, 'prev = prev.next')], 'prev', {
          carry: held,
          lead: callLine,
        });
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'fresh.next = prev.next')],
          displaced === undefined
            ? `${x} toma el enlace del previo, que era null: va a quedar último.`
            : `${x} apunta al nodo que ocupaba la posición ${at}.`,
          {
            carry: { ...held, next: displaced === undefined ? null : at },
            pointers: basePointers([{ name: 'prev', index: at - 1 }]),
          },
        );
        // The second assignment, before the node moves — the same frame
        // insertLast gets at the end of the chain. Without it the pointer
        // change and the node taking its place read as one jump.
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'prev.next = fresh')],
          displaced === undefined
            ? `El último nodo deja de apuntar a null y pasa a apuntar a ${x}.`
            : `El nodo anterior deja de apuntar a ${displaced.value} y pasa a apuntar a ${x}.`,
          {
            carry: { ...held, next: displaced === undefined ? null : at },
            linkToCarry: at - 1,
            pointers: basePointers([{ name: 'prev', index: at - 1 }]),
          },
        );
        cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `El nodo ${x} queda en la posición ${at}. El largo pasa a ${cells.length}.`,
        );
        cells[at] = { ...cells[at]!, state: 'idle' };
      });
      break;
    }
    case 'insert-ordered': {
      const sorted = input.values.every((v, i) => i === 0 || input.values[i - 1]! <= v);
      if (!sorted) {
        throw new Error('La lista de partida debe venir ordenada para insertar en orden.');
      }
      asRuns(input.target).forEach((x, run) => {
        const callLine = runLine(run);
        const first = cells.length === 0 ? null : cells[0]!.value;
        cost += 1;
        push(
          'compare',
          [...callLine, lineOf(code, 'if (head == null || x <= head.value)')],
          first === null
            ? `La cadena está vacía: ${x} es el primero.`
            : first >= x
              ? `¿${x} es menor o igual que ${first}, el primero? Sí: va al frente, y de eso ya sabe insertFirst.`
              : `¿${x} es menor o igual que ${first}, el primero? No: hay que buscarle lugar más adelante.`,
        );
        if (first === null || first >= x) {
          const held = {
            value: x,
            label: 'fresh',
            next: cells.length > 0 ? 0 : null,
            slot: 0,
          };
          cost += 1;
          push(
            'link',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `head pasa a apuntar a ${x}.`,
            {
              carry: held,
              headToCarry: true,
            },
          );
          cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
          push(
            'done',
            [...callLine, lineOf(code, 'insertFirst(x)')],
            `El nodo ${x} queda primero y el orden se mantiene. El largo pasa a ${cells.length}.`,
          );
          cells[0] = { ...cells[0]!, state: 'idle' };
          return;
        }
        cost += 1;
        // `prev` walks the node BEFORE the gap, exactly as the listing does:
        // the comparison is always against `prev.next`, never against `prev`.
        let prev = 0;
        const held = { value: x, label: 'fresh', slot: 1 };
        push(
          'build',
          [...callLine, lineOf(code, 'new Node(x)')],
          `Creamos el nodo ${x} y buscamos entre qué dos nodos va.`,
          { carry: held },
        );
        push(
          'start',
          [...callLine, lineOf(code, 'Node prev = head')],
          `prev parte en head, sobre el nodo ${cells[0]!.value}.`,
          { carry: held, pointers: basePointers([{ name: 'prev', index: 0 }]) },
        );
        for (;;) {
          const nextCell = cells[prev + 1];
          const goes = nextCell !== undefined && nextCell.value < x;
          cost += 1;
          push(
            'compare',
            goes
              ? [...callLine, lineOf(code, 'while (prev.next'), lineOf(code, 'prev = prev.next')]
              : [...callLine, lineOf(code, 'while (prev.next')],
            nextCell === undefined
              ? `prev.next es null: ${x} es mayor que todos y va al final.`
              : goes
                ? `¿${nextCell.value} < ${x}? Sí: ${x} va más adelante.`
                : `¿${nextCell.value} < ${x}? No: el lugar de ${x} es entre ${cells[prev]!.value} y ${nextCell.value}.`,
            {
              carry: { ...held, slot: prev + 1 },
              pointers: basePointers([{ name: 'prev', index: prev }]),
            },
          );
          if (!goes) break;
          prev += 1;
        }
        const at = prev + 1;
        const displaced = cells[at];
        const parked = { ...held, slot: at };
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'fresh.next = prev.next')],
          displaced === undefined
            ? `${x} toma el enlace del previo, que era null: va a quedar último.`
            : `${x} apunta a ${displaced.value}, el nodo que seguía.`,
          {
            carry: { ...parked, next: displaced === undefined ? null : at },
            pointers: basePointers([{ name: 'prev', index: prev }]),
          },
        );
        cost += 1;
        push(
          'link',
          [...callLine, lineOf(code, 'prev.next = fresh')],
          `${cells[prev]!.value} deja de apuntar a ${displaced === undefined ? 'null' : displaced.value} y pasa a apuntar a ${x}.`,
          {
            carry: { ...parked, next: displaced === undefined ? null : at },
            linkToCarry: prev,
            pointers: basePointers([{ name: 'prev', index: prev }]),
          },
        );
        cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
        cost += 1;
        push(
          'done',
          [...callLine, lineOf(code, 'size++')],
          `${x} queda en la posición ${at} y el orden se mantiene. El largo pasa a ${cells.length}.`,
        );
        cells[at] = { ...cells[at]!, state: 'idle' };
      });
      break;
    }
    case 'remove-first': {
      requireNonEmpty(input.values);
      requireRoom(args.length, cells.length, 'deleteFirst');
      args.forEach((_, run) => {
        const callLine = runLine(run);
        const removed = cells[0]!;
        cells[0] = { ...removed, state: 'leaving' };
        cost += 1;
        push(
          'start',
          [...callLine, lineOf(code, 'Node old = head')],
          `Guardamos el primer nodo (${removed.value}).`,
        );
        cells.shift();
        cost += 1;
        push(
          'unlink',
          [...callLine, lineOf(code, 'head = head.next')],
          `head pasa a apuntar al segundo nodo${cells.length > 0 ? ` (${cells[0]!.value})` : ' (null: la lista queda vacía)'}.`,
        );
        push(
          'done',
          [...callLine, lineOf(code, 'return old.value')],
          `El largo pasa a ${cells.length}. Devolvemos ${removed.value}.`,
        );
      });
      break;
    }
    case 'remove-last': {
      requireNonEmpty(input.values);
      requireRoom(args.length, cells.length, 'deleteLast');
      args.forEach((_, run) => {
        const callLine = runLine(run);
        const removed = cells[cells.length - 1]!;
        const alone = cells.length === 1;
        // Checked first: with one node `tail.prev` is null, so the tail
        // shortcut below would light `tail.next = null` over a null.
        if (doubly && tail && !alone) {
          // The only O(1) delete-last in the family: `prev` is already there.
          cost += 1;
          push(
            'start',
            [...callLine, lineOf(code, 'Node old = tail')],
            `tail apunta al último nodo (${removed.value}).`,
          );
          cost += 1;
          push(
            'unlink',
            [...callLine, lineOf(code, 'tail = tail.prev')],
            `tail retrocede por prev — sin recorrer la cadena.`,
          );
        } else if (alone) {
          cost += 1;
          push(
            'compare',
            [
              ...callLine,
              lineOf(code, doubly && tail ? 'if (head == tail)' : 'if (head.next == null)'),
            ],
            `Queda un solo nodo: no hay anteúltimo a quien pedirle que apunte a null.`,
          );
        } else {
          // Every other recipe needs the node BEFORE the last one, and only a
          // walk can produce it: `tail` alone is not enough.
          walkTo(
            cells.length - 2,
            [lineOf(code, 'while (prev.next.next'), lineOf(code, 'prev = prev.next')],
            'prev',
            { lead: callLine },
          );
          cost += 1;
          push(
            'start',
            [...callLine, lineOf(code, 'old = prev.next')],
            `El nodo anterior al último es quien debe soltarlo.`,
            {
              pointers: basePointers([{ name: 'prev', index: cells.length - 2 }]),
            },
          );
        }
        cells.pop();
        cost += 1;
        push(
          'unlink',
          [
            ...callLine,
            lineOf(
              code,
              alone ? 'head = null' : doubly && tail ? 'tail.next = null' : 'prev.next = null',
            ),
          ],
          alone
            ? `head pasa a null: la cadena queda vacía. El largo pasa a 0.`
            : `El nuevo último apunta a ${circular ? 'head' : 'null'}. El largo pasa a ${cells.length}.`,
        );
        push(
          'done',
          [...callLine, lineOf(code, 'return old.value')],
          `Devolvemos ${removed.value}.`,
        );
      });
      break;
    }
    case 'remove-at': {
      requireNonEmpty(input.values);
      const removals = asRuns(input.index);
      requireRoom(removals.length, cells.length, 'deleteAt');
      removals.forEach((raw, run) => {
        const callLine = runLine(run);
        const at = checkIndex(raw, cells.length, false);
        if (at === 0) {
          // No previous node at the front, so the method hands the work to
          // deleteFirst — which is what the reader should conclude too.
          const removed = cells[0]!;
          cells[0] = { ...removed, state: 'leaving' };
          cost += 1;
          push(
            'compare',
            [...callLine, lineOf(code, 'if (i == 0)')],
            `La posición es 0: no hay nodo previo, así que el trabajo es el de deleteFirst.`,
          );
          cells.shift();
          cost += 1;
          push(
            'unlink',
            [...callLine, lineOf(code, 'return deleteFirst()')],
            `head pasa a apuntar al segundo nodo. El largo pasa a ${cells.length}. Devolvemos ${removed.value}.`,
          );
          return;
        }
        walkTo(at - 1, [lineOf(code, 'for (int j'), lineOf(code, 'prev = prev.next')], 'prev', {
          lead: callLine,
        });
        const removed = cells[at]!;
        cells[at] = { ...removed, state: 'leaving' };
        cost += 1;
        push(
          'start',
          [...callLine, lineOf(code, 'Node old = prev.next')],
          `El nodo a eliminar es ${removed.value}, en la posición ${at}.`,
          { pointers: basePointers([{ name: 'prev', index: at - 1 }]) },
        );
        cells.splice(at, 1);
        cost += 1;
        push(
          'unlink',
          [...callLine, lineOf(code, 'prev.next = old.next')],
          `El nodo anterior salta por encima y apunta al siguiente. El largo pasa a ${cells.length}.`,
        );
        push(
          'done',
          [...callLine, lineOf(code, 'return old.value')],
          `Devolvemos ${removed.value}.`,
        );
      });
      break;
    }
    case 'get-at': {
      requireNonEmpty(input.values);
      asRuns(input.index).forEach((raw, run) => {
        const callLine = runLine(run);
        const at = checkIndex(raw, cells.length, false);
        push(
          'start',
          [...callLine, lineOf(code, 'Node current = head')],
          `current parte de head, en la posición 0.`,
          { pointers: basePointers([{ name: 'current', index: 0 }]) },
        );
        // One frame per hop: the whole point of the operation is that there
        // are `i` of them, so skipping any would hide the cost it teaches.
        for (let j = 0; j < at; j += 1) {
          cost += 1;
          cells[j + 1] = { ...cells[j + 1]!, state: 'active' };
          push(
            'walk',
            [...callLine, lineOf(code, 'for (int j'), lineOf(code, 'current = current.next')],
            `Salto ${j + 1}: current avanza al nodo ${cells[j + 1]!.value}, en la posición ${j + 1}.`,
            { pointers: basePointers([{ name: 'current', index: j + 1 }]) },
          );
          cells[j + 1] = { ...cells[j + 1]!, state: 'idle' };
        }
        cells[at] = { ...cells[at]!, state: 'found' };
        push(
          'found',
          [...callLine, lineOf(code, 'return current.value')],
          `Llegamos a la posición ${at} tras ${at} salto${at === 1 ? '' : 's'}. Devolvemos ${cells[at]!.value}.`,
          { pointers: basePointers([{ name: 'current', index: at }]) },
        );
        // The hit is cleared before the next run starts looking.
        cells[at] = { ...cells[at]!, state: 'idle' };
      });
      break;
    }
    case 'search': {
      requireNonEmpty(input.values);
      asRuns(input.target).forEach((target, run) => {
        const callLine = runLine(run);
        push(
          'start',
          [...callLine, lineOf(code, 'Node current = head')],
          `Buscamos ${target} desde head: la lista no tiene aritmética de posiciones.`,
        );
        let found = -1;
        for (let j = 0; j < cells.length; j += 1) {
          cost += 1;
          const hit = cells[j]!.value === target;
          cells[j] = { ...cells[j]!, state: hit ? 'found' : 'active' };
          push(
            hit ? 'found' : 'compare',
            hit
              ? [...callLine, lineOf(code, 'if (current.value == x')]
              : [...callLine, lineOf(code, 'current = current.next')],
            `¿El nodo ${cells[j]!.value} es ${target}? ${hit ? 'Sí.' : 'No: avanzamos.'}`,
            { pointers: basePointers([{ name: 'current', index: j }]) },
          );
          if (hit) {
            found = j;
            break;
          }
          cells[j] = { ...cells[j]!, state: 'idle' };
        }
        push(
          found >= 0 ? 'found' : 'done',
          found >= 0
            ? [...callLine, lineOf(code, 'return i;')]
            : [...callLine, lineOf(code, 'return -1;')],
          found >= 0
            ? `Encontramos ${target} tras recorrer ${found + 1} nodo${found === 0 ? '' : 's'}.`
            : `Recorrimos los ${cells.length} nodos: ${target} no está en la lista.`,
        );
        if (found >= 0) cells[found] = { ...cells[found]!, state: 'idle' };
      });
      break;
    }
  }

  const last = steps.at(-1)!;
  steps[steps.length - 1] = { ...last, cells: settle(last.cells) };
  return {
    steps,
    code,
    maxCells: Math.max(...steps.map((f) => f.cells.length)),
    // insert-first and remove-first change the FRONT of the chain, so the
    // cells are drawn flush right and the reserved slot sits where the new
    // node is about to land.
    align: operation === 'insert-first' || operation === 'remove-first' ? 'right' : 'left',
    hasCarry: steps.some((f) => f.carry !== undefined),
  };
}
