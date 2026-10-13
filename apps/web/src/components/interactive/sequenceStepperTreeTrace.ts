/**
 * Pure traces for the tree recipes of `<SequenceStepper>` (#321, ADR-0083).
 * Same contract as `sequenceStepperTrace`, which dispatches here: a recipe, an
 * operation and an author-written input become a frame list and the Java
 * listing those frames light lines of — so the suite pins every frame and the
 * browser is left only "does it look right" (`apps/web/CLAUDE.md` §2).
 *
 * A tree frame carries the whole tree (`step.tree`): every node with its two
 * links and its paint, the calls still open, and the strip under the tree.
 * `cells` mirrors the nodes so the rest of the widget can count them.
 *
 * `binary-tree` has no order, so its operations VISIT: the three traversals,
 * the height and a search that may have to look everywhere. `bst` keeps the
 * search-tree invariant, so its operations CHOOSE A SIDE at every node. The
 * `avl` recipe (#322) lives in `sequenceStepperAvlTrace.ts` and builds on the
 * pieces exported here: the node, the recorder, the search tree built by
 * inserting, and the run's columns.
 */
import {
  asRuns,
  lineOf,
  pairListings,
  requireRuns,
  type ListingPairs,
} from './sequenceStepperTraceShared';
// Types only: the dispatcher imports this module's `traceTree` as a value, so a
// value imported back from it would close a runtime cycle (ADR-0083 §1).
import type {
  BinaryTreeOperation,
  BstOperation,
  SequenceCell,
  SequenceCellState,
  SequenceInput,
  SequenceStep,
  SequenceStepKind,
  SequenceTrace,
  TreeFrame,
  TreeFrameNode,
  TreeValue,
} from './sequenceStepperTrace';

// Generic, and the recorder takes its root and strip as closures, for the
// search tree of Árboles II (#322): there `root` starts empty and changes with
// every insertion. Here every tree is built once and never changes shape.
export interface TreeNode<V extends TreeValue = TreeValue> {
  id: number;
  value: V;
  left: TreeNode<V> | null;
  right: TreeNode<V> | null;
}

/** A search tree holds numbers only: its operations compare them. */
export type NumberNode = TreeNode<number>;

type Traversal = Exclude<BinaryTreeOperation, 'height' | 'search'>;

/**
 * Each listing is the recursive method as the class writes it. The three
 * traversals differ in ONE line's position — where the visit sits among the
 * two calls — and that is the whole lesson of the three orders. The binary
 * tree's search has no order to lean on, so it tries both sides: a preorder
 * whose visit compares, marked with the same two comments. The search tree's
 * shares its signature and lets the invariant pick one side instead.
 */
const CODE = {
  preorder: `void preorder(Node<T> node) {
    if (node == null) return;
    // visita
    System.out.print(node.value + " ");
    // recorrido
    preorder(node.left);
    preorder(node.right);
}`,
  inorder: `void inorder(Node<T> node) {
    if (node == null) return;
    // recorrido: primero la izquierda
    inorder(node.left);
    // visita
    System.out.print(node.value + " ");
    // recorrido: después la derecha
    inorder(node.right);
}`,
  postorder: `void postorder(Node<T> node) {
    if (node == null) return;
    // recorrido
    postorder(node.left);
    postorder(node.right);
    // visita
    System.out.print(node.value + " ");
}`,
  height: `int height(Node<T> node) {
    if (node == null) return -1;
    int left = height(node.left);
    int right = height(node.right);
    return 1 + Math.max(left, right);
}`,
  containsAnywhere: `boolean contains(Node<T> node, T target) {
    if (node == null) return false;
    // visita: compara el nodo con el valor buscado
    if (node.value.equals(target)) return true;
    // recorrido: la izquierda y, si no estaba, la derecha
    return contains(node.left, target)
        || contains(node.right, target);
}`,
  containsOrdered: `boolean contains(Node<T> node, T target) {
    if (node == null) return false;
    int c = target.compareTo(node.value);
    if (c == 0) return true;
    if (c < 0) return contains(node.left, target);
    return contains(node.right, target);
}`,
  insert: `Node<T> insert(Node<T> node, T value) {
    if (node == null) return new Node<>(value);
    int c = value.compareTo(node.value);
    if (c < 0) {
        node.left = insert(node.left, value);
    } else if (c > 0) {
        node.right = insert(node.right, value);
    }
    return node;
}`,
  minimum: `T min() {
    if (root == null) {
        throw new NoSuchElementException();
    }
    return minimum(root).value;
}

Node<T> minimum(Node<T> node) {
    if (node.left == null) return node;
    return minimum(node.left);
}`,
  successor: `Node<T> successor(Node<T> node, T value) {
    Node<T> best = null;
    while (node != null) {
        if (value.compareTo(node.value) < 0) {
            best = node;
            node = node.left;
        } else {
            node = node.right;
        }
    }
    return best;
}`,
  remove: `Node<T> remove(Node<T> node, T value) {
    if (node == null) return null;
    int c = value.compareTo(node.value);
    if (c < 0) {
        node.left = remove(node.left, value);
    } else if (c > 0) {
        node.right = remove(node.right, value);
    } else if (node.left == null) {
        return node.right;
    } else if (node.right == null) {
        return node.left;
    } else {
        Node<T> next = node.right;
        while (next.left != null) next = next.left;
        node.value = next.value;
        node.right = remove(node.right, next.value);
    }
    return node;
}`,
} as const;

/** The traversal's name in the narration. */
const TRAVERSAL_NAME: Record<Traversal, string> = {
  preorder: 'preorden',
  inorder: 'inorden',
  postorder: 'postorden',
};

/** A height in the narration: the minus sign, not a hyphen. */
const signed = (n: number): string => (n < 0 ? `−${-n}` : String(n));

let nextId = 0;
export const nodeOf = <V extends TreeValue>(value: V): TreeNode<V> => ({
  id: (nextId += 1),
  value,
  left: null,
  right: null,
});

/**
 * The tree an author writes in level order, `null` where a child is missing:
 * `[3, 9, 1, 4, 7, null, 6]` is 3 over 9 and 1, 9 over 4 and 7, and 1 over a
 * lone right child 6. Every value has to have a parent to hang from.
 *
 * A gap has no children written: after a `null`, the next two entries belong
 * to the next node still waiting, not to the gap — `[1, 2, null, 3, 4, null,
 * null, 5]` hangs 5 under 4. That is the convention trees are written in, and
 * not the heap's, which numbers every position, the empty ones included.
 */
function fromLevelOrder(levels: (TreeValue | null)[]): TreeNode {
  const first = levels[0];
  if (first === undefined || first === null) {
    throw new Error(
      'El árbol no tiene raíz: el primer valor del orden por niveles no puede ser null.',
    );
  }
  const root = nodeOf(first);
  const waiting: TreeNode[] = [root];
  let i = 1;
  while (i < levels.length) {
    const parent = waiting.shift();
    if (parent === undefined) {
      const orphan = levels.slice(i).find((v) => v !== null);
      throw new Error(
        orphan === undefined
          ? 'El orden por niveles tiene huecos de más al final: un null marca el hijo que le falta a un nodo, y ya no queda ningún nodo esperando hijos.'
          : `El valor ${orphan} no tiene padre: en el orden por niveles cae bajo un hueco.`,
      );
    }
    for (const side of ['left', 'right'] as const) {
      if (i >= levels.length) break;
      const value = levels[i];
      i += 1;
      if (value === null || value === undefined) continue;
      const child = nodeOf(value);
      parent[side] = child;
      waiting.push(child);
    }
  }
  return root;
}

/** Every node with its depth, root first, each before its children (the order frames list them). */
export function nodesOf(root: TreeNode | null): { node: TreeNode; depth: number }[] {
  const out: { node: TreeNode; depth: number }[] = [];
  const walk = (n: TreeNode | null, depth: number) => {
    if (n === null) return;
    out.push({ node: n, depth });
    walk(n.left, depth + 1);
    walk(n.right, depth + 1);
  };
  walk(root, 0);
  return out;
}

/** Column = inorder position, for a tree whose shape never changes. */
function inorderColumns(root: TreeNode): Record<number, number> {
  const columns: Record<number, number> = {};
  let column = 0;
  const walk = (n: TreeNode | null) => {
    if (n === null) return;
    walk(n.left);
    columns[n.id] = column;
    column += 1;
    walk(n.right);
  };
  walk(root);
  return columns;
}

/**
 * The frame list every tree operation is written into. It owns the paint
 * (state and badge per node), the calls still open, the running cost and the
 * deepest level any frame reached, and turns them into one frame per `push`.
 *
 * A rotation (#322) adds two things. `loose` holds the nodes a local variable
 * keeps that no link from the root reaches — `q`, between `p.left = q.right`
 * and the caller taking it — so they stay on the drawing. And while `frozen`,
 * every node keeps the level it had in the last frame: the method changes
 * links, not places, and the tree settles only when the caller takes `q`.
 */
export class TreeRecorder {
  readonly steps: SequenceStep[] = [];
  readonly state = new Map<number, SequenceCellState>();
  readonly badge = new Map<number, string>();
  readonly path: number[] = [];
  readonly loose: TreeNode[] = [];
  frozen = false;
  cost = 0;
  depth = 0;
  private readonly lastDepth = new Map<number, number>();
  private readonly code: string;
  private readonly rootOf: () => TreeNode | null;
  private readonly stripOf: () => (TreeValue | null)[];

  constructor(code: string, rootOf: () => TreeNode | null, stripOf: () => (TreeValue | null)[]) {
    this.code = code;
    this.rootOf = rootOf;
    this.stripOf = stripOf;
  }

  /** Starts a new run of the operation: nothing painted, nothing open, cost zero. */
  reset(): void {
    this.state.clear();
    this.badge.clear();
    this.path.length = 0;
    this.cost = 0;
  }

  /**
   * What stays lit between two frames: a node that was just written or just
   * answered becomes visited, and the node under the eye goes back to idle
   * unless something already marked it.
   */
  settle(): void {
    for (const [id, s] of this.state) {
      if (s === 'new') this.state.set(id, 'visited');
      if (s === 'active') this.state.set(id, 'idle');
    }
  }

  push(
    kind: SequenceStepKind,
    fragments: string[],
    description: string,
    stripFresh?: number,
    probe?: TreeFrame['probe'],
  ) {
    const root = this.rootOf();
    // Root first, then whatever only a local variable still holds; a node two
    // references reach (`p.left` and `q.right` mid-rotation) is drawn once.
    const seen = new Set<number>();
    const placed: { node: TreeNode; depth: number }[] = [];
    for (const start of [root, ...this.loose]) {
      for (const { node, depth } of nodesOf(start)) {
        if (seen.has(node.id)) continue;
        seen.add(node.id);
        placed.push({ node, depth: this.frozen ? (this.lastDepth.get(node.id) ?? depth) : depth });
      }
    }
    const nodes: TreeFrameNode[] = placed.map(({ node: n, depth }) => {
      this.lastDepth.set(n.id, depth);
      this.depth = Math.max(this.depth, depth);
      const out: TreeFrameNode = {
        id: n.id,
        value: n.value,
        left: n.left?.id ?? null,
        right: n.right?.id ?? null,
        depth,
        state: this.state.get(n.id) ?? 'idle',
      };
      const mark = this.badge.get(n.id);
      if (mark !== undefined) out.badge = mark;
      return out;
    });
    const tree: TreeFrame = {
      root: root?.id ?? null,
      nodes,
      path: [...this.path],
      strip: this.stripOf(),
    };
    if (stripFresh !== undefined) tree.stripFresh = stripFresh;
    if (probe !== undefined) tree.probe = probe;
    // On a tree, cells only count the nodes: the view draws `tree.nodes`. A
    // symbol has no number to mirror, and nothing reads the value here.
    const cells: SequenceCell[] = nodes.map((n) => ({
      id: n.id,
      value: typeof n.value === 'number' ? n.value : 0,
      state: n.state,
    }));
    this.steps.push({
      kind,
      cells,
      pointers: [],
      highlightLines: fragments.map((f) => lineOf(this.code, f)),
      description,
      cost: this.cost,
      tree,
    });
  }
}

type Side = 'left' | 'right';

/** A side in the narration: the child's name. */
const SIDE_NAME: Record<Side, string> = { left: 'izquierdo', right: 'derecho' };

/**
 * One call a node makes to one side, as a frame of its own: the line of that
 * call lit and the caller under the eye. A call to a child lights the edge down
 * to it and goes on into it. A call to an empty side IS the base case — the
 * frame lights that line as well, draws the empty subtree where the call
 * landed, and the call is over: `empty` is what it returns.
 *
 * Every line the method runs gets its frame, the base case included. Before
 * this, a traversal lit only its print: the reader never saw the two calls,
 * nor the empty calls that end the recursion under every leaf.
 */
function callSide<R>(
  rec: TreeRecorder,
  n: TreeNode,
  side: Side,
  lines: { call: string; base: string },
  says: { child: (child: TreeNode) => string; empty: string },
  into: (child: TreeNode) => R,
  empty: R,
): R {
  rec.settle();
  const before = rec.state.get(n.id);
  rec.state.set(n.id, 'active');
  const child = n[side];
  if (child === null) {
    rec.push('walk', [lines.call, lines.base], says.empty, undefined, { parent: n.id, side });
  } else {
    rec.path.push(child.id);
    rec.push('walk', [lines.call], says.child(child));
    rec.path.pop();
  }
  // The caller keeps the paint it had: a node already visited stays visited
  // while its walk passes back through it.
  if (before === undefined) rec.state.delete(n.id);
  else rec.state.set(n.id, before);
  return child === null ? empty : into(child);
}

export function traceTree(operation: BinaryTreeOperation, input: SequenceInput): SequenceTrace {
  const root = fromLevelOrder(input.levelOrder ?? input.values);
  if (operation === 'height') return traceHeight(root);
  if (operation === 'search') return traceSearchAnywhere(root, asRuns(input.target));
  return traceTraversal(root, operation);
}

export function traceSearchTree(operation: BstOperation, input: SequenceInput): SequenceTrace {
  const repeated = input.values.find((v, i) => input.values.indexOf(v) !== i);
  if (repeated !== undefined) {
    throw new Error(
      `El valor ${repeated} está repetido: un árbol de búsqueda no guarda dos veces el mismo valor.`,
    );
  }
  if (operation === 'search') {
    const trace = traceSearchOrdered(input.values, asRuns(input.target));
    return input.iterative === true
      ? pairListings(trace, CONTAINS_ITERATIVE, CONTAINS_PAIRS)
      : trace;
  }
  if (operation === 'minimum' && input.iterative === true) {
    return pairListings(traceMinimum(input.values), MINIMUM_ITERATIVE, MINIMUM_PAIRS);
  }
  if (operation === 'insert' && input.iterative === true) {
    return pairListings(
      traceInsert(input.values, asRuns(input.value)),
      INSERT_ITERATIVE,
      INSERT_PAIRS,
    );
  }
  if (operation === 'minimum') return traceMinimum(input.values);
  if (operation === 'successor') return traceSuccessor(input.values, asRuns(input.target));
  if (operation === 'remove') return traceRemove(input.values, asRuns(input.target));
  return traceInsert(input.values, asRuns(input.value));
}

/** The result every tree operation hands back, sized for the whole run. */
export function finish(
  rec: TreeRecorder,
  code: string,
  columns: Record<number, number>,
  slots: number,
  strip: boolean,
): SequenceTrace {
  return {
    steps: rec.steps,
    code,
    maxCells: slots,
    align: 'left',
    hasCarry: false,
    tree: { columns, slots, depth: rec.depth, strip },
  };
}

// ── binary-tree: the three traversals ─────────────────────────────────────

function traceTraversal(root: TreeNode, traversal: Traversal): SequenceTrace {
  const code = CODE[traversal];
  const name = TRAVERSAL_NAME[traversal];
  const columns = inorderColumns(root);
  const slots = nodesOf(root).length;
  const strip: (TreeValue | null)[] = Array.from({ length: slots }, () => null);
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [...strip],
  );
  let written = 0;

  const write = (n: TreeNode, description: string) => {
    rec.settle();
    const slot = written;
    written += 1;
    rec.cost += 1;
    rec.state.set(n.id, 'new');
    rec.badge.set(n.id, String(written));
    strip[slot] = n.value;
    rec.push('build', ['System.out.print'], description, slot);
  };

  const call = (n: TreeNode, side: Side) =>
    callSide(
      rec,
      n,
      side,
      { call: `${traversal}(node.${side})`, base: 'if (node == null)' },
      {
        child: (c) => `${traversal}(${n.value}): llama con su hijo ${SIDE_NAME[side]}, ${c.value}.`,
        empty: `${traversal}(${n.value}): su hijo ${SIDE_NAME[side]} es null; ${traversal}(null) es el caso base y vuelve sin hacer nada.`,
      },
      visit,
      undefined,
    );

  function visit(n: TreeNode): void {
    rec.path.push(n.id);
    const v = n.value;
    if (traversal === 'preorder') {
      write(n, `preorder(${v}): se visita ${v}, antes que sus dos lados.`);
      call(n, 'left');
      call(n, 'right');
    } else if (traversal === 'inorder') {
      call(n, 'left');
      write(n, `inorder(${v}): su izquierda ya se recorrió; se visita ${v}.`);
      call(n, 'right');
    } else {
      call(n, 'left');
      call(n, 'right');
      write(n, `postorder(${v}): sus dos lados ya se recorrieron; se visita ${v}.`);
    }
    rec.path.pop();
  }

  rec.push(
    'start',
    [`void ${traversal}(`],
    `El ${name} empieza con la llamada en la raíz, ${root.value}.`,
  );
  visit(root);
  rec.settle();
  rec.push('done', [], `El ${name} completo es ${strip.join(' ')}.`);
  return finish(rec, code, columns, slots, true);
}

// ── binary-tree: the height, answered from the leaves up ──────────────────

function traceHeight(root: TreeNode): SequenceTrace {
  const code = CODE.height;
  const columns = inorderColumns(root);
  const slots = nodesOf(root).length;
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [],
  );

  const answer = (n: TreeNode, h: number, description: string) => {
    rec.settle();
    rec.cost += 1;
    rec.state.set(n.id, 'new');
    rec.badge.set(n.id, `h=${h}`);
    rec.push('build', ['return 1 + Math.max'], description);
  };

  const ask = (n: TreeNode, side: Side): number =>
    callSide(
      rec,
      n,
      side,
      { call: `int ${side} = height`, base: 'if (node == null)' },
      {
        child: (c) =>
          `height(${n.value}): pide la altura de su hijo ${SIDE_NAME[side]}, ${c.value}.`,
        empty: `height(${n.value}): su hijo ${SIDE_NAME[side]} es null; height(null) es el caso base y devuelve ${signed(-1)}.`,
      },
      height,
      -1,
    );

  function height(n: TreeNode): number {
    rec.path.push(n.id);
    const v = n.value;
    const left = ask(n, 'left');
    const right = ask(n, 'right');
    const h = 1 + Math.max(left, right);
    answer(
      n,
      h,
      `height(${v}): la izquierda devolvió ${signed(left)} y la derecha ${signed(right)}; devuelve 1 + max(${signed(left)}, ${signed(right)}) = ${h}.`,
    );
    rec.path.pop();
    return h;
  }

  rec.push(
    'start',
    ['int height('],
    'La altura se calcula desde las hojas hacia la raíz: cada nodo responde después de sus dos lados.',
  );
  const total = height(root);
  rec.settle();
  rec.push(
    'done',
    [],
    `La altura del árbol es ${total}: el camino más largo de la raíz a una hoja tiene ${total} ${total === 1 ? 'arista' : 'aristas'}.`,
  );
  return finish(rec, code, columns, slots, false);
}

// ── binary-tree: a search with no order to lean on ────────────────────────

function traceSearchAnywhere(root: TreeNode, targets: number[]): SequenceTrace {
  if (targets.length === 0) throw new Error('Falta el valor a buscar.');
  requireRuns(targets.length);
  const code = CODE.containsAnywhere;
  const columns = inorderColumns(root);
  const slots = nodesOf(root).length;
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [],
  );

  for (const t of targets) {
    rec.reset();
    rec.push(
      'start',
      ['boolean contains('],
      `Buscar ${t}: el árbol no tiene orden, así que ${t} puede estar en cualquier parte.`,
    );
    function search(n: TreeNode): boolean {
      rec.path.push(n.id);
      rec.settle();
      rec.cost += 1;
      rec.badge.set(n.id, String(rec.cost));
      const v = n.value;
      if (v === t) {
        rec.state.set(n.id, 'found');
        rec.push(
          'found',
          ['node.value.equals(target)'],
          `contains(${v}): ${v} es ${t}; devuelve true.`,
        );
        rec.path.pop();
        return true;
      }
      rec.state.set(n.id, 'active');
      rec.push(
        'compare',
        ['node.value.equals(target)'],
        `contains(${v}): ${v} no es ${t}; se busca en sus dos lados.`,
      );
      rec.state.set(n.id, 'visited');
      const look = (side: Side) =>
        callSide(
          rec,
          n,
          side,
          { call: `contains(node.${side}`, base: 'if (node == null)' },
          {
            child: (c) => `contains(${v}): busca en su hijo ${SIDE_NAME[side]}, ${c.value}.`,
            empty: `contains(${v}): su hijo ${SIDE_NAME[side]} es null; contains(null) es el caso base y devuelve false.`,
          },
          search,
          false,
        );
      // `||` asks the right side only when the left one said false.
      const hit = look('left') || look('right');
      rec.path.pop();
      return hit;
    }
    const found = search(root);
    rec.settle();
    rec.push(
      'done',
      [],
      found
        ? `${t} está en el árbol: apareció en la comparación ${rec.cost}.`
        : rec.cost === 1
          ? `${t} no está: se comparó el único nodo.`
          : `${t} no está: se compararon los ${rec.cost} nodos, uno por uno.`,
    );
  }
  return finish(rec, code, columns, slots, false);
}

// ── bst: built by inserting, and every operation chooses a side ───────────

/** Inserts with no frames: the tree a `bst` slide starts from. */
export function bstOf(
  values: number[],
  columnOf: (v: number) => number,
  columns: Record<number, number>,
) {
  let root: NumberNode | null = null;
  const place = (v: number): NumberNode => {
    const fresh = nodeOf(v);
    columns[fresh.id] = columnOf(v);
    return fresh;
  };
  for (const v of values) {
    if (root === null) {
      root = place(v);
      continue;
    }
    let n: NumberNode = root;
    for (;;) {
      const side = v < n.value ? 'left' : 'right';
      const next: NumberNode | null = n[side];
      if (next === null) {
        n[side] = place(v);
        break;
      }
      n = next;
    }
  }
  return { root, place };
}

/** Every value the run ever holds, sorted: a value's column is its rank here. */
export function columnsFor(values: number[]): (v: number) => number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return (v) => sorted.indexOf(v);
}

/** Marks a whole subtree as ruled out. */
function discard(rec: TreeRecorder, n: TreeNode | null): void {
  for (const { node } of nodesOf(n)) rec.state.set(node.id, 'discarded');
}

/**
 * The search tree's `contains` as a loop: the same comparisons, the same
 * nodes, a variable that walks down instead of a call per level. Shown
 * beside the recursive listing, so the class reads the two at once.
 */
const CONTAINS_ITERATIVE = `boolean contains(T target) {
    Node<T> node = root;
    while (node != null) {
        int c = target.compareTo(node.value);
        if (c == 0) return true;
        if (c < 0) node = node.left;
        else node = node.right;
    }
    return false;
}`;

/**
 * What each line the recursive search lights is in the loop: the call that
 * starts it is the loop's first assignment, a call on an empty side is the
 * condition that fails, a call on a side is the variable stepping to it. The
 * loop's condition lights with every comparison, because it is evaluated
 * before each one.
 */
const CONTAINS_PAIRS: ListingPairs = [
  ['boolean contains(', ['Node<T> node = root']],
  ['if (node == null) return false', ['while (node != null)', 'return false;']],
  ['int c = target.compareTo', ['while (node != null)', 'int c = target.compareTo']],
  ['if (c == 0) return true', ['if (c == 0) return true']],
  ['if (c < 0) return contains', ['if (c < 0) node = node.left']],
  ['return contains(node.right', ['else node = node.right']],
];

/** The minimum as a loop: step left while there is a left. */
const MINIMUM_ITERATIVE = `T min() {
    if (root == null) {
        throw new NoSuchElementException();
    }
    Node<T> node = root;
    while (node.left != null) {
        node = node.left;
    }
    return node.value;
}`;

const MINIMUM_PAIRS: ListingPairs = [
  ['return minimum(root).value', ['Node<T> node = root']],
  ['if (node.left == null) return node', ['while (node.left != null)', 'return node.value']],
  ['return minimum(node.left)', ['while (node.left != null)', 'node = node.left']],
];

/**
 * The insertion as a loop: the same descent with the parent kept one step
 * behind, and the leaf hung on the side the last comparison chose. The
 * recursive version hangs it on the way back, `node.left = insert(…)`; the
 * loop has no way back, so it remembers whom to hang it from.
 */
const INSERT_ITERATIVE = `void insert(T value) {
    Node<T> parent = null;
    Node<T> node = root;
    while (node != null) {
        int c = value.compareTo(node.value);
        if (c == 0) return;
        parent = node;
        node = c < 0 ? node.left : node.right;
    }
    Node<T> fresh = new Node<>(value);
    if (parent == null) root = fresh;
    else if (value.compareTo(parent.value) < 0) parent.left = fresh;
    else parent.right = fresh;
}`;

/** Where the frame's new leaf hangs: from nobody, or from a left or a right. */
const hungFrom = (step: SequenceStep): string => {
  const nodes = step.tree?.nodes ?? [];
  const fresh = nodes.find((n) => n.state === 'new');
  if (fresh === undefined) return 'if (parent == null) root = fresh';
  if (nodes.some((n) => n.left === fresh.id)) return 'parent.left = fresh';
  if (nodes.some((n) => n.right === fresh.id)) return 'else parent.right = fresh';
  return 'if (parent == null) root = fresh';
};

const INSERT_PAIRS: ListingPairs = [
  ['Node<T> insert(', ['Node<T> parent = null', 'Node<T> node = root']],
  ['int c = value.compareTo', ['while (node != null)', 'int c = value.compareTo']],
  ['return node;', ['if (c == 0) return']],
  ['node.left = insert', ['parent = node', 'node = c < 0']],
  ['node.right = insert', ['parent = node', 'node = c < 0']],
  [
    'return new Node<>(value)',
    (step) => ['while (node != null)', 'Node<T> fresh = new Node<>(value)', hungFrom(step)],
  ],
];

function traceSearchOrdered(values: number[], targets: number[]): SequenceTrace {
  if (targets.length === 0) throw new Error('Falta el valor a buscar.');
  requireRuns(targets.length);
  const code = CODE.containsOrdered;
  const columns: Record<number, number> = {};
  const columnOf = columnsFor(values);
  const { root } = bstOf(values, columnOf, columns);
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [],
  );

  for (const t of targets) {
    rec.reset();
    rec.push(
      'start',
      ['boolean contains('],
      `Buscar ${t}: en cada nodo, la invariante dice de qué lado puede estar.`,
    );
    let n = root;
    for (;;) {
      if (n === null) {
        rec.push(
          'done',
          ['if (node == null) return false'],
          `El lado que tocaba está vacío: ${t} no está en el árbol.`,
        );
        break;
      }
      rec.path.push(n.id);
      rec.settle();
      rec.cost += 1;
      rec.badge.set(n.id, String(rec.cost));
      rec.state.set(n.id, 'active');
      const v = n.value;
      rec.push(
        'compare',
        ['int c = target.compareTo'],
        `contains(${v}): se compara ${t} con ${v}.`,
      );
      if (t === v) {
        rec.state.set(n.id, 'found');
        rec.push('found', ['if (c == 0) return true'], `${t} es ${v}: está en el árbol.`);
        break;
      }
      rec.state.set(n.id, 'visited');
      if (t < v) {
        discard(rec, n.right);
        rec.push(
          'walk',
          ['if (c < 0) return contains'],
          `${t} < ${v}: por la invariante, ${t} solo puede estar a la izquierda de ${v}; la derecha se descarta entera.`,
        );
        n = n.left;
      } else {
        discard(rec, n.left);
        rec.push(
          'walk',
          ['return contains(node.right'],
          `${t} > ${v}: por la invariante, ${t} solo puede estar a la derecha de ${v}; la izquierda se descarta entera.`,
        );
        n = n.right;
      }
    }
  }
  return finish(rec, code, columns, new Set(values).size, false);
}

function traceInsert(values: number[], inserts: number[]): SequenceTrace {
  if (inserts.length === 0) throw new Error('Falta el valor a insertar.');
  requireRuns(inserts.length);
  const code = CODE.insert;
  const everything = [...values, ...inserts];
  const columnOf = columnsFor(everything);
  const slots = new Set(everything).size;
  const columns: Record<number, number> = {};
  const built = bstOf(values, columnOf, columns);
  let root = built.root;
  const rec = new TreeRecorder(
    code,
    () => root,
    stripByNode(() => root, columns, slots),
  );

  for (const x of inserts) {
    rec.reset();
    rec.push(
      'start',
      ['Node<T> insert('],
      `Insertar ${x}: se baja desde la raíz, como al buscarlo.`,
    );
    if (root === null) {
      root = built.place(x);
      rec.state.set(root.id, 'new');
      rec.push(
        'build',
        ['return new Node<>(value)'],
        `El árbol está vacío: ${x} pasa a ser la raíz.`,
        columnOf(x),
      );
      continue;
    }
    let n: NumberNode = root;
    for (;;) {
      rec.path.push(n.id);
      rec.settle();
      rec.cost += 1;
      rec.state.set(n.id, 'active');
      const v = n.value;
      rec.push('compare', ['int c = value.compareTo'], `insert(${v}): se compara ${x} con ${v}.`);
      if (x === v) {
        rec.state.set(n.id, 'idle');
        rec.push('done', ['return node;'], `${x} ya está en el árbol: no se inserta un repetido.`);
        break;
      }
      rec.state.set(n.id, 'visited');
      const side = x < v ? 'left' : 'right';
      const where = side === 'left' ? 'la izquierda' : 'la derecha';
      const sign = x < v ? '<' : '>';
      const next: NumberNode | null = n[side];
      if (next === null) {
        const fresh = built.place(x);
        n[side] = fresh;
        rec.path.push(fresh.id);
        rec.settle();
        rec.state.set(fresh.id, 'new');
        rec.push(
          'build',
          ['return new Node<>(value)'],
          `${x} ${sign} ${v} y ${where} de ${v} es null: ${x} se cuelga ahí como hoja nueva.`,
          columnOf(x),
        );
        break;
      }
      rec.push(
        'walk',
        [side === 'left' ? 'node.left = insert' : 'node.right = insert'],
        `${x} ${sign} ${v}: por la invariante, ${x} va a ${where} de ${v}.`,
      );
      n = next;
    }
  }
  return finish(rec, code, columns, slots, true);
}

/**
 * The inorder strip of a search tree, read by NODE: each node writes its value
 * in its own column. By node rather than by value, because a removal copies a
 * successor's value into another node, and that node keeps its column.
 */
function stripByNode(
  rootOf: () => TreeNode | null,
  columns: Record<number, number>,
  slots: number,
): () => (TreeValue | null)[] {
  return () => {
    const out: (TreeValue | null)[] = Array.from({ length: slots }, () => null);
    for (const { node } of nodesOf(rootOf())) out[columns[node.id]!] = node.value;
    return out;
  };
}

function traceMinimum(values: number[]): SequenceTrace {
  if (values.length === 0) {
    throw new Error(
      'El árbol está vacío: min() lanza NoSuchElementException y no hay mínimo que mostrar.',
    );
  }
  const code = CODE.minimum;
  const columns: Record<number, number> = {};
  const { root } = bstOf(values, columnsFor(values), columns);
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [],
  );
  rec.push(
    'start',
    ['return minimum(root).value'],
    'El mínimo está en el nodo de más a la izquierda: por la invariante, todo lo que está a la derecha de un nodo es mayor que él.',
  );
  let n = root!;
  for (;;) {
    rec.path.push(n.id);
    rec.settle();
    rec.cost += 1;
    rec.badge.set(n.id, String(rec.cost));
    const v = n.value;
    if (n.left === null) {
      rec.state.set(n.id, 'found');
      rec.push(
        'found',
        ['if (node.left == null) return node'],
        `${v} no tiene hijo izquierdo: es el mínimo del árbol.`,
      );
      break;
    }
    rec.state.set(n.id, 'visited');
    discard(rec, n.right);
    rec.push(
      'walk',
      ['return minimum(node.left)'],
      `${v} tiene hijo izquierdo: por la invariante, todo lo menor que ${v} está a su izquierda, y su derecha se descarta.`,
    );
    n = n.left;
  }
  return finish(rec, code, columns, new Set(values).size, false);
}

function traceSuccessor(values: number[], targets: number[]): SequenceTrace {
  if (targets.length === 0) throw new Error('Falta el valor cuyo sucesor se busca.');
  requireRuns(targets.length);
  const code = CODE.successor;
  const columns: Record<number, number> = {};
  const { root } = bstOf(values, columnsFor(values), columns);
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [],
  );

  for (const x of targets) {
    rec.reset();
    rec.push(
      'start',
      ['Node<T> best = null'],
      `El sucesor de ${x} es el menor valor mayor que ${x}. Se baja una sola vez desde la raíz, guardando el mejor candidato.`,
    );
    let best: NumberNode | null = null;
    let n = root;
    while (n !== null) {
      rec.path.push(n.id);
      rec.settle();
      if (best !== null) rec.state.set(best.id, 'new');
      rec.cost += 1;
      rec.badge.set(n.id, String(rec.cost));
      const v = n.value;
      if (x < v) {
        if (best !== null) rec.state.set(best.id, 'visited');
        best = n;
        rec.state.set(n.id, 'new');
        discard(rec, n.right);
        rec.push(
          'walk',
          ['best = node;'],
          `${x} < ${v}: ${v} es mayor que ${x} y es el mejor candidato hasta ahora; uno mejor solo puede estar a su izquierda, y su derecha se descarta.`,
        );
        n = n.left;
      } else {
        discard(rec, n.left);
        rec.state.set(n.id, 'discarded');
        rec.push(
          'walk',
          ['node = node.right;'],
          `${x} ≥ ${v}: ${v} no es mayor que ${x}, así que el sucesor solo puede estar a su derecha; ${v} y su izquierda se descartan.`,
        );
        n = n.right;
      }
    }
    rec.settle();
    if (best !== null) {
      rec.state.set(best.id, 'found');
      rec.push('found', ['return best;'], `El sucesor de ${x} es ${best.value}.`);
    } else {
      rec.push('done', ['return best;'], `${x} no tiene sucesor: ningún valor del árbol es mayor.`);
    }
  }
  return finish(rec, code, columns, new Set(values).size, false);
}

function traceRemove(values: number[], targets: number[]): SequenceTrace {
  if (targets.length === 0) throw new Error('Falta el valor a eliminar.');
  requireRuns(targets.length);
  const code = CODE.remove;
  const columns: Record<number, number> = {};
  const slots = new Set(values).size;
  let { root } = bstOf(values, columnsFor(values), columns);
  // No strip: on a slide the listing, the tree and the narration already fill
  // the frame, and the sorted inorder is shown by insert and by the theorem.
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [],
  );

  const remove = (n: NumberNode | null, x: number): NumberNode | null => {
    if (n === null) {
      rec.push(
        'done',
        ['if (node == null) return null'],
        `${x} no está en el árbol: no se elimina nada.`,
      );
      return null;
    }
    rec.path.push(n.id);
    rec.settle();
    rec.cost += 1;
    rec.state.set(n.id, 'active');
    const v = n.value;
    rec.push('compare', ['int c = value.compareTo'], `remove(${v}): se compara ${x} con ${v}.`);
    if (x !== v) {
      rec.state.set(n.id, 'visited');
      const side = x < v ? 'left' : 'right';
      rec.push(
        'walk',
        [side === 'left' ? 'node.left = remove' : 'node.right = remove'],
        `${x} ${x < v ? '<' : '>'} ${v}: por la invariante, ${x} solo puede estar a ${side === 'left' ? 'la izquierda' : 'la derecha'} de ${v}.`,
      );
      n[side] = remove(n[side], x);
      rec.path.pop();
      return n;
    }
    if (n.left === null || n.right === null) {
      const child = n.left ?? n.right;
      rec.state.set(n.id, 'leaving');
      rec.push(
        'found',
        [n.left === null ? 'return node.right;' : 'return node.left;'],
        child === null
          ? `${x} es una hoja: se devuelve null, y su padre deja de apuntarle.`
          : `${x} tiene un solo hijo, ${child.value}: se devuelve ese hijo y el padre de ${x} pasa a apuntarle. Todo ese subárbol estaba del mismo lado, así que la invariante se mantiene.`,
      );
      rec.path.pop();
      return child;
    }
    rec.push(
      'walk',
      ['Node<T> next = node.right'],
      `${x} tiene dos hijos: se busca su sucesor, el menor valor de su subárbol derecho.`,
    );
    let next = n.right!;
    const below = rec.path.length;
    for (;;) {
      rec.path.push(next.id);
      if (next.left === null) break;
      rec.state.set(next.id, 'visited');
      next = next.left;
    }
    rec.state.set(next.id, 'swap');
    rec.badge.set(next.id, 'sucesor');
    rec.push(
      'found',
      ['while (next.left != null)'],
      `El sucesor de ${x} es ${next.value}: el menor de la derecha, sin hijo izquierdo.`,
    );
    rec.path.length = below;
    n.value = next.value;
    rec.state.set(n.id, 'new');
    rec.state.set(next.id, 'leaving');
    rec.push(
      'build',
      ['node.value = next.value'],
      `${x} toma el valor de su sucesor, ${next.value}. La invariante se mantiene: ${next.value} es mayor que todo lo de la izquierda y menor que todo lo demás de la derecha.`,
    );
    rec.badge.delete(next.id);
    rec.push(
      'walk',
      ['node.right = remove(node.right, next.value)'],
      `Queda borrar el sucesor de la derecha. No tiene hijo izquierdo, así que es el caso de una hoja o de un solo hijo.`,
    );
    n.right = remove(n.right, n.value);
    rec.path.pop();
    return n;
  };

  for (const x of targets) {
    rec.reset();
    rec.push('start', ['Node<T> remove('], `Eliminar ${x}: primero se busca, como en contains.`);
    const before = nodesOf(root).length;
    root = remove(root, x);
    if (nodesOf(root).length < before) {
      rec.settle();
      for (const [id, s] of rec.state) if (s === 'leaving') rec.state.delete(id);
      rec.push('done', [], `${x} ya no está en el árbol, y su inorden sigue ordenado.`);
    }
  }
  return finish(rec, code, columns, slots, false);
}
