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
   * The LAST node of the chain points at the floating node rather than at
   * `null`. The mirror of `headToCarry` at the other end: the one frame
   * between `current.next = fresh` running and the node taking its place.
   */
  tailToCarry?: boolean;
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
  /** Required by `insert-at` and `remove-at`. */
  index?: number;
  /** Required by `search` and `insert-ordered`. */
  target?: number;
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
export function isValidCombination(recipe: SequenceRecipe, operation: SequenceOperation): boolean {
  if (operation === 'insert-ordered') return isList(recipe);
  return true;
}

export function traceFor(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  if (!isValidCombination(recipe, operation)) {
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

function requireIndex(input: SequenceInput, length: number, inclusive: boolean): number {
  const i = input.index;
  const max = inclusive ? length : length - 1;
  if (i === undefined || !Number.isInteger(i) || i < 0 || i > max) {
    throw new Error(`El índice ${i ?? '(ausente)'} está fuera del rango válido [0, ${max}].`);
  }
  return i;
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
  if (input.target === undefined) throw new Error('Falta el valor buscado.');
  return input.target;
}

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

function traceArray(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
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
          [2, 3],
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
function callingProgram(values: number[], method: string): string {
  return [
    '',
    'LinkedList list = new LinkedList();',
    ...values.map((v) => `list.${method}(${v});`),
  ].join('\n');
}

function listCode(recipe: SequenceRecipe, operation: SequenceOperation, tail: boolean): string {
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const end = circular ? 'current.next != head' : 'current.next != null';

  switch (operation) {
    case 'insert-first':
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
      return `void insertAt(int i, int x) {
    if (i < 0 || i > size) {
        throw new IndexOutOfBoundsException();
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
      return `void insertOrdered(int x) {
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
      return doubly && tail
        ? `int deleteLast() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node old = tail;
    tail = tail.prev;
    tail.next = null;
    size--;
    return old.value;
}`
        : `int deleteLast() {
    if (head == null) {
        throw new NoSuchElementException();
    }
    Node prev = head;
    while (prev.next.next != null) {
        prev = prev.next;
    }
    Node old = prev.next;
    prev.next = null;
    size--;
    return old.value;
}`;
    case 'remove-at':
      return `int deleteAt(int i) {
    if (i < 0 || i >= size) {
        throw new IndexOutOfBoundsException();
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

function traceList(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  const tail = input.tail === true;
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const method = operation === 'insert-first' ? 'insertFirst' : 'insertLast';
  const inserts =
    (operation === 'insert-first' || operation === 'insert-last') && Array.isArray(input.value)
      ? (input.value as number[])
      : [];
  const code =
    inserts.length > 1
      ? listCode(recipe, operation, tail) + callingProgram(inserts, method)
      : listCode(recipe, operation, tail);
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

  /** Walks `prev` from head to `stop`, one frame per hop. */
  const walkTo = (stop: number, lines: number[], label: string) => {
    for (let j = 0; j < stop; j += 1) {
      cost += 1;
      cells[j] = { ...cells[j]!, state: 'active' };
      push('walk', lines, `${label} avanza al nodo ${cells[j]!.value} (paso ${j + 1}).`, {
        pointers: basePointers([{ name: label, index: j }]),
      });
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
      for (const x of requireValues(input)) {
        const wasFirst = cells.length > 0 ? cells[0]!.value : null;
        const callLine = inserts.length > 1 ? [lineOf(code, `list.insertFirst(${x});`)] : [];
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
      }
      cells[0] = { ...cells[0]!, state: 'new' };
      break;
    }
    case 'insert-last': {
      // The same four-frame discipline as insert-first, with one branch more:
      // an empty chain has no last node to link to, so what the insertion
      // assigns is `head` itself. Starting from zero shows that branch taken
      // once and never again — and the walk getting one hop longer on every
      // insertion, which is the $$\Theta(N)$$ this slide is about.
      for (const x of requireValues(input)) {
        const callLine = inserts.length > 1 ? [lineOf(code, `list.insertLast(${x});`)] : [];
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
            { carry: held, tailToCarry: true },
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
                    lineOf(code, `while (${circular ? 'current.next != head' : 'current.next != null'}`),
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
              tailToCarry: true,
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
      }
      break;
    }
    case 'insert-at': {
      const [x] = requireValues(input) as [number];
      const at = requireIndex(input, cells.length, true);
      cost += 1;
      push('build', [lineOf(code, 'new Node(x)')], `Creamos el nodo ${x} para la posición ${at}.`, {
        carry: { value: x, label: 'fresh' },
      });
      walkTo(
        Math.max(at - 1, 0),
        [lineOf(code, 'for (int j'), lineOf(code, 'prev = prev.next')],
        'prev',
      );
      cost += 1;
      push(
        'link',
        [lineOf(code, 'fresh.next = prev.next')],
        `${x} apunta al nodo que ocupaba la posición ${at}.`,
        {
          carry: { value: x, label: 'fresh' },
          pointers: basePointers([{ name: 'prev', index: Math.max(at - 1, 0) }]),
        },
      );
      cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
      cost += 1;
      push(
        'link',
        [lineOf(code, 'prev.next = fresh')],
        `El nodo anterior apunta a ${x}. El largo pasa a ${cells.length}.`,
      );
      break;
    }
    case 'insert-ordered': {
      const x = requireTarget(input);
      const sorted = input.values.every((v, i) => i === 0 || input.values[i - 1]! <= v);
      if (!sorted) {
        throw new Error('La lista de partida debe venir ordenada para insertar en orden.');
      }
      cost += 1;
      push(
        'build',
        [lineOf(code, 'new Node(x)')],
        `Creamos el nodo ${x} y buscamos dónde va sin romper el orden.`,
        {
          carry: { value: x, label: 'fresh' },
        },
      );
      let at = 0;
      while (at < cells.length && cells[at]!.value < x) {
        cost += 1;
        cells[at] = { ...cells[at]!, state: 'active' };
        push(
          'compare',
          [lineOf(code, 'while (prev.next'), lineOf(code, 'prev = prev.next')],
          `¿${cells[at]!.value} < ${x}? Sí: ${x} va más adelante.`,
          {
            carry: { value: x, label: 'fresh' },
            pointers: basePointers([{ name: 'prev', index: at }]),
          },
        );
        cells[at] = { ...cells[at]!, state: 'idle' };
        at += 1;
      }
      if (at < cells.length) {
        cost += 1;
        push(
          'compare',
          [lineOf(code, 'while (prev.next')],
          `¿${cells[at]!.value} < ${x}? No: ${x} va justo aquí.`,
          {
            carry: { value: x, label: 'fresh' },
            pointers: basePointers([{ name: 'prev', index: at }]),
          },
        );
      }
      cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
      cost += 1;
      push(
        'link',
        [lineOf(code, 'fresh.next = prev.next'), lineOf(code, 'prev.next = fresh')],
        `Enlazamos ${x} en la posición ${at}. El orden se mantiene.`,
      );
      break;
    }
    case 'remove-first': {
      requireNonEmpty(input.values);
      const removed = cells[0]!;
      cells[0] = { ...removed, state: 'leaving' };
      cost += 1;
      push(
        'start',
        [lineOf(code, 'Node old = head')],
        `Guardamos el primer nodo (${removed.value}).`,
      );
      cells.shift();
      cost += 1;
      push(
        'unlink',
        [lineOf(code, 'head = head.next')],
        `head pasa a apuntar al segundo nodo${cells.length > 0 ? ` (${cells[0]!.value})` : ' (null: la lista queda vacía)'}.`,
      );
      push(
        'done',
        [lineOf(code, 'return old.value')],
        `El largo pasa a ${cells.length}. Devolvemos ${removed.value}.`,
      );
      break;
    }
    case 'remove-last': {
      requireNonEmpty(input.values);
      const removed = cells[cells.length - 1]!;
      if (doubly && tail) {
        // The only O(1) delete-last in the family: `prev` is already there.
        cost += 1;
        push(
          'start',
          [lineOf(code, 'Node old = tail')],
          `tail apunta al último nodo (${removed.value}).`,
        );
        cost += 1;
        push(
          'unlink',
          [lineOf(code, 'tail = tail.prev')],
          `tail retrocede por prev — sin recorrer la cadena.`,
        );
      } else {
        // Every other recipe needs the node BEFORE the last one, and only a
        // walk can produce it: `tail` alone is not enough.
        walkTo(
          Math.max(cells.length - 2, 0),
          [lineOf(code, 'while (prev.next.next'), lineOf(code, 'prev = prev.next')],
          'prev',
        );
        cost += 1;
        push(
          'start',
          [lineOf(code, 'Node old = prev.next')],
          `El nodo anterior al último es quien debe soltarlo.`,
          {
            pointers: basePointers([{ name: 'prev', index: Math.max(cells.length - 2, 0) }]),
          },
        );
      }
      cells.pop();
      cost += 1;
      push(
        'unlink',
        [lineOf(code, doubly && tail ? 'tail.next = null' : 'prev.next = null')],
        `El nuevo último apunta a ${circular ? 'head' : 'null'}. El largo pasa a ${cells.length}.`,
      );
      push('done', [lineOf(code, 'return old.value')], `Devolvemos ${removed.value}.`);
      break;
    }
    case 'remove-at': {
      requireNonEmpty(input.values);
      const at = requireIndex(input, cells.length, false);
      walkTo(
        Math.max(at - 1, 0),
        [lineOf(code, 'for (int j'), lineOf(code, 'prev = prev.next')],
        'prev',
      );
      const removed = cells[at]!;
      cells[at] = { ...removed, state: 'leaving' };
      cost += 1;
      push(
        'start',
        [lineOf(code, 'Node old = prev.next')],
        `El nodo a eliminar es ${removed.value}, en la posición ${at}.`,
        {
          pointers: basePointers([{ name: 'prev', index: Math.max(at - 1, 0) }]),
        },
      );
      cells.splice(at, 1);
      cost += 1;
      push(
        'unlink',
        [lineOf(code, 'prev.next = old.next')],
        `El nodo anterior salta por encima y apunta al siguiente. El largo pasa a ${cells.length}.`,
      );
      push('done', [lineOf(code, 'return old.value')], `Devolvemos ${removed.value}.`);
      break;
    }
    case 'get-at': {
      requireNonEmpty(input.values);
      const at = requireIndex(input, cells.length, false);
      push(
        'start',
        [lineOf(code, 'Node current = head')],
        `current parte de head, en la posición 0.`,
        {
          pointers: basePointers([{ name: 'current', index: 0 }]),
        },
      );
      // One frame per hop: the whole point of the operation is that there are
      // `i` of them, so skipping any would hide the cost it teaches.
      for (let j = 0; j < at; j += 1) {
        cost += 1;
        cells[j + 1] = { ...cells[j + 1]!, state: 'active' };
        push(
          'walk',
          [lineOf(code, 'for (int j'), lineOf(code, 'current = current.next')],
          `Salto ${j + 1}: current avanza al nodo ${cells[j + 1]!.value}, en la posición ${j + 1}.`,
          { pointers: basePointers([{ name: 'current', index: j + 1 }]) },
        );
        cells[j + 1] = { ...cells[j + 1]!, state: 'idle' };
      }
      cells[at] = { ...cells[at]!, state: 'found' };
      push(
        'found',
        [lineOf(code, 'return current.value')],
        `Llegamos a la posición ${at} tras ${at} salto${at === 1 ? '' : 's'}. Devolvemos ${cells[at]!.value}.`,
        { pointers: basePointers([{ name: 'current', index: at }]) },
      );
      break;
    }
    case 'search': {
      const target = requireTarget(input);
      push(
        'start',
        [lineOf(code, 'Node current = head')],
        `Buscamos ${target} desde head: la lista no tiene aritmética de posiciones.`,
      );
      let found = -1;
      for (let j = 0; j < cells.length; j += 1) {
        cost += 1;
        const hit = cells[j]!.value === target;
        cells[j] = { ...cells[j]!, state: hit ? 'found' : 'active' };
        push(
          hit ? 'found' : 'compare',
          hit ? [lineOf(code, 'if (current.value == x')] : [lineOf(code, 'current = current.next')],
          `¿El nodo ${cells[j]!.value} es ${target}? ${hit ? 'Sí.' : 'No: avanzamos.'}`,
          {
            pointers: basePointers([{ name: 'current', index: j }]),
          },
        );
        if (hit) {
          found = j;
          break;
        }
        cells[j] = { ...cells[j]!, state: 'idle' };
      }
      push(
        found >= 0 ? 'found' : 'done',
        found >= 0 ? [lineOf(code, 'return i;')] : [lineOf(code, 'return -1;')],
        found >= 0
          ? `Encontramos ${target} tras recorrer ${found + 1} nodo${found === 0 ? '' : 's'}.`
          : `Recorrimos los ${cells.length} nodos: ${target} no está en la lista.`,
      );
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
