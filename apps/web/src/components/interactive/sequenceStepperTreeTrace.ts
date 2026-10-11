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
 * search-tree invariant, so its operations CHOOSE A SIDE at every node.
 */
import type {
  SequenceCell,
  SequenceCellState,
  SequenceInput,
  SequenceOperation,
  SequenceStep,
  SequenceStepKind,
  SequenceTrace,
  TreeFrame,
  TreeFrameNode,
} from './sequenceStepperTrace';

interface TreeNode {
  id: number;
  value: number;
  left: TreeNode | null;
  right: TreeNode | null;
}

type Traversal = 'preorder' | 'inorder' | 'postorder';

/**
 * Each listing is the recursive method as the class writes it. The three
 * traversals differ in ONE line's position — where the visit sits among the
 * two calls — and that is the whole lesson of the three orders. The two
 * searches share a signature and differ in what they do with a comparison:
 * try both sides, or let the invariant pick one.
 */
const CODE = {
  preorder: `void preorder(Node<T> node) {
    if (node == null) return;
    System.out.print(node.value + " ");
    preorder(node.left);
    preorder(node.right);
}`,
  inorder: `void inorder(Node<T> node) {
    if (node == null) return;
    inorder(node.left);
    System.out.print(node.value + " ");
    inorder(node.right);
}`,
  postorder: `void postorder(Node<T> node) {
    if (node == null) return;
    postorder(node.left);
    postorder(node.right);
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
    if (node.value.equals(target)) return true;
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
} as const;

/** The traversal's name in the narration. */
const TRAVERSAL_NAME: Record<Traversal, string> = {
  preorder: 'preorden',
  inorder: 'inorden',
  postorder: 'postorden',
};

/** A height in the narration: the minus sign, not a hyphen. */
const signed = (n: number): string => (n < 0 ? `−${-n}` : String(n));

/** The 1-based line of the first line containing `fragment` — never a number. */
function lineOf(code: string, fragment: string): number {
  const at = code.split('\n').findIndex((line) => line.includes(fragment));
  if (at < 0) throw new Error(`El listado no contiene «${fragment}».`);
  return at + 1;
}

const asRuns = (v: number | number[] | undefined): number[] =>
  v === undefined ? [] : Array.isArray(v) ? v : [v];

let nextId = 0;
const nodeOf = (value: number): TreeNode => ({
  id: (nextId += 1),
  value,
  left: null,
  right: null,
});

/**
 * The tree an author writes in level order, `null` where a child is missing:
 * `[3, 9, 1, 4, 7, null, 6]` is 3 over 9 and 1, 9 over 4 and 7, and 1 over a
 * lone right child 6. Every value has to have a parent to hang from.
 */
function fromLevelOrder(levels: (number | null)[]): TreeNode {
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
        `El valor ${orphan} no tiene padre: en el orden por niveles cae bajo un hueco.`,
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

/** Every node, root first, each before its children (the order frames list them). */
function nodesOf(root: TreeNode | null): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (n: TreeNode | null) => {
    if (n === null) return;
    out.push(n);
    walk(n.left);
    walk(n.right);
  };
  walk(root);
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

function deepest(root: TreeNode | null): number {
  if (root === null) return 0;
  const below = (n: TreeNode | null): number =>
    n === null ? -1 : 1 + Math.max(below(n.left), below(n.right));
  return below(root);
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
  private readonly stripOf: () => (number | null)[];

  constructor(code: string, rootOf: () => TreeNode | null, stripOf: () => (number | null)[]) {
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

  push(kind: SequenceStepKind, fragments: string[], description: string, stripFresh?: number) {
    const root = this.rootOf();
    this.depth = Math.max(this.depth, deepest(root));
    const nodes: TreeFrameNode[] = nodesOf(root).map((n) => {
      const out: TreeFrameNode = {
        id: n.id,
        value: n.value,
        left: n.left?.id ?? null,
        right: n.right?.id ?? null,
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
    const cells: SequenceCell[] = nodes.map((n) => ({ id: n.id, value: n.value, state: n.state }));
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

export function traceTree(
  recipe: 'binary-tree' | 'bst',
  operation: SequenceOperation,
  input: SequenceInput,
): SequenceTrace {
  if (recipe === 'binary-tree') {
    const root = fromLevelOrder(input.levelOrder ?? input.values);
    if (operation === 'height') return traceHeight(root);
    if (operation === 'search') return traceSearchAnywhere(root, asRuns(input.target));
    return traceTraversal(root, operation as Traversal);
  }
  const repeated = input.values.find((v, i) => input.values.indexOf(v) !== i);
  if (repeated !== undefined) {
    throw new Error(
      `El valor ${repeated} está repetido: un árbol de búsqueda no guarda dos veces el mismo valor.`,
    );
  }
  if (operation === 'search') return traceSearchOrdered(input.values, asRuns(input.target));
  return traceInsert(input.values, asRuns(input.value));
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
  const strip: (number | null)[] = Array.from({ length: slots }, () => null);
  const rec = new TreeRecorder(
    code,
    () => root,
    () => [...strip],
  );
  let written = 0;

  const enter = (n: TreeNode, description: string, fragment: string) => {
    rec.settle();
    rec.state.set(n.id, 'active');
    rec.push('walk', [fragment], description);
  };

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

  const hasChildren = (n: TreeNode) => n.left !== null || n.right !== null;

  const visit = (n: TreeNode) => {
    rec.path.push(n.id);
    const v = n.value;
    if (traversal === 'preorder') {
      write(n, `preorder(${v}): se visita ${v} antes que sus hijos.`);
      if (n.left !== null) visit(n.left);
      if (n.right !== null) visit(n.right);
    } else if (traversal === 'inorder') {
      if (n.left !== null) {
        enter(
          n,
          `inorder(${v}): antes de visitar ${v} se recorre su izquierda.`,
          'inorder(node.left)',
        );
        visit(n.left);
        write(n, `inorder(${v}): su izquierda ya se recorrió; se visita ${v}.`);
      } else {
        write(n, `inorder(${v}): su izquierda es null; se visita ${v}.`);
      }
      if (n.right !== null) visit(n.right);
    } else if (hasChildren(n)) {
      enter(n, `postorder(${v}): ${v} se visita después de sus dos lados.`, 'postorder(node.left)');
      if (n.left !== null) visit(n.left);
      if (n.right !== null) visit(n.right);
      write(n, `postorder(${v}): sus dos lados ya se recorrieron; se visita ${v}.`);
    } else {
      write(n, `postorder(${v}): no tiene hijos; se visita ${v}.`);
    }
    rec.path.pop();
  };

  rec.push('start', [`void ${traversal}(`], `El ${name} empieza por la raíz, ${root.value}.`);
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

  const height = (n: TreeNode): number => {
    rec.path.push(n.id);
    const v = n.value;
    let h: number;
    if (n.left === null && n.right === null) {
      h = 0;
      answer(
        n,
        h,
        `height(${v}): sus dos lados son null y devuelven ${signed(-1)}; devuelve 1 + max(${signed(-1)}, ${signed(-1)}) = 0.`,
      );
    } else {
      rec.settle();
      rec.state.set(n.id, 'active');
      rec.push(
        'walk',
        ['int left = height'],
        `height(${v}): antes de responder, pide la altura de sus dos lados.`,
      );
      const left = n.left === null ? -1 : height(n.left);
      const right = n.right === null ? -1 : height(n.right);
      h = 1 + Math.max(left, right);
      answer(
        n,
        h,
        `height(${v}): la izquierda devolvió ${signed(left)} y la derecha ${signed(right)}; devuelve 1 + max(${signed(left)}, ${signed(right)}) = ${h}.`,
      );
    }
    rec.path.pop();
    return h;
  };

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
    const search = (n: TreeNode): boolean => {
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
      const hit = (n.left !== null && search(n.left)) || (n.right !== null && search(n.right));
      rec.path.pop();
      return hit;
    };
    const found = search(root);
    rec.settle();
    rec.push(
      'done',
      [],
      found
        ? `${t} está en el árbol: apareció en la comparación ${rec.cost}.`
        : `${t} no está: se compararon los ${rec.cost} nodos, uno por uno.`,
    );
  }
  return finish(rec, code, columns, slots, false);
}

// ── bst: built by inserting, and every operation chooses a side ───────────

/** Inserts with no frames: the tree a `bst` slide starts from. */
function bstOf(values: number[], columnOf: (v: number) => number, columns: Record<number, number>) {
  let root: TreeNode | null = null;
  const place = (v: number): TreeNode => {
    const fresh = nodeOf(v);
    columns[fresh.id] = columnOf(v);
    return fresh;
  };
  for (const v of values) {
    if (root === null) {
      root = place(v);
      continue;
    }
    let n: TreeNode = root;
    for (;;) {
      const side = v < n.value ? 'left' : 'right';
      const next: TreeNode | null = n[side];
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
function columnsFor(values: number[]): (v: number) => number {
  const sorted = [...new Set(values)].sort((a, b) => a - b);
  return (v) => sorted.indexOf(v);
}

/** Marks a whole subtree as ruled out. */
function discard(rec: TreeRecorder, n: TreeNode | null): void {
  for (const m of nodesOf(n)) rec.state.set(m.id, 'discarded');
}

function traceSearchOrdered(values: number[], targets: number[]): SequenceTrace {
  if (targets.length === 0) throw new Error('Falta el valor a buscar.');
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
  const code = CODE.insert;
  const everything = [...values, ...inserts];
  const columnOf = columnsFor(everything);
  const slots = new Set(everything).size;
  const columns: Record<number, number> = {};
  const built = bstOf(values, columnOf, columns);
  let root = built.root;
  const strip = (): (number | null)[] => {
    const out: (number | null)[] = Array.from({ length: slots }, () => null);
    for (const n of nodesOf(root)) out[columnOf(n.value)] = n.value;
    return out;
  };
  const rec = new TreeRecorder(code, () => root, strip);

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
    let n: TreeNode = root;
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
      const next: TreeNode | null = n[side];
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
