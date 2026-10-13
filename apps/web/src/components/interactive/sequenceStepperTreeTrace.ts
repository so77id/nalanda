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
 * the height and a search that may have to look everywhere.
 */
import { asRuns, lineOf, requireRuns } from './sequenceStepperTraceShared';
import type {
  BinaryTreeOperation,
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
interface TreeNode<V extends TreeValue = TreeValue> {
  id: number;
  value: V;
  left: TreeNode<V> | null;
  right: TreeNode<V> | null;
}

type Traversal = Exclude<BinaryTreeOperation, 'height' | 'search'>;

/**
 * Each listing is the recursive method as the class writes it. The three
 * traversals differ in ONE line's position — where the visit sits among the
 * two calls — and that is the whole lesson of the three orders. The search
 * has no order to lean on, so it tries both sides: a preorder whose visit
 * compares, marked with the same two comments.
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
const nodeOf = <V extends TreeValue>(value: V): TreeNode<V> => ({
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
function nodesOf(root: TreeNode | null): { node: TreeNode; depth: number }[] {
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
 */
class TreeRecorder {
  readonly steps: SequenceStep[] = [];
  readonly state = new Map<number, SequenceCellState>();
  readonly badge = new Map<number, string>();
  readonly path: number[] = [];
  cost = 0;
  depth = 0;
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
    const nodes: TreeFrameNode[] = nodesOf(root).map(({ node: n, depth }) => {
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

/** The result every tree operation hands back, sized for the whole run. */
function finish(
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
