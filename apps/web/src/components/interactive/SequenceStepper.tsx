import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { useMemo, useRef } from 'react';

import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { HashView } from './sequenceStepperHashView';
import { HeapView } from './sequenceStepperHeapView';
import { ProbeView } from './sequenceStepperProbeView';
import { TreeView } from './sequenceStepperTreeView';
import {
  BOX_H,
  BOX_W,
  LINK_W,
  LIST_GAP,
  layoutSequence,
  linkArrow,
  type SequenceLayout,
} from './sequenceStepperLayout';
import { CELL_FILL, CELL_NOTE, CELL_STROKE } from './sequenceStepperPaint';
import {
  AVL_ONLY_OPERATIONS,
  AVL_OPERATIONS,
  BINARY_TREE_OPERATIONS,
  BST_OPERATIONS,
  CIRCULAR_OPERATIONS,
  HASH_CHAINING_OPERATIONS,
  HASH_PROBING_OPERATIONS,
  DOUBLY_OPERATIONS,
  HEAP_OPERATIONS,
  OPERATIONS,
  RECIPES,
  BST_ONLY_OPERATIONS,
  TREE_ONLY_OPERATIONS,
  isAvlOperation,
  isBinaryTreeOperation,
  isBstOperation,
  isHashChainingOperation,
  isHashProbingOperation,
  isValidCombination,
  traceFor,
  type AvlOperation,
  type BinaryTreeOperation,
  type BstOperation,
  type HashChainingOperation,
  type HashProbingOperation,
  type SequenceCell,
  type SequenceOperation,
  type SequenceRecipe,
  type SequenceStep,
  type SequenceTrace,
  type TreeValue,
} from './sequenceStepperTrace';
import {
  ControlButton,
  LegendSwatch,
  NarrationStrip,
  StepperHeader,
  useStepPlayback,
  type StepSpeed,
} from './stepperShell';
import { useViewportBreakout } from '../useViewportBreakout';

export interface SequenceStepperProps {
  /** Which structure to draw. Selects both the picture and the listing. */
  eda?: SequenceRecipe | string;
  /** Which operation to animate over that structure. */
  operation?: SequenceOperation | string;
  /**
   * The starting contents, in reading order. Six or fewer read best. On
   * `binary-tree` it is the tree in level order, `null` where a child is
   * missing (`[3, 9, 1, 4, 7, null, 6]`) — the one recipe that takes a gap,
   * and a gap has no children written (ADR-0083 §4) — and a value may be a
   * symbol, so an expression tree keeps its operators as operators:
   * `['*', '+', '−', 3, 4, 5, 1]` is (3 + 4) * (5 − 1). On `hash-chaining` it
   * is the KEYS already in the table, text, added in this order — each at the
   * front of the list of its position: `['Ana', 'Bea', 'Eva']`.
   */
  values?: (TreeValue | null)[];
  /**
   * The value to insert. Required by every `insert-*` but `insert-ordered`,
   * and by the heap's `insert`. An ARRAY inserts each value in turn over the
   * same structure, so a slide can show it growing instead of one insertion
   * in isolation. On `hash-chaining`, the key `insert` adds — text.
   */
  value?: number | string | (number | string)[];
  /**
   * The position to act on. Required by `get-at`, `insert-at` and
   * `remove-at`. An ARRAY runs the operation once per index, in order over
   * the same structure — which is how a slide shows a cost that depends on
   * WHERE instead of asserting it.
   */
  index?: number | number[];
  /**
   * The value looked for. Required by `search` and `insert-ordered`. An
   * ARRAY searches each in turn, so one widget can show the hit at the
   * front, the hit at the back and the value that is not there. On the
   * trees, the node an operation acts on: `remove` on `bst`,
   * the node that rotates on `avl`. On `hash-chaining`, the key `search`
   * and `remove` work with — text.
   */
  target?: number | string | (number | string)[];
  /**
   * How many times to run an operation that takes no argument
   * (`remove-first`, `remove-last`, `extract-max`). Default one.
   */
  times?: number;
  /**
   * `hash-probing` only: keys of `values` that were removed. Each stays in
   * its cell with `deleted[i]` set, so a slide can start from a table with
   * marks — a search passing over one, an insertion reusing it.
   */
  deleted?: string[];
  /**
   * The dynamic array and the heap: how many slots the block reserves (on
   * the heap, `data.length` with slot 0 included). Pass the same number to
   * the pair of slides that show one structure before and after an
   * operation, or the block changes width between them.
   */
  capacity?: number;
  /**
   * The name the LISTING shows the method under, when the document presents
   * the structure through a TDA that calls it something else — a pila slide
   * showing `pop` rather than the chain's `deleteFirst`. The body is the
   * same; only the name changes, in the signature and in every call.
   */
  method?: string;
  /** The variable the calling program operates on. Defaults to `arreglo`
   * on the dynamic array, `heap` on the heap and `list` on the chains. */
  receiver?: string;
  /** The class the calling program constructs. Goes with `method`. */
  receiverType?: string;
  /**
   * The dynamic array only: a named arrow kept on every frame, aimed at the end the
   * operation works on — `top` for a stack, `front` or `rear` for a queue.
   * This one is the structure's field; naming it stands down the `i`/`j`
   * cursors, which belong to the operation and would draw a second arrow at
   * the same cell.
   */
  pointer?: string;
  /** Lists only: draw a `tail` pointer, and let the operations use it. */
  tail?: boolean;
  /**
   * The iterative listing beside the recursive one, the two sharing the
   * width, each lit at every frame (#322): `dynamic-array` ×
   * `binary-search`, `bst` × `search` and `bst` × `insert` (`PAIRED` in the
   * trace). Not with `program`, which takes that column.
   */
  iterative?: boolean;
  /**
   * The operation run by a program, on `bst` and `avl` (#322). `insert`
   * from `values={[]}`: the program that builds the tree — the tree created,
   * then one `insert` per value — on `bst` one frame per line with the tree
   * drawn after each, on `avl` beside the insertion and `balance`, walked for
   * every insertion. `remove` with `target` an array: the program that builds
   * the tree from `values` and removes each target, beside the method it
   * calls (and `balance`, on `avl`), walked for every removal with the
   * program's line lit.
   */
  program?: boolean;
  /** Playback default. Off unless the author asks (rule Peli 1/2). */
  autoplay?: boolean;
  /** `slow` ≈ 1200ms/step, `normal` ≈ 700ms, `fast` ≈ 300ms. */
  speed?: StepSpeed;
  /** Hide the code panel when the slide already carries the listing. */
  showCode?: boolean;
  /** Widget header override. */
  title?: string;
}

/**
 * WHY a combination is refused, in the author's own terms. One message for
 * every refusal was a non-sequitur the moment the variant recipes stopped
 * accepting everything: an author asking for `search` over a ring was told
 * something about order and arrays. The reason a combination is refused is
 * always that this widget has no listing written for it — what changes is
 * which listings it does have.
 */
function refusalReason(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
  tail: boolean,
): string {
  if (recipe === 'heap-max') {
    return `el heap no es una secuencia y tiene sus propias operaciones: ${HEAP_OPERATIONS.map(
      (o) => OPERATION_LABEL[o],
    ).join(', ')}.`;
  }
  if (HEAP_OPERATIONS.includes(operation)) {
    return 'es una operación del heap. Úsala con eda="heap-max".';
  }
  if (recipe === 'binary-tree') {
    return `el árbol binario no es una secuencia y tiene sus propias operaciones: ${BINARY_TREE_OPERATIONS.map(
      (o) => OPERATION_LABEL[o],
    ).join(', ')}.`;
  }
  if (recipe === 'bst') {
    return `el árbol de búsqueda tiene listado para: ${BST_OPERATIONS.map(
      (o) => OPERATION_LABEL[o],
    ).join(', ')}.`;
  }
  if (recipe === 'avl') {
    return `el árbol AVL tiene listado para: ${AVL_OPERATIONS.map((o) => OPERATION_LABEL[o]).join(
      ', ',
    )}.`;
  }
  if (recipe === 'hash-chaining') {
    return `la tabla hash tiene listado para: ${HASH_CHAINING_OPERATIONS.map(
      (o) => OPERATION_LABEL[o],
    ).join(', ')}.`;
  }
  if (recipe === 'hash-probing') {
    return `la tabla con sondeo lineal tiene listado para: ${HASH_PROBING_OPERATIONS.map(
      (o) => OPERATION_LABEL[o],
    ).join(', ')}.`;
  }
  // The tree-only sets, not every tree operation: `search` and `insert` are
  // shared, and a structure that refuses them has its own reason. `remove` is
  // the search tree's and the AVL's both, so the AVL's own set is only its
  // rotations — and the hash tables' too (#326), so its refusal names all four.
  if (AVL_ONLY_OPERATIONS.includes(operation)) {
    return 'es una operación del árbol AVL. Úsala con eda="avl".';
  }
  if (BST_ONLY_OPERATIONS.includes(operation)) {
    return 'es una operación de los árboles de búsqueda y de las tablas hash. Úsala con eda="bst", eda="avl", eda="hash-chaining" o eda="hash-probing".';
  }
  if (operation === 'resize') {
    return 'es una operación de la tabla hash. Úsala con eda="hash-chaining".';
  }
  if (TREE_ONLY_OPERATIONS.includes(operation)) {
    return 'es una operación de árbol. Úsala con eda="binary-tree".';
  }
  if (operation === 'insert-ordered' && !recipe.startsWith('linked-list')) {
    return 'esta clase presenta el orden como una variante de la lista, no del arreglo.';
  }
  if (recipe === 'linked-list-doubly' && operation === 'remove-last' && !tail) {
    return 'sin `tail` el recorrido hasta el anteúltimo es el de la lista simple, que nunca toca `prev`. Agrega la prop `tail`.';
  }
  const allowed = recipe === 'linked-list-circular' ? CIRCULAR_OPERATIONS : DOUBLY_OPERATIONS;
  return `el listado que el widget muestra sería el de otra estructura. Sobre «${RECIPE_LABEL[recipe]}» hay listado para: ${allowed
    .map((o) => OPERATION_LABEL[o])
    .join(', ')}.`;
}

const RECIPE_LABEL: Record<SequenceRecipe, string> = {
  'dynamic-array': 'arreglo dinámico',
  'linked-list-singly': 'lista simplemente enlazada',
  'linked-list-doubly': 'lista doblemente enlazada',
  'linked-list-circular': 'lista circular',
  'heap-max': 'heap (máximo)',
  'binary-tree': 'árbol binario',
  bst: 'árbol binario de búsqueda',
  avl: 'árbol AVL',
  'hash-chaining': 'tabla hash con encadenamiento',
  'hash-probing': 'tabla hash con sondeo lineal',
};

const OPERATION_LABEL: Record<SequenceOperation, string> = {
  'get-at': 'obtener una posición',
  'insert-first': 'insertar al principio',
  'insert-last': 'insertar al final',
  'insert-at': 'insertar en una posición',
  'insert-ordered': 'insertar en orden',
  'remove-first': 'eliminar el primero',
  'remove-last': 'eliminar el último',
  'remove-at': 'eliminar una posición',
  search: 'buscar',
  'binary-search': 'búsqueda binaria',
  insert: 'insertar',
  'extract-max': 'extraer el máximo',
  preorder: 'recorrer en preorden',
  inorder: 'recorrer en inorden',
  postorder: 'recorrer en postorden',
  height: 'calcular la altura',
  remove: 'eliminar',
  'rotate-right': 'rotar a la derecha',
  'rotate-left': 'rotar a la izquierda',
  'rotate-left-right': 'rotación doble a la derecha',
  'rotate-right-left': 'rotación doble a la izquierda',
  resize: 'redimensionar',
};

const UNDER_THE_EYE: [string, string] = ['border-focus bg-surface', 'bajo la mirada'];
const VISITED: [string, string] = ['border-rule-strong bg-sunk', 'ya visitado'];
const RULED_OUT: [string, string] = ['border-rule bg-surface', 'descartado'];
const FOUND: [string, string] = ['border-keep bg-keep-soft', 'encontrado'];

/**
 * The legend of a tree run, by operation: each names only the states that
 * operation paints, so a traversal does not explain "descartado" and a
 * removal does not explain "encontrado".
 */
const TREE_LEGEND: Record<BinaryTreeOperation, [string, string][]> = {
  preorder: [['border-mark bg-mark-soft', 'se visita'], UNDER_THE_EYE, VISITED],
  inorder: [['border-mark bg-mark-soft', 'se visita'], UNDER_THE_EYE, VISITED],
  postorder: [['border-mark bg-mark-soft', 'se visita'], UNDER_THE_EYE, VISITED],
  height: [['border-mark bg-mark-soft', 'acaba de responder'], UNDER_THE_EYE, VISITED],
  search: [FOUND, UNDER_THE_EYE, VISITED],
};
const SEARCH_TREE_LEGEND: Record<BstOperation, [string, string][]> = {
  search: [FOUND, UNDER_THE_EYE, VISITED, RULED_OUT],
  insert: [['border-mark bg-mark-soft', 'nuevo'], UNDER_THE_EYE, VISITED],
  inorder: [['border-mark bg-mark-soft', 'se visita'], UNDER_THE_EYE, VISITED],
  remove: [
    ['border-mark bg-mark-soft', 'toma un valor'],
    ['border-accent bg-surface', 'sucesor'],
    ['border-rule bg-sunk', 'sale'],
    UNDER_THE_EYE,
  ],
};

/** A rotation paints the two nodes it exchanges and the subtree that changes parent; insert and remove add the node balance is looking at. */
const AVL_LEGEND: Record<AvlOperation, [string, string][]> = {
  'rotate-right': [
    ['border-accent bg-surface', 'rotan'],
    ['border-mark bg-mark-soft', 'cambia de padre'],
  ],
  'rotate-left': [
    ['border-accent bg-surface', 'rotan'],
    ['border-mark bg-mark-soft', 'cambia de padre'],
  ],
  'rotate-left-right': [
    ['border-accent bg-surface', 'rotan'],
    ['border-mark bg-mark-soft', 'cambia de padre'],
  ],
  'rotate-right-left': [
    ['border-accent bg-surface', 'rotan'],
    ['border-mark bg-mark-soft', 'cambia de padre'],
  ],
  insert: [
    ['border-mark bg-mark-soft', 'nuevo'],
    ['border-focus bg-surface', 'se rebalancea'],
    ['border-accent bg-surface', 'rotan'],
  ],
  remove: [
    ['border-rule bg-sunk', 'sale'],
    ['border-mark bg-mark-soft', 'toma un valor'],
    ['border-focus bg-surface', 'se rebalancea'],
    // One colour, two moments: the successor before the copy, the rotation
    // on the way back; the successor's badge tells them apart (#322 review).
    ['border-accent bg-surface', 'sucesor o rotan'],
  ],
};

/**
 * The legend of a run that paints its own states — a tree's, a hash table's,
 * and the array's binary search, which rules out cells the way the search
 * tree rules out subtrees — or null for the default one.
 */
function runLegend(
  recipe: SequenceRecipe,
  operation: SequenceOperation,
): [string, string][] | null {
  if (operation === 'binary-search') return [FOUND, UNDER_THE_EYE, RULED_OUT];
  if (recipe === 'binary-tree' && isBinaryTreeOperation(operation)) return TREE_LEGEND[operation];
  if (recipe === 'bst' && isBstOperation(operation)) return SEARCH_TREE_LEGEND[operation];
  if (recipe === 'avl' && isAvlOperation(operation)) return AVL_LEGEND[operation];
  if (recipe === 'hash-chaining' && isHashChainingOperation(operation)) {
    return HASH_LEGEND[operation];
  }
  if (recipe === 'hash-probing' && isHashProbingOperation(operation)) {
    return PROBE_LEGEND[operation];
  }
  return null;
}

/** The legend of a hash run, by operation: each names only the states it paints. */
const COMPARED: [string, string] = ['border-rule-strong bg-sunk', 'ya comparada'];
const HASH_LEGEND: Record<HashChainingOperation, [string, string][]> = {
  search: [FOUND, UNDER_THE_EYE, COMPARED],
  insert: [['border-mark bg-mark-soft', 'nuevo'], UNDER_THE_EYE, COMPARED],
  remove: [UNDER_THE_EYE, ['border-rule bg-sunk', 'sale'], COMPARED],
  resize: [
    ['border-mark bg-mark-soft', 'reinsertada'],
    ['border-rule-strong bg-sunk', 'ya movida'],
  ],
};
const PROBE_LEGEND: Record<HashProbingOperation, [string, string][]> = {
  search: [FOUND, UNDER_THE_EYE, COMPARED],
  insert: [['border-mark bg-mark-soft', 'nuevo'], UNDER_THE_EYE, COMPARED],
  remove: [UNDER_THE_EYE, ['border-rule bg-sunk', 'se marca'], COMPARED],
};

/** The most elements the picture stays legible with, measured on a slide. */
const MAX_VALUES = 8;

/**
 * An AVL that inserts or removes builds a real AVL, whose height is at most
 * four with twelve nodes: twelve fit a slide where a search tree of twelve
 * may be a chain eleven deep. Enough for the class's removal that rotates at
 * two levels, the smallest of which has twelve nodes (#322).
 */
const MAX_AVL_VALUES = 12;

/**
 * `values` read back from its key: the numbers, plus the level order when it
 * has a gap or a symbol — the only shape in which either means anything.
 */
function readValues(key: string): { values: number[]; levelOrder?: (TreeValue | null)[] } {
  const all = JSON.parse(key) as (TreeValue | null)[];
  const values = all.filter((v): v is number => typeof v === 'number');
  return all.length === values.length ? { values } : { values, levelOrder: all };
}

/**
 * `<SequenceStepper>` — the step-through widget of the Estructuras de Datos
 * and Estructuras de Datos Avanzadas units (ADR-0074, extended by ADR-0077,
 * ADR-0083, ADR-0084 and ADR-0086).
 *
 * One widget, two props that pick what it shows: `eda` selects the structure
 * (a dynamic array, a singly / doubly / circular list, a binary max-heap, a
 * linked binary tree, or a hash table with chaining or with linear probing)
 * and `operation` selects the animation. The surface never
 * changes between combinations — code panel, structure, narration, controls —
 * so the reader learns one visual vocabulary and reads every structure of the
 * unit through it.
 *
 * The modules, every one but the painters pure and pinned by the suite, which
 * leaves the browser only the paint:
 * - frames: `sequenceStepperTrace` (the dispatcher, the chains and the heap),
 *   `sequenceStepperTreeTrace` (the binary tree and the search tree),
 *   `sequenceStepperAvlTrace` (the AVL tree, built on the tree's pieces),
 *   `sequenceStepperHashTrace` (the table with chaining) and
 *   `sequenceStepperProbeTrace` (the table with linear probing), all importing
 *   the leaf `sequenceStepperTraceShared` (the line a frame lights, the runs
 *   cap);
 * - geometry: `sequenceStepperLayout` (a Sequence), `sequenceStepperHeapLayout`
 *   (the heap's tree and array), `sequenceStepperTreeLayout` (the tree), the
 *   last two sharing the leaf `sequenceStepperEdge`, and
 *   `sequenceStepperHashLayout` (both hash tables);
 * - paint: the Sequence picture here, `sequenceStepperHeapView`,
 *   `sequenceStepperTreeView`, `sequenceStepperHashView` and
 *   `sequenceStepperProbeView`, with their colours in `sequenceStepperPaint`.
 */
export function SequenceStepper({
  eda,
  operation,
  values,
  value,
  index,
  target,
  times,
  capacity,
  method,
  receiver,
  receiverType,
  pointer,
  tail = false,
  iterative = false,
  program = false,
  deleted,
  autoplay = false,
  speed = 'normal',
  showCode = true,
  title,
}: SequenceStepperProps) {
  if (eda === undefined || !RECIPES.includes(eda as SequenceRecipe)) {
    return (
      <AuthoringError component="SequenceStepper">
        {eda === undefined ? (
          <>
            falta la prop <code>eda</code>. Recetas: {RECIPES.join(', ')}.
          </>
        ) : (
          <>
            «{eda}» no es una receta conocida. Hoy son {RECIPES.join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }
  if (operation === undefined || !OPERATIONS.includes(operation as SequenceOperation)) {
    return (
      <AuthoringError component="SequenceStepper">
        {operation === undefined ? (
          <>
            falta la prop <code>operation</code>. Operaciones: {OPERATIONS.join(', ')}.
          </>
        ) : (
          <>
            «{operation}» no es una operación conocida. Hoy son {OPERATIONS.join(', ')}.
          </>
        )}
      </AuthoringError>
    );
  }
  const recipe = eda as SequenceRecipe;
  const op = operation as SequenceOperation;
  if (!isValidCombination(recipe, op, tail)) {
    return (
      <AuthoringError component="SequenceStepper">
        «{OPERATION_LABEL[op]}» no está definida sobre «{RECIPE_LABEL[recipe]}»:{' '}
        {refusalReason(recipe, op, tail)}
      </AuthoringError>
    );
  }
  if (values === undefined) {
    return (
      <AuthoringError component="SequenceStepper">
        falta la prop <code>values</code> con el contenido inicial.
      </AuthoringError>
    );
  }
  if (!Array.isArray(values)) {
    return (
      <AuthoringError component="SequenceStepper">
        <code>values</code> es una lista entre corchetes, como <code>{'values={[7, 3, 1]}'}</code>.
      </AuthoringError>
    );
  }
  // What the picture can draw: a finite number and, on a tree, a symbol or a
  // gap. Anything else either reaches the SVG as a React child — an object
  // takes the whole page down, past the authoring-error box — or turns into
  // a gap on its way through the JSON key (NaN, Infinity, undefined) and
  // changes the tree's shape without a word.
  const odd = values.findIndex(
    (v) => v !== null && typeof v !== 'string' && !(typeof v === 'number' && Number.isFinite(v)),
  );
  if (odd >= 0) {
    return (
      <AuthoringError component="SequenceStepper">
        <code>values[{odd}]</code> no es un número: <code>values</code> admite números y, en
        binary-tree, símbolos y null.
      </AuthoringError>
    );
  }
  // The hash table's keys are text (#326): the class's table holds Strings,
  // and a number there would be hashed as nothing the listing computes.
  const hash = recipe === 'hash-chaining' || recipe === 'hash-probing';
  if (deleted !== undefined && recipe !== 'hash-probing') {
    return (
      <AuthoringError component="SequenceStepper">
        <code>deleted</code> marca claves borradas en la tabla con sondeo lineal: solo hash-probing
        lo acepta.
      </AuthoringError>
    );
  }
  if (
    deleted !== undefined &&
    !(Array.isArray(deleted) && deleted.every((d) => typeof d === 'string'))
  ) {
    return (
      <AuthoringError component="SequenceStepper">
        <code>deleted</code> es una lista de claves, como <code>{"deleted={['Bea']}"}</code>.
      </AuthoringError>
    );
  }
  if (hash) {
    const notText = values.findIndex((v) => typeof v !== 'string');
    if (notText >= 0) {
      return (
        <AuthoringError component="SequenceStepper">
          <code>values[{notText}]</code> no es una clave: en las tablas hash las claves son textos,
          como <code>{"values={['Ana', 'Bea']}"}</code>.
        </AuthoringError>
      );
    }
    const arg = op === 'insert' ? value : op === 'resize' ? undefined : target;
    const args = arg === undefined ? [] : Array.isArray(arg) ? arg : [arg];
    if (args.some((a) => typeof a !== 'string')) {
      return (
        <AuthoringError component="SequenceStepper">
          la clave de {op === 'insert' ? <code>value</code> : <code>target</code>} es un texto en
          las tablas hash, como <code>{op === 'insert' ? 'value="Ana"' : 'target="Ana"'}</code>.
        </AuthoringError>
      );
    }
  } else {
    const word = [value, target].flat().find((a) => typeof a === 'string');
    if (word !== undefined) {
      return (
        <AuthoringError component="SequenceStepper">
          «{word}»: solo las tablas hash trabajan con claves de texto en <code>value</code> y{' '}
          <code>target</code>.
        </AuthoringError>
      );
    }
  }
  // A gap only means something in a tree written in level order; anywhere
  // else `null` would be read as a value, and `Number(null)` is 0.
  if (recipe !== 'binary-tree' && values.some((v) => v === null)) {
    return (
      <AuthoringError component="SequenceStepper">
        «null» marca un hueco del árbol: solo binary-tree lo acepta en <code>values</code>.
      </AuthoringError>
    );
  }
  // A symbol only means something as an operator of an expression tree;
  // anywhere else it would be read as a number, and `Number('+')` is NaN.
  const symbol = values.find((v) => typeof v === 'string');
  if (recipe !== 'binary-tree' && !hash && symbol !== undefined) {
    return (
      <AuthoringError component="SequenceStepper">
        «{symbol}»: solo binary-tree acepta símbolos en <code>values</code>.
      </AuthoringError>
    );
  }
  // The cap is on what is DRAWN: a gap in a level order is not a node.
  const drawn = values.filter((v) => v !== null).length;
  // The guard has to count what the chain will GROW to, not what it starts
  // at: `value={[9, 4, 6]}` over four nodes ends at seven.
  // `insert-ordered` takes its values through `target`, not `value`, so
  // counting only `value` let an ordered slide draw past the cap.
  const grows = op.startsWith('insert');
  const from = op === 'insert-ordered' ? target : value;
  // A single value counts as one, alone or in a list — a hash table's key
  // (text) as much as a number.
  const inserted = !grows || from === undefined ? 0 : Array.isArray(from) ? from.length : 1;
  const cap =
    recipe === 'avl' && (op === 'insert' || op === 'remove') ? MAX_AVL_VALUES : MAX_VALUES;
  if (drawn + inserted > cap) {
    return (
      <AuthoringError component="SequenceStepper">
        la estructura llega a {drawn + inserted} elementos. El dibujo se lee bien hasta {cap}; con
        más, los nodos quedan ilegibles en la proyección.
      </AuthoringError>
    );
  }
  return (
    <Body
      recipe={recipe}
      operation={op}
      values={values}
      value={value}
      index={index}
      target={target}
      times={times}
      capacity={capacity}
      method={method}
      receiver={receiver}
      receiverType={receiverType}
      pointer={pointer}
      tail={tail}
      iterative={iterative}
      program={program}
      deleted={deleted}
      autoplay={autoplay}
      speed={speed}
      showCode={showCode}
      title={title}
    />
  );
}

interface BodyProps {
  recipe: SequenceRecipe;
  operation: SequenceOperation;
  values: (TreeValue | null)[];
  value?: number | string | (number | string)[];
  index?: number | number[];
  target?: number | string | (number | string)[];
  times?: number;
  capacity?: number;
  method?: string;
  receiver?: string;
  receiverType?: string;
  pointer?: string;
  tail: boolean;
  iterative: boolean;
  program: boolean;
  deleted?: string[];
  autoplay: boolean;
  speed: StepSpeed;
  showCode: boolean;
  title?: string;
}

function Body({
  recipe,
  operation,
  values,
  value,
  index,
  target,
  times,
  capacity,
  method,
  receiver,
  receiverType,
  pointer,
  tail,
  iterative,
  program,
  deleted,
  autoplay,
  speed,
  showCode,
  title,
}: BodyProps) {
  const mode = useMode();
  const heap = recipe === 'heap-max';
  const tree = recipe === 'binary-tree' || recipe === 'bst' || recipe === 'avl';
  const hash = recipe === 'hash-chaining' || recipe === 'hash-probing';
  const legend = runLegend(recipe, operation);
  const isPresentation = mode === 'presentation';
  const outerRef = useRef<HTMLElement | null>(null);

  // MDX re-mints `values` on every parent re-render, so the memo and every
  // reset key hang off a primitive-derived string rather than the array's
  // identity (`add-a-content-component.md` §2, learned in #266).
  // JSON, so a gap and a symbol both survive the round trip: a bare join
  // writes a gap as an empty string (`Number('')` is 0) and loses the
  // difference between the number 3 and a symbol.
  const valuesKey = JSON.stringify(values);
  // Every inline-authored data prop goes through a primitive key, not only
  // `values`: MDX re-mints each array literal on every parent render, so a
  // memo keyed on the references recomputes the trace — and `cellsFrom` mints
  // fresh cell ids, which remounts every node of the picture. The rule is
  // add-a-content-component.md §2, and the multi-run props are arrays too.
  const valueKey = String(value);
  const indexKey = String(index);
  const targetKey = String(target);
  const deletedKey = JSON.stringify(deleted ?? []);
  const resetKey = [
    recipe,
    operation,
    valuesKey,
    valueKey,
    indexKey,
    targetKey,
    times,
    capacity,
    method,
    receiver,
    receiverType,
    pointer,
    tail,
    iterative,
    program,
    deletedKey,
  ].join('|');

  const built = useMemo((): { trace: SequenceTrace } | { error: string } => {
    try {
      return {
        trace: traceFor(recipe, operation, {
          ...readValues(valuesKey),
          // The guards in `SequenceStepper` already refused a number where a
          // key goes and text anywhere else, so these narrowings only say so.
          ...(hash
            ? {
                keys: JSON.parse(valuesKey) as string[],
                deleted: JSON.parse(deletedKey) as string[],
                key: (operation === 'insert' ? value : target) as string | string[] | undefined,
              }
            : {}),
          value: hash ? undefined : (value as number | number[] | undefined),
          index,
          target: hash ? undefined : (target as number | number[] | undefined),
          times,
          capacity,
          method,
          receiver,
          receiverType,
          pointer,
          tail,
          iterative,
          program,
        }),
      };
    } catch (cause) {
      return { error: cause instanceof Error ? cause.message : String(cause) };
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the keys ARE the props
  }, [
    recipe,
    operation,
    valuesKey,
    valueKey,
    indexKey,
    targetKey,
    times,
    capacity,
    method,
    receiver,
    receiverType,
    pointer,
    tail,
    iterative,
    program,
    deletedKey,
  ]);

  const trace = 'trace' in built ? built.trace : null;
  const totalSteps = trace?.steps.length ?? 0;

  const playback = useStepPlayback({
    totalSteps,
    autoplay,
    speed,
    visibilityRef: outerRef,
    resetKey,
  });

  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction: 0.75,
    deps: [resetKey],
  });

  if (trace === null) {
    return (
      <AuthoringError component="SequenceStepper">
        {'error' in built ? built.error : 'no se pudo construir la animación.'}
      </AuthoringError>
    );
  }

  const step = trace.steps[Math.min(playback.stepIndex, totalSteps - 1)]!;
  // The chip beside it already names the structure, so the heading names only
  // the operation — repeating the recipe pushed the step counter onto a second
  // line at 1440px.
  const heading = title ?? OPERATION_LABEL[operation];
  const atEnd = playback.stepIndex >= totalSteps - 1;

  return (
    <figure
      ref={outerRef}
      data-widget="sequence-stepper"
      data-recipe={recipe}
      data-operation={operation}
      data-mode={mode}
      data-step={playback.stepIndex}
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink"
    >
      <StepperHeader
        // The chip names the structure in the reader's own words. It said
        // `eda` until the #288 review measured the document and found the
        // acronym on screen thirteen times and defined on no slide — the
        // opening's definition of the TDA/EDA pair was cut during the
        // slide-by-slide review, and a shorthand the reader has not met is
        // exactly what `teach-a-data-structure.md` §2 forbids. The prop is
        // still `eda`, because that is the author's vocabulary, not the
        // student's.
        kind={`estructura · ${RECIPE_LABEL[recipe]}`}
        title={heading}
        stepIndex={playback.stepIndex}
        totalSteps={totalSteps}
      />

      {/*
        Stacked in BOTH modes, and the panels share a 1px rule rather than
        each carrying a border of its own — the shape `<StepShow>` uses, which
        is the widget the sibling class of this unit is built on. Two columns
        were wrong for the same reason recorded there: the structure is a
        horizontal chain, so halving its width halves the drawing, and the
        node labels land near the size where a projector loses them. Stacking
        gives the listing and the chain the full width each.
      */}
      <div className="flex flex-col gap-px bg-rule">
        {showCode ? (
          <div
            className={
              isPresentation ? 'bg-surface text-base [&_.cm-editor]:!text-base' : 'bg-surface'
            }
          >
            {trace.row !== undefined ? (
              // Listings side by side in one row, each named and lit on its
              // own: the AVL's insert beside balance, a program beside both
              // (#322). Two share the width in halves; three give the program
              // a fifth and the methods two fifths each (Miguel's review). The
              // book's column holds them one over the other.
              <div
                className={
                  !isPresentation
                    ? 'grid grid-cols-1 gap-px bg-rule'
                    : trace.row.length === 3
                      ? 'grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)_minmax(0,2fr)] gap-px bg-rule'
                      : 'grid grid-cols-2 gap-px bg-rule'
                }
              >
                {trace.row.map((listing, i) => (
                  <div
                    key={listing.name}
                    data-testid="sequence-listing"
                    data-listing={listing.name}
                    className="flex flex-col bg-surface"
                  >
                    <div className="px-3 pt-1 font-mono text-3xs uppercase tracking-wide text-ink-faint">
                      {listing.name}
                    </div>
                    <div className="flex-1 [&>div>div]:h-full [&>div]:h-full [&_.cm-content]:!min-h-0 [&_.cm-content]:!self-center [&_.cm-editor]:h-full [&_.cm-gutter]:!min-h-0 [&_.cm-gutters]:!items-center [&_.cm-gutters]:!self-stretch">
                      <CodeStepper
                        code={listing.code}
                        highlightLines={step.rowLines?.[i] ?? []}
                        language="java"
                      />
                    </div>
                  </div>
                ))}
              </div>
            ) : trace.callees !== undefined ? (
              // A method over the methods it calls: the double rotation above,
              // its two simple rotations side by side under it, each lit while
              // its call runs, the call itself lit above the whole time (#322).
              <div className="flex flex-col gap-px bg-rule">
                <div data-testid="sequence-listing" data-listing="principal" className="bg-surface">
                  <CodeStepper
                    code={trace.code}
                    highlightLines={step.highlightLines}
                    language="java"
                  />
                </div>
                <div className="grid grid-cols-2 gap-px bg-rule">
                  {trace.callees.map((callee, i) => (
                    <div
                      key={callee.name}
                      data-testid="sequence-listing"
                      data-listing={callee.name}
                      className="flex flex-col bg-surface"
                    >
                      <div className="px-3 pt-1 font-mono text-3xs uppercase tracking-wide text-ink-faint">
                        {callee.name}
                      </div>
                      <CodeStepper
                        code={callee.code}
                        highlightLines={step.calleeLines?.[i] ?? []}
                        language="java"
                      />
                    </div>
                  ))}
                </div>
              </div>
            ) : trace.alongside === undefined ? (
              <div data-testid="sequence-listing">
                <CodeStepper
                  code={trace.code}
                  highlightLines={step.highlightLines}
                  language="java"
                />
              </div>
            ) : (
              // Two listings share the width, lit at the same moment: two
              // versions of one operation — the call per level against the
              // loop — in two equal halves, or a program and the method it
              // calls, the program as narrow as its lines so the method's
              // fit beside it (#322). The book's column is too narrow for
              // that method beside anything: there the program goes on top.
              <div
                className={
                  trace.listingNames === undefined
                    ? 'grid grid-cols-2 gap-px bg-rule'
                    : isPresentation
                      ? 'grid grid-cols-[max-content_minmax(0,1fr)] gap-px bg-rule'
                      : 'grid grid-cols-1 gap-px bg-rule'
                }
              >
                {(
                  [
                    [trace.listingNames?.[0] ?? 'recursiva', trace.code, step.highlightLines],
                    [
                      trace.listingNames?.[1] ?? 'iterativa',
                      trace.alongside,
                      step.alongsideLines ?? [],
                    ],
                  ] as const
                ).map(([name, code, lines]) => (
                  <div
                    key={name}
                    data-testid="sequence-listing"
                    data-listing={name}
                    className="flex flex-col bg-surface"
                  >
                    <div className="px-3 pt-1 font-mono text-3xs uppercase tracking-wide text-ink-faint">
                      {name}
                    </div>
                    {/*
                      The shorter listing fills its column and sits in the
                      middle of it: the editor takes the column's height and
                      centres its lines, the gutter's background still
                      running top to bottom — rather than ending early over a
                      band of the panel's own ground.
                    */}
                    <div className="flex-1 [&>div>div]:h-full [&>div]:h-full [&_.cm-content]:!min-h-0 [&_.cm-content]:!self-center [&_.cm-editor]:h-full [&_.cm-gutter]:!min-h-0 [&_.cm-gutters]:!items-center [&_.cm-gutters]:!self-stretch">
                      <CodeStepper code={code} highlightLines={[...lines]} language="java" />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : null}
        <div className="relative bg-surface">
          {/*
            `size` is a FIELD of the structure, not a caption, so it is
            written the way the listing writes it and it is on screen at
            every frame — the operations that cost nothing and the ones that
            cost the whole chain both end by changing it, and the reader
            should be able to watch that rather than take the narration's
            word for it. Outside the scrolling box so a wide chain cannot
            push it off screen.
          */}
          {/* What a search looks for, on every frame of its run (#322). */}
          {step.seek !== undefined ? (
            <div
              data-testid="sequence-seek"
              className="pointer-events-none absolute left-3 top-2 z-10 rounded-full border border-rule-strong bg-surface px-2.5 py-0.5 text-xs font-semibold text-ink"
            >
              se busca el {step.seek}
            </div>
          ) : null}
          {/* A tree's listing has no size field to show, so it gets no readout. */}
          <div
            data-testid="sequence-size"
            hidden={tree}
            className="pointer-events-none absolute right-3 top-2 z-10 text-center"
          >
            {/* The heap's listing calls the field `n`, and past it the array
                still holds cells that are no longer in the heap — so the
                readout is `n`, not the number of cells drawn. */}
            <div
              className={`font-mono text-3xs tracking-wide text-ink-faint ${heap ? '' : 'uppercase'}`}
            >
              {heap ? 'n' : 'size'}
            </div>
            <div className="min-w-11 rounded border border-rule bg-sunk px-2 py-1 text-lg font-semibold leading-none text-ink">
              {step.probe?.size ?? step.hash?.size ?? step.heapSize ?? step.cells.length}
            </div>
            {step.capacity === undefined ? null : (
              <div className="mt-0.5 font-mono text-3xs text-ink-faint">
                capacidad {step.capacity}
              </div>
            )}
            {/*
              The elementary-operation count is NOT on screen, and that is a
              decision rather than an omission — #294, ADR-0074 §Amended by.
              `step.cost` is still computed and still asserted by the suite:
              it is the trace's own arithmetic, and the tests that read it are
              the reason the frame counts can be trusted.

              What it could not do is the job ADR-0074 §Consequences gave it,
              "the reader reads Θ(1) against Θ(N) off the widget". A single
              run shows a single number, and one number is not a growth rate:
              on the slide that pointed at it, `enqueue` read 1 and `dequeue`
              read 3 over three elements — a factor of three that any constant
              explains as well as N does. Seven of the eight slides that
              mounted the widget never referred to it at all, so on those it
              was chrome that reset between runs with nothing to say.
            */}
          </div>
          {trace.probe !== undefined && step.probe !== undefined ? (
            <ProbeView
              probe={step.probe}
              buckets={trace.probe.buckets}
              description={step.description}
              presentation={isPresentation}
            />
          ) : trace.hash !== undefined && step.hash !== undefined ? (
            <HashView
              hash={step.hash}
              run={trace.hash}
              description={step.description}
              presentation={isPresentation}
            />
          ) : trace.tree !== undefined && step.tree !== undefined ? (
            <TreeView
              tree={step.tree}
              run={trace.tree}
              description={step.description}
              label={RECIPE_LABEL[recipe]}
              presentation={isPresentation}
            />
          ) : heap ? (
            <HeapView
              step={step}
              maxCells={trace.maxCells}
              maxSlots={Math.max(...trace.steps.map((f) => f.capacity ?? 0))}
              sideBySide={isPresentation}
            />
          ) : (
            <div
              className="flex items-center justify-center overflow-x-auto p-3"
              style={{ maxHeight: isPresentation ? 'min(42vh, 400px)' : '24rem' }}
            >
              <StructureView
                step={step}
                recipe={recipe}
                maxCells={trace.maxCells}
                maxSlots={Math.max(
                  ...trace.steps.map((f) => f.capacity ?? f.cells.length),
                  trace.maxCells,
                )}
                align={trace.align}
                hasCarry={trace.hasCarry}
              />
            </div>
          )}
        </div>
      </div>

      <div aria-live="polite" data-testid="sequence-narration">
        <NarrationStrip
          text={step.description}
          reserve={isPresentation ? trace.steps.map((s) => s.description) : undefined}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
        <ControlButton
          onClick={playback.reset}
          disabled={playback.stepIndex === 0}
          label="Reiniciar"
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <ControlButton onClick={playback.rewind} disabled={playback.stepIndex === 0} label="Atrás">
          <SkipBack className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <ControlButton
          onClick={playback.togglePlay}
          label={playback.isPlaying ? 'Pausar' : 'Reproducir'}
        >
          {playback.isPlaying ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
        </ControlButton>
        <ControlButton onClick={playback.advance} disabled={atEnd} label="Adelante">
          <SkipForward className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        {/* Same control, same wording and same three speeds as `<MergeStepper>`
            and `<PartitionStepper>`: a reader who learned the chrome on one
            stepper of the course does not relearn it here. */}
        <label className="ml-1 inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink">
          <span className="font-mono text-3xs uppercase tracking-wide text-ink-faint">
            velocidad
          </span>
          <select
            value={playback.liveSpeed}
            onChange={(e) => playback.setLiveSpeed(e.target.value as StepSpeed)}
            className="bg-transparent text-xs text-ink outline-none"
            aria-label="Velocidad de reproducción"
          >
            <option value="slow">lenta</option>
            <option value="normal">normal</option>
            <option value="fast">rápida</option>
          </select>
        </label>

        <span className="ml-auto flex flex-wrap items-center gap-3 font-mono text-3xs text-ink-faint">
          {legend !== null ? (
            <>
              {legend.map(([swatchClass, label]) => (
                <LegendSwatch key={label} swatchClass={swatchClass} label={label} />
              ))}
            </>
          ) : (
            <>
              <LegendSwatch swatchClass="border-mark bg-mark-soft" label="nuevo" />
              <LegendSwatch swatchClass="border-focus bg-surface" label="bajo la mirada" />
              {heap ? (
                <LegendSwatch swatchClass="border-accent bg-surface" label="se intercambia" />
              ) : null}
              <LegendSwatch swatchClass="border-rule bg-sunk" label="libre" />
            </>
          )}
        </span>
      </div>
    </figure>
  );
}

// ── the picture ───────────────────────────────────────────────────────────

/**
 * The note sits UNDER its box and is left-aligned to it, never centred above
 * it: a pointer arrow lands on the box's centre from above, and a centred note
 * was drawn straight through by it ("nu|evo"). Left-aligning also keeps it
 * clear of the vertical leg of the circular recipe's closing arc, which rises
 * to the same centre from below.
 */
function CellNote({ cell, x, y }: { cell: SequenceCell; x: number; y: number }) {
  const note = CELL_NOTE[cell.state];
  if (note === undefined) return null;
  return (
    <text x={x} y={y} textAnchor="start" fontSize="9" fill="var(--color-ink-soft)">
      {note}
    </text>
  );
}

function StructureView({
  step,
  recipe,
  maxCells,
  maxSlots,
  align,
  hasCarry,
}: {
  step: SequenceStep;
  recipe: SequenceRecipe;
  maxCells: number;
  maxSlots: number;
  align: 'left' | 'right';
  hasCarry: boolean;
}) {
  const isList = recipe.startsWith('linked-list');
  const slots = step.capacity ?? step.cells.length;
  // The CANVAS is sized for the widest frame, so the drawing keeps one size
  // and one cell size from the first frame to the last; the BLOCK drawn
  // inside it is the one this frame has, so a block that fills and doubles
  // does it on screen (#294 — four pushes over a block of four read as six
  // cells beside a readout saying `capacidad 4`).
  //
  // `offset` is how far in the current cells start: when the chain grows at
  // the front, they sit flush right and the reserved slot is exactly where
  // the next node will land — so it lands without moving anything already on
  // screen.
  const layout = layoutSequence(maxCells, recipe, slots, hasCarry, maxSlots);
  const offset = align === 'right' ? maxCells - step.cells.length : 0;
  // Where the floating node sits — computed once and shared, because `head`
  // has to be able to point AT it and a second copy of this arithmetic is a
  // second chance to disagree with the drawing.
  // An operation that grows at the BACK names the slot itself, so the node
  // hovers over the place it is about to land; the rest keep the front slot
  // they have always used.
  const carrySlot = step.carry?.slot ?? Math.max(offset - 1, 0);
  const carryX =
    (layout.boxes[carrySlot]?.x ?? layout.lane) +
    (offset === 0 && step.carry?.slot === undefined ? 78 : 0);
  const carryTop = (layout.carryY ?? 0) + 18;
  // Where the chain's `null` terminator is drawn — and therefore where `head`
  // points when the chain is empty. Computed ONCE and shared with both, for
  // the same reason `carryX` is: two copies of this arithmetic are two
  // chances to disagree, and the disagreement paints as `head` striking
  // through a `null` it was supposed to reach.
  const lastLive = offset + step.cells.length - 1;
  const nullX =
    step.cells.length === 0
      ? (layout.boxes[offset]?.x ?? layout.width - BOX_W / 2) + 2
      : linkArrow(layout, lastLive).x1 + LIST_GAP + 2;
  const summary = describe(step, recipe);

  // A short structure can be narrower than the carry chip parked above it, so
  // the canvas takes the wider of the two — otherwise the chip is drawn
  // outside the viewBox and is clipped away.
  const canvasW = step.carry === undefined ? layout.width : Math.max(layout.width, 140);

  return (
    <svg
      viewBox={`0 0 ${canvasW} ${layout.height}`}
      className="h-auto w-full"
      // Capped rather than free: stacked full-width, the drawing scaled to
      // ~2.7x and the pointer band clipped its own labels against the panel
      // edge. The cap keeps the nodes at a size a projector reads without
      // letting a four-node chain fill a whole slide.
      style={{ maxWidth: `${canvasW * 1.7}px`, maxHeight: '100%' }}
      role="img"
      aria-label={summary}
      data-testid="sequence-structure"
    >
      <defs>
        <marker
          id="seq-arrow-head"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-accent)" />
        </marker>
        <marker id="seq-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-ink-soft)" />
        </marker>
        <marker
          id="seq-arrow-carry"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-mark)" />
        </marker>
        <marker
          id="seq-arrow-active"
          markerWidth="6"
          markerHeight="6"
          refX="5"
          refY="3"
          orient="auto"
        >
          <path d="M0,0 L6,3 L0,6 z" fill="var(--color-focus)" />
        </marker>
      </defs>

      {isList ? (
        <ListPicture
          step={step}
          layout={layout}
          recipe={recipe}
          offset={offset}
          carryX={carryX}
          carryTop={carryTop}
          lastLive={lastLive}
          nullX={nullX}
        />
      ) : null}
      {!isList ? <ArrayPicture step={step} layout={layout} /> : null}
      <Pointers
        step={step}
        layout={layout}
        offset={offset}
        carryX={carryX}
        carryTop={carryTop}
        nullX={nullX}
      />
      {step.carry ? (
        <Carry
          carry={step.carry}
          layout={layout}
          isList={isList}
          x={carryX}
          top={carryTop}
          offset={offset}
        />
      ) : null}
    </svg>
  );
}

function ArrayPicture({ step, layout }: { step: SequenceStep; layout: SequenceLayout }) {
  return (
    <g>
      {layout.boxes.map((box, i) => {
        // Read the BLOCK, not the live elements: a slot the algorithm just
        // vacated is empty and must draw empty, which is what makes a copy
        // visible as a move rather than as a colour change.
        const cell = step.slots?.[i] ?? undefined;
        const free = cell === null || cell === undefined;
        // Ruled out by a binary search: the whole cell fades and its border
        // dashes, as a ruled-out node does on the tree, so colour is not the
        // only signal.
        const out = !free && cell.state === 'discarded';
        return (
          <g key={i} data-state={free ? undefined : cell.state} opacity={out ? 0.45 : undefined}>
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={3}
              fill={free ? 'var(--color-sunk)' : CELL_FILL[cell.state]}
              stroke={free ? 'var(--color-rule)' : CELL_STROKE[cell.state]}
              strokeWidth={!free && (cell.state === 'active' || cell.state === 'found') ? 2.5 : 1.2}
              strokeDasharray={free || out ? '3 3' : undefined}
              opacity={!free && (cell.state === 'leaving' || cell.state === 'stale') ? 0.45 : 1}
            />
            {free ? null : (
              <text
                x={box.centerX}
                y={box.y + box.h / 2 + 5}
                textAnchor="middle"
                fontSize="15"
                fontWeight="600"
                fill="var(--color-ink)"
              >
                {cell.value}
              </text>
            )}
            <text
              x={box.centerX}
              y={box.y + box.h + 14}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-ink-faint)"
            >
              {i}
            </text>
            {free ? null : <CellNote cell={cell} x={box.x} y={box.y + box.h + 26} />}
          </g>
        );
      })}
    </g>
  );
}

function ListPicture({
  step,
  layout,
  recipe,
  offset,
  carryX,
  carryTop,
  lastLive,
  nullX,
}: {
  step: SequenceStep;
  layout: SequenceLayout;
  recipe: SequenceRecipe;
  offset: number;
  carryX: number;
  carryTop: number;
  /**
   * The last slot HOLDING a node, not the last slot drawn. A chain that grows
   * at the back sits flush left inside a layout reserved for the widest
   * frame, so the two differ by every slot not filled yet — and the chain
   * ends at the end of the CHAIN, not at the end of the canvas.
   */
  lastLive: number;
  /** Where the `null` terminator is drawn. */
  nullX: number;
}) {
  const doubly = recipe === 'linked-list-doubly';
  const circular = recipe === 'linked-list-circular';
  const last = lastLive;
  // Which node's `next` is climbing to the floating node this frame, in slot
  // coordinates. `-1` when none is.
  const linking = step.linkToCarry === undefined ? -1 : step.linkToCarry + offset;
  // Whether the slot the floating node is parked over still holds a node. It
  // does for an insertion in the middle and does not for one at the end, and
  // the two need different routes: one has to rise before it travels, the
  // other can run along the row it is leaving.
  const carrySlot = step.carry?.slot ?? -1;
  const carryOccupied = carrySlot >= 0 && step.cells[carrySlot - offset] !== undefined;

  return (
    <g>
      {layout.boxes.map((box, i) => {
        const cell = step.cells[i - offset];
        if (cell === undefined) return null;
        const arrow = linkArrow(layout, i);
        const isLast = i === last;
        const active = cell.state === 'active' || cell.state === 'found';
        return (
          <g key={cell.id} opacity={cell.state === 'leaving' ? 0.5 : 1}>
            {/* value half */}
            <rect
              x={box.x}
              y={box.y}
              width={box.w}
              height={box.h}
              rx={3}
              fill={CELL_FILL[cell.state]}
              stroke={CELL_STROKE[cell.state]}
              strokeWidth={active ? 2.5 : 1.2}
            />
            {/* prev field, doubly only — the back link has to leave from
                somewhere, and on this recipe that somewhere is a field of
                the node like any other */}
            {doubly ? (
              <>
                <rect
                  x={box.prevX!}
                  y={box.y}
                  width={LINK_W}
                  height={box.h}
                  rx={3}
                  fill="var(--color-sunk)"
                  stroke={CELL_STROKE[cell.state]}
                  strokeWidth={active ? 2.5 : 1.2}
                />
                <circle
                  cx={box.prevX! + LINK_W / 2}
                  cy={box.y + box.h / 2}
                  r={2.5}
                  fill="var(--color-ink-soft)"
                />
              </>
            ) : null}
            {/* next field */}
            <rect
              x={box.linkX!}
              y={box.y}
              width={LINK_W}
              height={box.h}
              rx={3}
              fill="var(--color-sunk)"
              stroke={CELL_STROKE[cell.state]}
              strokeWidth={active ? 2.5 : 1.2}
            />
            <circle
              cx={box.linkX! + LINK_W / 2}
              cy={box.y + box.h / 2}
              r={2.5}
              fill="var(--color-ink-soft)"
            />
            <text
              x={box.x + box.w / 2}
              y={box.y + box.h / 2 + 5}
              textAnchor="middle"
              fontSize="15"
              fontWeight="600"
              fill="var(--color-ink)"
            >
              {cell.value}
            </text>
            {/* The same rail the array draws, in the same place, so the two
                pictures can be read side by side. On a chain it is a
                POSITION the reader counts, not something a node stores —
                which is the whole difference: the array jumps to it, the
                chain walks to it. It renumbers itself after every insertion
                and every deletion, and watching that happen is half of what
                `insertAt` teaches. */}
            <text
              x={box.centerX}
              y={box.y + box.h + 14}
              textAnchor="middle"
              fontSize="10"
              fill="var(--color-ink-faint)"
            >
              {i - offset}
            </text>
            <CellNote cell={cell} x={box.x} y={box.y + box.h + 26} />

            {/* next arrow — to the following node, or to the null marker */}
            {i === linking ? (
              // The assignment the frame is about: this node's `next` leaves
              // the chain and climbs to the node waiting above the slot it is
              // about to occupy. Painted `mark`, like the node it reaches, so
              // the two read as one change.
              <path
                // Along the row and up into the floating node's underside
                // when the slot ahead is free — turning in beside it put the
                // corner within a few pixels of the arrowhead, and the riser
                // read as part of the head. When a node still stands in that
                // slot the row is not free, so the link rises in the gap
                // first and comes in from the side instead.
                d={
                  carryOccupied
                    ? `M ${arrow.x1} ${arrow.y} L ${arrow.x1 + LIST_GAP / 2} ${arrow.y} L ${
                        arrow.x1 + LIST_GAP / 2
                      } ${carryTop + BOX_H / 2} L ${carryX - 4} ${carryTop + BOX_H / 2}`
                    : `M ${arrow.x1} ${arrow.y} L ${carryX + BOX_W / 2} ${arrow.y} L ${
                        carryX + BOX_W / 2
                      } ${carryTop + BOX_H + 5}`
                }
                fill="none"
                style={{ stroke: 'var(--color-mark)' }}
                strokeWidth={2}
                markerEnd="url(#seq-arrow-carry)"
              />
            ) : !isLast || !circular ? (
              <line
                x1={arrow.x1}
                y1={doubly ? box.y + box.h * 0.35 : arrow.y}
                x2={(isLast ? arrow.x1 + LIST_GAP : arrow.x2) - 3}
                y2={doubly ? box.y + box.h * 0.35 : arrow.y}
                stroke={active ? 'var(--color-focus)' : 'var(--color-ink-soft)'}
                strokeWidth={active ? 2 : 1.2}
                markerEnd={active ? 'url(#seq-arrow-active)' : 'url(#seq-arrow)'}
              />
            ) : null}

            {/* prev arrow, doubly only — out of the `prev` field, back to
                the previous node. Lower than the next arrow so the two
                cross the same gap without sharing a line. */}
            {doubly && i - offset > 0 ? (
              <line
                x1={box.prevX! + LINK_W / 2}
                y1={box.y + box.h * 0.72}
                x2={layout.boxes[i - 1]!.linkX! + LINK_W + 3}
                y2={box.y + box.h * 0.72}
                stroke="var(--color-ink-faint)"
                strokeWidth={1}
                markerEnd="url(#seq-arrow)"
              />
            ) : null}
          </g>
        );
      })}

      {/* the terminator: `null` for an open chain, a closing arc for a ring */}
      {/* The terminator is the CHAIN's `null`. It is absent exactly when the
          chain has no `next` field showing one: while the LAST node's link is
          climbing to the floating node, and while an empty chain's `head` is
          doing the same. A link climbing from the MIDDLE takes nothing away
          from the end of the chain, so the `null` stays. */}
      {!circular && linking !== last && !(step.cells.length === 0 && step.headToCarry === true) ? (
        <text x={nullX} y={layout.top + BOX_H / 2 + 4} fontSize="11" fill="var(--color-ink-faint)">
          null
        </text>
      ) : null}
      {circular && layout.ringY !== null && step.cells.length > 0
        ? // The closing link, drawn between the two nodes that actually hold
          // it. It used to start at the last SLOT and land on slot 0, so on a
          // chain that does not fill the layout it left one node and arrived
          // at an empty box — and it stayed there while the chain grew past
          // it. Both ends are read off the live cells now, so the ring
          // re-anchors itself on every frame.
          (() => {
            const from = layout.boxes[last]!;
            const to = layout.boxes[offset]!;
            const x1 = from.linkX! + LINK_W / 2;
            // Off the node's centre on purpose: the index rail and the state
            // note are written under it, both anchored left of centre, and a
            // line rising through them crosses both.
            const x2 = to.x + BOX_W - 8;
            const y0 = layout.top + BOX_H;
            const y = layout.ringY!;
            const r = Math.min(10, Math.abs(x1 - x2) / 2);
            return (
              <>
                <path
                  d={`M ${x1} ${y0}
                    L ${x1} ${y - r}
                    Q ${x1} ${y} ${x1 - r} ${y}
                    L ${x2 + r} ${y}
                    Q ${x2} ${y} ${x2} ${y - r}
                    L ${x2} ${y0 + 4}`}
                  fill="none"
                  stroke="var(--color-ink-soft)"
                  strokeWidth={1.6}
                  strokeLinecap="round"
                  markerEnd="url(#seq-arrow)"
                />
                <text
                  x={(x1 + x2) / 2}
                  y={y - 6}
                  textAnchor="middle"
                  fontSize="10"
                  fontFamily="monospace"
                  fill="var(--color-ink-faint)"
                >
                  el último vuelve al primero
                </text>
              </>
            );
          })()
        : null}
    </g>
  );
}

function Pointers({
  step,
  layout,
  offset,
  carryX,
  carryTop,
  nullX,
}: {
  step: SequenceStep;
  layout: SequenceLayout;
  offset: number;
  carryX: number;
  carryTop: number;
  nullX: number;
}) {
  const headToCarry = step.headToCarry === true;
  return (
    <g>
      {step.pointers.map((pointer) => {
        const box = pointer.index === null ? null : layout.boxes[pointer.index + offset];
        const isHead = pointer.name === 'head';
        // A field of the structure against a cursor of the operation — the
        // trace says which (`SequencePointer.fixed`). It used to be a list of
        // names, which is why an array's own field landed in the cursor row
        // and printed its label on top of `i` (#294).
        const walking = !isHead && pointer.fixed !== true;
        const colour = walking ? 'var(--color-focus)' : 'var(--color-accent)';

        // `head` points ACROSS from the lane on the left, never down from
        // above: the floating node arrives directly over the front slot —
        // where head points — so from above the two shared one column.
        if (isHead) {
          const y = layout.top + BOX_H / 2;
          // Three destinations, in the order the operation visits them: the
          // floating node while `head = fresh` has run and the node has not
          // moved yet; the first node of the chain; and — when the chain is
          // empty — the one `null` the structure already draws at its end,
          // rather than a second null of head's own.
          const toX = headToCarry ? carryX + BOX_W / 2 : box ? (box.prevX ?? box.x) - 4 : nullX - 6;
          return (
            <g key={pointer.name}>
              <text
                x={0}
                y={y + 4}
                fontSize="11"
                fontWeight="700"
                fill={colour}
                fontFamily="monospace"
              >
                head
              </text>
              {headToCarry ? (
                <path
                  d={`M 38 ${y} L ${carryX - 34} ${y} L ${carryX - 34} ${carryTop + BOX_H / 2} L ${carryX - 4} ${carryTop + BOX_H / 2}`}
                  fill="none"
                  stroke={colour}
                  strokeWidth={1.6}
                  markerEnd="url(#seq-arrow-head)"
                />
              ) : (
                <line
                  x1={38}
                  y1={y}
                  x2={toX}
                  y2={y}
                  stroke={colour}
                  strokeWidth={1.6}
                  markerEnd="url(#seq-arrow-head)"
                />
              )}
              {/* No null of head's own: an empty chain still draws the one
                  terminator at its end, and head points AT that. Two nulls in
                  the same place is what it looked like before. */}
            </g>
          );
        }

        // A cursor standing on the same cell as a field is nudged sideways
        // and anchored away, or the field's arrow runs through the cursor's
        // label.
        const collides =
          walking &&
          pointer.index !== null &&
          step.pointers.some((other) => other.fixed === true && other.index === pointer.index);
        const nudge = collides ? 26 : 0;
        const y = pointer.fixed === true ? 10 : 28;
        const x = (box ? box.centerX : layout.width - 12) + nudge;
        return (
          <g key={pointer.name}>
            <text
              x={x}
              y={y}
              textAnchor={collides ? 'start' : 'middle'}
              fontSize="10"
              fontWeight="700"
              fill={colour}
              fontFamily="monospace"
            >
              {pointer.name}
            </text>
            <line
              x1={x}
              y1={y + 3}
              x2={x - nudge}
              y2={layout.top - 3}
              stroke={colour}
              strokeWidth={walking ? 1.8 : 1.2}
              markerEnd={walking ? 'url(#seq-arrow-active)' : 'url(#seq-arrow)'}
            />
          </g>
        );
      })}
    </g>
  );
}

function Carry({
  carry,
  layout,
  isList,
  x,
  top,
  offset,
}: {
  carry: NonNullable<SequenceStep['carry']>;
  layout: SequenceLayout;
  isList: boolean;
  /** Left edge and top of the floating node, computed by the caller. */
  x: number;
  top: number;
  /** How far into the reserved slots the live cells start. */
  offset: number;
}) {
  // The node that exists and is not in the chain yet, drawn as a NODE rather
  // than as a chip: it has a `next` field, that field is what the operation
  // assigns, and a chip cannot show an assignment. Painted `mark` — "look
  // here now" — because it is the only thing on screen that just changed.
  const y = top - 18;
  const target = carry.next === undefined ? undefined : carry.next;
  const linkX = x + BOX_W;
  return (
    <g>
      <text
        x={x}
        y={y + 12}
        fontSize="10"
        fontWeight="700"
        fontFamily="monospace"
        style={{ fill: 'var(--color-mark)' }}
      >
        {carry.label}
      </text>
      <rect
        x={x}
        y={y + 18}
        width={BOX_W}
        height={BOX_H}
        rx={3}
        fill="var(--color-mark-soft)"
        stroke="var(--color-mark)"
        strokeWidth={2.2}
      />
      {isList ? (
        <rect
          x={linkX}
          y={y + 18}
          width={LINK_W}
          height={BOX_H}
          rx={3}
          fill="var(--color-mark-soft)"
          stroke="var(--color-mark)"
          strokeWidth={2.2}
        />
      ) : null}
      <text
        x={x + BOX_W / 2}
        y={y + 18 + BOX_H / 2 + 5}
        textAnchor="middle"
        fontSize="15"
        fontWeight="600"
        fill="var(--color-ink)"
      >
        {carry.value}
      </text>
      {isList ? (
        <circle cx={linkX + LINK_W / 2} cy={y + 18 + BOX_H / 2} r={2.5} fill="var(--color-mark)" />
      ) : null}
      {/* The link, once assigned: down to the node it points at, or to a
          `null` written beside it. Absent entirely while unassigned, which is
          the state the first frame is about. */}
      {isList && target !== undefined ? (
        target === null ? (
          <text
            x={linkX + LINK_W + 8}
            y={y + 18 + BOX_H / 2 + 4}
            fontSize="11"
            fontFamily="monospace"
            style={{ fill: 'var(--color-mark)' }}
          >
            null
          </text>
        ) : (
          <path
            d={`M ${linkX + LINK_W / 2} ${y + 18 + BOX_H} L ${linkX + LINK_W / 2} ${layout.top - 16} L ${
              layout.boxes[target + offset]?.centerX ?? x
            } ${layout.top - 16} L ${layout.boxes[target + offset]?.centerX ?? x} ${layout.top - 3}`}
            fill="none"
            style={{ stroke: 'var(--color-mark)' }}
            strokeWidth={2}
            markerEnd="url(#seq-arrow-carry)"
          />
        )
      ) : null}
    </g>
  );
}

function describe(step: SequenceStep, recipe: SequenceRecipe): string {
  const contents = step.cells.map((c) => c.value).join(', ');
  const shape = recipe.startsWith('linked-list') ? 'La cadena' : 'El bloque';
  const body = step.cells.length === 0 ? 'está vacía.' : `contiene ${contents}.`;
  return `${shape} ${body} ${step.description}`;
}
