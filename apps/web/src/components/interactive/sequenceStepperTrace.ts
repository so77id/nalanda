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
  /** A value held outside the structure — the node being built. */
  carry?: { value: number; label: string };
  /** Circular recipe: the chain closes back on its first node. */
  closesRing?: boolean;
  /** Running elementary-operation count. */
  cost: number;
}

export interface SequenceTrace {
  steps: SequenceStep[];
  code: string;
}

export interface SequenceInput {
  values: number[];
  /** Required by every `insert-*` except `insert-ordered`. */
  value?: number;
  /** Required by `insert-at` and `remove-at`. */
  index?: number;
  /** Required by `search` and `insert-ordered`. */
  target?: number;
  /** Lists only: draw a `tail` pointer and let the operations use it. */
  tail?: boolean;
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

function requireValue(input: SequenceInput): number {
  if (input.value === undefined) throw new Error('Falta el valor a insertar.');
  return input.value;
}

function requireTarget(input: SequenceInput): number {
  if (input.target === undefined) throw new Error('Falta el valor buscado.');
  return input.target;
}

// ── the array family ──────────────────────────────────────────────────────

const ARRAY_CODE: Record<Exclude<SequenceOperation, 'insert-ordered'>, string> = {
  'insert-first': `void insertFirst(int x) {
    for (int j = size; j > 0; j--) {
        data[j] = data[j - 1];
    }
    data[0] = x;
    size++;
}`,
  'insert-last': `void insertLast(int x) {
    data[size] = x;
    size++;
}`,
  'insert-at': `void insertAt(int i, int x) {
    for (int j = size; j > i; j--) {
        data[j] = data[j - 1];
    }
    data[i] = x;
    size++;
}`,
  'remove-first': `int deleteFirst() {
    int x = data[0];
    for (int j = 0; j < size - 1; j++) {
        data[j] = data[j + 1];
    }
    size--;
    return x;
}`,
  'remove-last': `int deleteLast() {
    int x = data[size - 1];
    size--;
    return x;
}`,
  'remove-at': `int deleteAt(int i) {
    int x = data[i];
    for (int j = i; j < size - 1; j++) {
        data[j] = data[j + 1];
    }
    size--;
    return x;
}`,
  search: `int search(int x) {
    for (int j = 0; j < size; j++) {
        if (data[j] == x) {
            return j;
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
      [2, 3],
      `El bloque está lleno: se reserva uno del doble (${capacity}) y se copian los ${copied} elementos.`,
    );
    return 3;
  };

  switch (operation) {
    case 'insert-first':
    case 'insert-last':
    case 'insert-at': {
      const x = requireValue(input);
      const at =
        operation === 'insert-first'
          ? 0
          : operation === 'insert-last'
            ? size()
            : requireIndex(input, size(), true);
      const offset = growIfNeeded();
      const n = size();
      push('start', [1], `Insertamos ${x} en la posición ${at} de un arreglo de ${n} elementos.`, {
        carry: { value: x, label: 'x' },
      });
      // Copy right, from the last element down to the insertion point. Each
      // copy vacates its source, so a hole opens at `at`.
      const shiftLines = operation === 'insert-last' ? [] : [2 + offset, 3 + offset];
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
      const writeLine = operation === 'insert-last' ? 2 + offset : 5 + offset;
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
      push('start', [1, 2], `Guardamos ${removed.value}, el elemento de la posición ${at}.`, {
        pointers: [{ name: 'i', index: at }],
      });
      slots[at] = null;
      // Copy left, closing the hole the removal opened.
      const shiftLines = operation === 'remove-last' ? [] : [3, 4];
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
        [operation === 'remove-last' ? 3 : 5],
        `El largo pasa a ${size()}. Devolvemos ${removed.value}.`,
      );
      break;
    }
    case 'search': {
      const target = requireTarget(input);
      const n = size();
      push('start', [1], `Buscamos ${target} recorriendo el arreglo desde la posición 0.`);
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
        found >= 0 ? [4] : [7],
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
  return { steps, code };
}

// ── the list family ───────────────────────────────────────────────────────

/**
 * The listings differ by recipe where the CODE differs, and only there: the
 * doubly-linked recipe maintains `prev`, and the circular recipe terminates
 * its walks on `head` rather than on `null`. Everything else is shared, which
 * is the point the class makes — the operations are the same, what changes is
 * where the cost lives.
 */
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
      return tail
        ? `void insertLast(int x) {
    Node fresh = new Node(x);
    tail.next = fresh;
    tail = fresh;
    size++;
}`
        : `void insertLast(int x) {
    Node fresh = new Node(x);
    Node current = head;
    while (${end}) {
        current = current.next;
    }
    current.next = fresh;
    size++;
}`;
    case 'insert-at':
      return `void insertAt(int i, int x) {
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
    Node old = head;
    head = head.next;
    if (head != null) head.prev = null;
    size--;
    return old.value;
}`
        : `int deleteFirst() {
    Node old = head;
    head = head.next;
    size--;
    return old.value;
}`;
    case 'remove-last':
      return doubly && tail
        ? `int deleteLast() {
    Node old = tail;
    tail = tail.prev;
    tail.next = null;
    size--;
    return old.value;
}`
        : `int deleteLast() {
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
    Node prev = head;
    for (int j = 0; j < i - 1; j++) {
        prev = prev.next;
    }
    Node old = prev.next;
    prev.next = old.next;
    size--;
    return old.value;
}`;
    case 'search':
      return `int search(int x) {
    Node current = head;
    int j = 0;
    while (current != null) {
        if (current.value == x) {
            return j;
        }
        current = current.next;
        j++;
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
  const code = listCode(recipe, operation, tail);
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
      const x = requireValue(input);
      cost += 1;
      push('build', [2], `Creamos el nodo ${x}. Todavía no está en la cadena.`, {
        carry: { value: x, label: 'fresh' },
      });
      cost += 1;
      push(
        'link',
        [3],
        `El nodo ${x} apunta al que hoy es el primero${cells.length > 0 ? ` (${cells[0]!.value})` : ' (null: la lista estaba vacía)'}.`,
        {
          carry: { value: x, label: 'fresh' },
        },
      );
      cells.unshift({ id: (nextId += 1), value: x, state: 'new' });
      cost += 1;
      push(
        'link',
        doubly ? [5] : [4],
        `head pasa a apuntar a ${x}. El largo pasa a ${cells.length}.`,
      );
      break;
    }
    case 'insert-last': {
      const x = requireValue(input);
      cost += 1;
      push('build', [2], `Creamos el nodo ${x}.`, { carry: { value: x, label: 'fresh' } });
      if (tail) {
        cost += 1;
        push('link', [3], `tail ya apunta al último: enlazamos ${x} sin recorrer nada.`, {
          carry: { value: x, label: 'fresh' },
        });
      } else {
        // No tail: the only way to the last node is to walk the whole chain.
        walkTo(Math.max(cells.length - 1, 0), [4, 5], 'current');
        cost += 1;
        push('link', [7], `El último nodo apunta a ${x}.`, {
          carry: { value: x, label: 'fresh' },
        });
      }
      cells.push({ id: (nextId += 1), value: x, state: 'new' });
      cost += 1;
      push('done', tail ? [4] : [8], `El largo pasa a ${cells.length}.`);
      break;
    }
    case 'insert-at': {
      const x = requireValue(input);
      const at = requireIndex(input, cells.length, true);
      cost += 1;
      push('build', [2], `Creamos el nodo ${x} para la posición ${at}.`, {
        carry: { value: x, label: 'fresh' },
      });
      walkTo(Math.max(at - 1, 0), [4, 5], 'prev');
      cost += 1;
      push('link', [7], `${x} apunta al nodo que ocupaba la posición ${at}.`, {
        carry: { value: x, label: 'fresh' },
        pointers: basePointers([{ name: 'prev', index: Math.max(at - 1, 0) }]),
      });
      cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
      cost += 1;
      push('link', [8], `El nodo anterior apunta a ${x}. El largo pasa a ${cells.length}.`);
      break;
    }
    case 'insert-ordered': {
      const x = requireTarget(input);
      const sorted = input.values.every((v, i) => i === 0 || input.values[i - 1]! <= v);
      if (!sorted) {
        throw new Error('La lista de partida debe venir ordenada para insertar en orden.');
      }
      cost += 1;
      push('build', [2], `Creamos el nodo ${x} y buscamos dónde va sin romper el orden.`, {
        carry: { value: x, label: 'fresh' },
      });
      let at = 0;
      while (at < cells.length && cells[at]!.value < x) {
        cost += 1;
        cells[at] = { ...cells[at]!, state: 'active' };
        push('compare', [4, 5], `¿${cells[at]!.value} < ${x}? Sí: ${x} va más adelante.`, {
          carry: { value: x, label: 'fresh' },
          pointers: basePointers([{ name: 'prev', index: at }]),
        });
        cells[at] = { ...cells[at]!, state: 'idle' };
        at += 1;
      }
      if (at < cells.length) {
        cost += 1;
        push('compare', [4], `¿${cells[at]!.value} < ${x}? No: ${x} va justo aquí.`, {
          carry: { value: x, label: 'fresh' },
          pointers: basePointers([{ name: 'prev', index: at }]),
        });
      }
      cells.splice(at, 0, { id: (nextId += 1), value: x, state: 'new' });
      cost += 1;
      push('link', [7, 8], `Enlazamos ${x} en la posición ${at}. El orden se mantiene.`);
      break;
    }
    case 'remove-first': {
      requireNonEmpty(input.values);
      const removed = cells[0]!;
      cells[0] = { ...removed, state: 'leaving' };
      cost += 1;
      push('start', [2], `Guardamos el primer nodo (${removed.value}).`);
      cells.shift();
      cost += 1;
      push(
        'unlink',
        [3],
        `head pasa a apuntar al segundo nodo${cells.length > 0 ? ` (${cells[0]!.value})` : ' (null: la lista queda vacía)'}.`,
      );
      push(
        'done',
        doubly ? [5] : [4],
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
        push('start', [2], `tail apunta al último nodo (${removed.value}).`);
        cost += 1;
        push('unlink', [3], `tail retrocede por prev — sin recorrer la cadena.`);
      } else {
        // Every other recipe needs the node BEFORE the last one, and only a
        // walk can produce it: `tail` alone is not enough.
        walkTo(Math.max(cells.length - 2, 0), [2, 3], 'prev');
        cost += 1;
        push('start', [5], `El nodo anterior al último es quien debe soltarlo.`, {
          pointers: basePointers([{ name: 'prev', index: Math.max(cells.length - 2, 0) }]),
        });
      }
      cells.pop();
      cost += 1;
      push(
        'unlink',
        doubly && tail ? [4] : [6],
        `El fresh último apunta a ${circular ? 'head' : 'null'}. El largo pasa a ${cells.length}.`,
      );
      push('done', doubly && tail ? [6] : [8], `Devolvemos ${removed.value}.`);
      break;
    }
    case 'remove-at': {
      requireNonEmpty(input.values);
      const at = requireIndex(input, cells.length, false);
      walkTo(Math.max(at - 1, 0), [3, 4], 'prev');
      const removed = cells[at]!;
      cells[at] = { ...removed, state: 'leaving' };
      cost += 1;
      push('start', [6], `El nodo a eliminar es ${removed.value}, en la posición ${at}.`, {
        pointers: basePointers([{ name: 'prev', index: Math.max(at - 1, 0) }]),
      });
      cells.splice(at, 1);
      cost += 1;
      push(
        'unlink',
        [7],
        `El nodo anterior salta por encima y apunta al siguiente. El largo pasa a ${cells.length}.`,
      );
      push('done', [9], `Devolvemos ${removed.value}.`);
      break;
    }
    case 'search': {
      const target = requireTarget(input);
      push(
        'start',
        [2, 3],
        `Buscamos ${target} desde head: la lista no tiene aritmética de posiciones.`,
      );
      let found = -1;
      for (let j = 0; j < cells.length; j += 1) {
        cost += 1;
        const hit = cells[j]!.value === target;
        cells[j] = { ...cells[j]!, state: hit ? 'found' : 'active' };
        push(
          hit ? 'found' : 'compare',
          hit ? [5, 6] : [5, 8],
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
        found >= 0 ? [6] : [11],
        found >= 0
          ? `Encontramos ${target} tras recorrer ${found + 1} nodo${found === 0 ? '' : 's'}.`
          : `Recorrimos los ${cells.length} nodos: ${target} no está en la lista.`,
      );
      break;
    }
  }

  const last = steps.at(-1)!;
  steps[steps.length - 1] = { ...last, cells: settle(last.cells) };
  return { steps, code };
}
