/**
 * Pure traces for the `avl` recipe of `<SequenceStepper>` (#322), the AVL
 * tree: a search tree that keeps its shape. Same contract as the other tree
 * recipes (`sequenceStepperTreeTrace.ts`, whose pieces it builds on): a frame
 * list and the Java listing those frames light lines of, so the suite pins
 * every frame and the browser is left only "does it look right".
 *
 * The rotation comes first, on its own, the way the class teaches it: a tool
 * that changes three references and keeps the inorder, before anything says
 * when to use it. Its `values` therefore build a PLAIN search tree, by
 * inserting in that order with no rebalancing, so a slide can rotate a tree
 * that leans.
 *
 * One assignment per frame. Between `p.left = q.right` and the caller taking
 * `q`, the tree is not a tree: a subtree has two parents, or `q` points back
 * up at `p` while nobody points at `q`. Those frames are drawn as they are —
 * every node at the level it had, the one only `q` holds included — and the
 * tree settles in the frame where the caller takes `q`.
 *
 * Then `insert` and `remove`, whose `values` build a real AVL (inserted in
 * order, rotating as they go, with no frames): the search tree's walk down,
 * and `balance` on every node of the way back, its factor written beside each
 * node. A rotation inside them is one frame — the rotation act already showed
 * its three assignments.
 */
import { asRuns, lineOf, requireRuns } from './sequenceStepperTraceShared';
import type {
  AvlOperation,
  SequenceInput,
  SequenceStep,
  SequenceTrace,
  TreeValue,
} from './sequenceStepperTrace';
import {
  TreeRecorder,
  bstOf,
  columnsFor,
  finish,
  nodeOf,
  nodesOf,
  type NumberNode,
  type TreeNode,
} from './sequenceStepperTreeTrace';

type Side = 'left' | 'right';

/**
 * The class's rotations, before the AVL gives its nodes a height; and its
 * insert and remove, the search tree's with `return balance(node)` as their
 * last line. `balance` itself is not in these listings: it is the second
 * listing of the row beside them (`BALANCE`, `trace.row`), lit frame by frame
 * as the walk back calls it.
 */
const CODE: Record<AvlOperation, string> = {
  'rotate-right': `Node<T> rotateRight(Node<T> p) {
    Node<T> q = p.left;
    p.left = q.right;
    q.right = p;
    return q;
}`,
  'rotate-left': `Node<T> rotateLeft(Node<T> p) {
    Node<T> q = p.right;
    p.right = q.left;
    q.left = p;
    return q;
}`,
  'rotate-left-right': `Node<T> rotateLeftRight(Node<T> p) {
    p.left = rotateLeft(p.left);
    return rotateRight(p);
}`,
  'rotate-right-left': `Node<T> rotateRightLeft(Node<T> p) {
    p.right = rotateRight(p.right);
    return rotateLeft(p);
}`,
  // The search tree's, the public method over the private one, with
  // `return balance(node)` for the private one's last line (#322).
  insert: `public void insert(T value) {
    root = insert(root, value);
}

private Node<T> insert(Node<T> node, T value) {
    if (node == null) return new Node<>(value);
    int c = value.compareTo(node.value);
    if (c < 0) {
        node.left = insert(node.left, value);
    } else if (c > 0) {
        node.right = insert(node.right, value);
    }
    return balance(node);
}`,
  // The search tree's lines without their comments: beside balance, in half
  // a slide or two fifths of it, a commented line does not fit (#322).
  remove: `public void remove(T value) {
    root = remove(root, value);
}

private Node<T> remove(Node<T> node, T value) {
    if (node == null) return null;
    int c = value.compareTo(node.value);
    if (c < 0) node.left = remove(node.left, value);
    else if (c > 0) node.right = remove(node.right, value);
    else if (node.left == null) return node.right;
    else if (node.right == null) return node.left;
    else {
        Node<T> next = node.right;
        while (next.left != null) next = next.left;
        node.value = next.value;
        node.right = remove(node.right, next.value);
    }
    return balance(node);
}`,
};

/**
 * `balance`, as the class writes it, listed beside `insert` so its lines are
 * lit as the walk back runs it (Miguel's review: the insertion with balance
 * beside it, step by step). The two double rotations' returns go on a line
 * of their own, so three listings fit side by side on a slide.
 */
const BALANCE = `Node<T> balance(Node<T> node) {
    updateHeight(node);
    int b = factor(node);
    if (b < -1) {
        if (factor(node.left) > 0)
            return rotateLeftRight(node);
        return rotateRight(node);
    }
    if (b > 1) {
        if (factor(node.right) < 0)
            return rotateRightLeft(node);
        return rotateLeft(node);
    }
    return node;
}`;

/** A child in the narration. */
const CHILD: Record<Side, string> = { left: 'hijo izquierdo', right: 'hijo derecho' };
const OTHER: Record<Side, Side> = { left: 'right', right: 'left' };

/** The height of a subtree, the empty one's −1. */
function heightOf(n: TreeNode | null): number {
  return n === null ? -1 : 1 + Math.max(heightOf(n.left), heightOf(n.right));
}

/**
 * The inorder of a subtree, read from its links. The narration says it after a
 * rotation from here, not from the strip: the strip writes each value in its
 * own column and reads sorted whatever the links are.
 */
function inorderOf(n: TreeNode | null, out: TreeValue[] = []): TreeValue[] {
  if (n === null) return out;
  inorderOf(n.left, out);
  out.push(n.value);
  inorderOf(n.right, out);
  return out;
}

/** A height in the narration: a number, with a true minus for the empty tree's. */
const heightText = (h: number): string => (h < 0 ? `−${-h}` : String(h));

/** The node holding `value` and its parent, found by the search the invariant allows. */
function locate(
  root: NumberNode | null,
  value: number,
): { node: NumberNode; parent: NumberNode | null } | null {
  let parent: NumberNode | null = null;
  let n = root;
  while (n !== null && n.value !== value) {
    parent = n;
    n = value < n.value ? n.left : n.right;
  }
  return n === null ? null : { node: n, parent };
}

/** The values of a tree in inorder, root and loose nodes alike, by column. */
function stripOf(
  nodes: () => (TreeNode | null)[],
  columns: Record<number, number>,
  slots: number,
): () => (TreeValue | null)[] {
  return () => {
    const out: (TreeValue | null)[] = Array.from({ length: slots }, () => null);
    for (const start of nodes()) {
      for (const { node } of nodesOf(start)) out[columns[node.id]!] = node.value;
    }
    return out;
  };
}

export function traceAvl(operation: AvlOperation, input: SequenceInput): SequenceTrace {
  const repeated = input.values.find((v, i) => input.values.indexOf(v) !== i);
  if (repeated !== undefined) {
    throw new Error(
      `El valor ${repeated} está repetido: un árbol de búsqueda no guarda dos veces el mismo valor.`,
    );
  }
  if (operation === 'insert' && input.program === true) {
    return traceAvlInsertProgram(input.values, asRuns(input.value));
  }
  if (operation === 'insert') return traceAvlInsert(input);
  if (operation === 'remove' && input.program === true) {
    return traceAvlRemoveProgram(input.values, asRuns(input.target));
  }
  if (operation === 'remove') return traceAvlRemove(input);
  if (operation === 'rotate-left-right') return traceDouble('right', input);
  if (operation === 'rotate-right-left') return traceDouble('left', input);
  return traceRotation(operation === 'rotate-right' ? 'right' : 'left', input);
}

// ── the rotation, on its own ──────────────────────────────────────────────

function traceRotation(direction: Side, input: SequenceInput): SequenceTrace {
  const operation: AvlOperation = direction === 'right' ? 'rotate-right' : 'rotate-left';
  const targets = asRuns(input.target);
  if (targets.length === 0) throw new Error('Falta el valor del nodo a rotar.');
  requireRuns(targets.length);
  const code = CODE[operation];
  const method = direction === 'right' ? 'rotateRight' : 'rotateLeft';
  // Rotating right raises the LEFT child: `inner` is the side q comes from,
  // `outer` the side p goes to under q.
  const inner: Side = direction === 'right' ? 'left' : 'right';
  const outer = OTHER[inner];
  const columns: Record<number, number> = {};
  const slots = new Set(input.values).size;
  let { root } = bstOf(input.values, columnsFor(input.values), columns);
  // Annotated: the strip reads the recorder's own loose nodes, lazily.
  const rec: TreeRecorder = new TreeRecorder(
    code,
    () => root,
    stripOf(() => [root, ...rec.loose], columns, slots),
  );

  for (const t of targets) {
    rec.reset();
    const found = locate(root, t);
    if (found === null)
      throw new Error(`El valor ${t} no está en el árbol: no hay nodo que rotar.`);
    const { node: p, parent } = found;
    const q = p[inner];
    if (q === null) {
      throw new Error(
        `${t} no tiene ${CHILD[inner]}: rotar a la ${direction === 'right' ? 'derecha' : 'izquierda'} en ${t} necesita un ${CHILD[inner]} que suba a su lugar.`,
      );
    }
    const P = p.value;
    const Q = q.value;
    const before = heightOf(root);

    rec.state.set(p.id, 'swap');
    rec.badge.set(p.id, 'p');
    rec.push(
      'start',
      [`Node<T> ${method}(`],
      `Rotar a la ${direction === 'right' ? 'derecha' : 'izquierda'} en ${P}: su ${CHILD[inner]}, ${Q}, sube a su lugar, y ${P} baja a ser su ${CHILD[outer]}.`,
    );

    // From here to `return q` the method changes links, not places.
    rec.frozen = true;
    rec.state.set(q.id, 'swap');
    rec.badge.set(q.id, 'q');
    rec.push('walk', [`Node<T> q = p.${inner};`], `q apunta al ${CHILD[inner]} de p, ${Q}.`);

    const b = q[outer];
    p[inner] = b;
    rec.loose.push(q);
    rec.cost += 1;
    if (b !== null) rec.state.set(b.id, 'new');
    rec.push(
      'link',
      [`p.${inner} = q.${outer};`],
      b === null
        ? `${Q} no tiene ${CHILD[outer]}: el ${CHILD[inner]} de ${P} queda en null.`
        : `El ${CHILD[outer]} de ${Q}, ${b.value}, pasa a ser el ${CHILD[inner]} de ${P}. Todo ese subárbol es ${direction === 'right' ? `mayor que ${Q} y menor que ${P}` : `menor que ${Q} y mayor que ${P}`}, así que la invariante de orden se mantiene.`,
    );

    if (b !== null) rec.state.delete(b.id);
    q[outer] = p;
    rec.cost += 1;
    rec.push(
      'link',
      [`q.${outer} = p;`],
      `${P} pasa a ser el ${CHILD[outer]} de ${Q}. Por ahora nadie apunta a ${Q}: solo la variable q lo sostiene.`,
    );

    if (parent === null) root = q;
    else parent[parent.left === p ? 'left' : 'right'] = q;
    rec.loose.length = 0;
    rec.frozen = false;
    rec.cost += 1;
    rec.push(
      'link',
      ['return q;'],
      parent === null
        ? `${method} devuelve ${Q}, y quien llamó lo guarda donde estaba ${P}: ${Q} es la raíz nueva. ${Q} sube un nivel y ${P} baja uno.`
        : `${method} devuelve ${Q}, y quien llamó lo guarda donde estaba ${P}: ${Q} pasa a ser el ${CHILD[parent.left === q ? 'left' : 'right']} de ${parent.value}. ${Q} sube un nivel y ${P} baja uno.`,
    );

    rec.state.clear();
    rec.badge.clear();
    const after = heightOf(root);
    const inorder = inorderOf(root).join(' ');
    rec.push(
      'done',
      [],
      `El inorden sigue siendo ${inorder}: la rotación cambió tres referencias y la invariante de orden se mantiene. ${
        after === before
          ? `La altura del árbol sigue siendo ${after}.`
          : `La altura del árbol pasó de ${before} a ${after}.`
      }`,
    );
  }
  return finish(rec, code, columns, slots, true);
}

// ── the double rotation: two simple ones, each walked an assignment at a time ─

/**
 * A double rotation as its method writes it (#322): two calls, the child
 * first and then the node. The two simple rotations are listed under it,
 * the left one beside the right one, and each call is walked inside its own
 * listing an assignment at a time — the call that runs it lit above the
 * whole time — so the reader follows the six references one by one
 * (Miguel's review: with a frame per call "the steps get lost"). The names
 * on the drawing are the running method's: inside a call, `p` and `q` are
 * that call's. Between an assignment and the return the tree is drawn as it
 * is, levels held, exactly as the simple rotation's own widget draws it.
 * `direction` is the side the node goes down to: `right` is the left-right
 * rotation, for a node that leans left whose left child leans right.
 */
function traceDouble(direction: Side, input: SequenceInput): SequenceTrace {
  const operation: AvlOperation = direction === 'right' ? 'rotate-left-right' : 'rotate-right-left';
  const targets = asRuns(input.target);
  if (targets.length === 0) throw new Error('Falta el valor del nodo a rotar.');
  requireRuns(targets.length);
  const code = CODE[operation];
  const method = direction === 'right' ? 'rotateLeftRight' : 'rotateRightLeft';
  const name = `rotación doble a la ${direction === 'right' ? 'derecha' : 'izquierda'}`;
  // Listed left beside right, whichever runs first.
  const callees = [
    { name: 'rotación a la izquierda', code: CODE['rotate-left'] },
    { name: 'rotación a la derecha', code: CODE['rotate-right'] },
  ];
  const calleeOf: Record<Side, number> = { left: 0, right: 1 };
  // `inner` is the side q hangs on under p; r is q's child on the OTHER side,
  // the weight inside, the node the double brings to the top.
  const inner: Side = direction === 'right' ? 'left' : 'right';
  const outer = OTHER[inner];
  const columns: Record<number, number> = {};
  const slots = new Set(input.values).size;
  let { root } = bstOf(input.values, columnsFor(input.values), columns);
  const rec: TreeRecorder = new TreeRecorder(
    code,
    () => root,
    stripOf(() => [root, ...rec.loose], columns, slots),
  );
  /** Pushes a frame lighting `main` above and `inside` in one callee, or none. */
  const frame = (
    kind: Parameters<TreeRecorder['push']>[0],
    main: string | null,
    inside: { side: Side; fragment: string } | null,
    said: string,
  ) => {
    rec.push(kind, main === null ? [] : [main], said);
    const step = rec.steps.at(-1)!;
    step.calleeLines = callees.map((c, i) =>
      inside !== null && calleeOf[inside.side] === i ? [lineOf(c.code, inside.fragment)] : [],
    );
  };

  /**
   * One simple rotation, walked inside its listing: `up` is the side its q
   * comes from, `call` the line of the double that runs it, `hang` where the
   * caller keeps what it returns.
   */
  const walk = (
    p: NumberNode,
    up: Side,
    call: string,
    hang: (q: NumberNode) => string,
  ): NumberNode => {
    const down = OTHER[up];
    const turn = down === 'right' ? 'rotateRight' : 'rotateLeft';
    // The listing it runs in: rotateLeft's or rotateRight's.
    const side = down;
    rec.state.clear();
    rec.badge.clear();
    rec.state.set(p.id, 'swap');
    rec.badge.set(p.id, 'p');
    frame(
      'walk',
      call,
      { side, fragment: `Node<T> ${turn}(` },
      `Se llama a ${turn} con ${p.value}: dentro, p es ${p.value}.`,
    );
    rec.frozen = true;
    const q = p[up]!;
    rec.state.set(q.id, 'swap');
    rec.badge.set(q.id, 'q');
    frame(
      'walk',
      call,
      { side, fragment: `Node<T> q = p.${up};` },
      `q apunta al ${CHILD[up]} de p, ${q.value}.`,
    );
    const b = q[down];
    p[up] = b;
    rec.loose.push(q);
    rec.cost += 1;
    if (b !== null) rec.state.set(b.id, 'new');
    frame(
      'link',
      call,
      { side, fragment: `p.${up} = q.${down};` },
      b === null
        ? `${q.value} no tiene ${CHILD[down]}: el ${CHILD[up]} de ${p.value} queda en null.`
        : `El ${CHILD[down]} de ${q.value}, ${b.value}, pasa a ser el ${CHILD[up]} de ${p.value}.`,
    );
    if (b !== null) rec.state.delete(b.id);
    q[down] = p;
    rec.cost += 1;
    frame(
      'link',
      call,
      { side, fragment: `q.${down} = p;` },
      `${p.value} pasa a ser el ${CHILD[down]} de ${q.value}. Por ahora solo la variable q sostiene a ${q.value}.`,
    );
    const where = hang(q);
    rec.loose.length = 0;
    rec.frozen = false;
    rec.cost += 1;
    frame(
      'link',
      call,
      { side, fragment: 'return q;' },
      `${turn} devuelve ${q.value}, ${where}. ${q.value} sube un nivel y ${p.value} baja uno.`,
    );
    return q;
  };

  for (const t of targets) {
    rec.reset();
    const found = locate(root, t);
    if (found === null)
      throw new Error(`El valor ${t} no está en el árbol: no hay nodo que rotar.`);
    const { node: p, parent } = found;
    const q = p[inner];
    if (q === null) {
      throw new Error(
        `${t} no tiene ${CHILD[inner]}: la ${name} en ${t} sube al ${CHILD[outer]} de su ${CHILD[inner]}, y no lo hay.`,
      );
    }
    const r = q[outer];
    if (r === null) {
      throw new Error(
        `El ${CHILD[inner]} de ${t}, ${q.value}, no tiene ${CHILD[outer]}: la ${name} sube a ese nodo, el de adentro, y no lo hay.`,
      );
    }
    const before = heightOf(root);
    const firstWay = direction === 'right' ? 'izquierda' : 'derecha';
    const secondWay = direction === 'right' ? 'derecha' : 'izquierda';
    const firstCall = `p.${inner} = rotate`;
    const secondCall = 'return rotate';

    rec.state.set(p.id, 'swap');
    rec.badge.set(p.id, 'p');
    frame(
      'start',
      `Node<T> ${method}(`,
      null,
      `${name[0]!.toUpperCase()}${name.slice(1)} en ${p.value}: el peso está por dentro, en ${r.value}, el ${CHILD[outer]} de su ${CHILD[inner]}, ${q.value}. Primero se rota a la ${firstWay} en ${q.value}, y después a la ${secondWay} en ${p.value}.`,
    );

    // The child first: r rises into q's place, and p keeps it.
    walk(q, outer, firstCall, (top) => {
      p[inner] = top;
      return `y p.${inner} lo guarda: ${top.value} pasa a ser el ${CHILD[inner]} de ${p.value}, y el peso queda por fuera`;
    });

    // Then the node: r rises into p's place, kept by whoever called.
    walk(p, inner, secondCall, (top) => {
      if (parent === null) root = top;
      else parent[parent.left === p ? 'left' : 'right'] = top;
      return `y ${method} lo devuelve a quien llamó, que lo guarda donde estaba ${p.value}${
        parent === null ? `: ${top.value} es la raíz nueva` : ''
      }`;
    });

    rec.state.clear();
    rec.badge.clear();
    const after = heightOf(root);
    const inorder = inorderOf(root).join(' ');
    frame(
      'done',
      null,
      null,
      `El inorden sigue siendo ${inorder}: las dos rotaciones conservan la invariante de orden. ${
        after === before
          ? `La altura del árbol sigue siendo ${after}.`
          : `La altura del árbol pasó de ${before} a ${after}.`
      }`,
    );
  }
  return { ...finish(rec, code, columns, slots, true), callees };
}

// ── insert and remove: the search tree's, with balance on the way back ───

/**
 * The AVL as its class writes it: each node keeps its height (a leaf's 0, the
 * empty tree's −1), and `balance` reads the factor off its children's.
 */
interface Avl {
  root: NumberNode | null;
  height: Map<number, number>;
}

const heightIn = (avl: Avl, n: TreeNode | null): number =>
  n === null ? -1 : avl.height.get(n.id)!;

function updateHeight(avl: Avl, n: TreeNode): void {
  avl.height.set(n.id, 1 + Math.max(heightIn(avl, n.left), heightIn(avl, n.right)));
}

/** The balance factor, right height − left height, from the heights stored. */
const factorIn = (avl: Avl, n: TreeNode): number => heightIn(avl, n.right) - heightIn(avl, n.left);

/** A factor as the drawing and the narration write it: `+1`, `0`, `−2`. */
const signedFactor = (f: number): string => (f > 0 ? `+${f}` : f < 0 ? `−${-f}` : '0');

/** A rotation with no frames: raises `p`'s child on `inner`, updates both heights. */
function rotate(avl: Avl, p: NumberNode, inner: Side): NumberNode {
  const q = p[inner]!;
  p[inner] = q[OTHER[inner]];
  q[OTHER[inner]] = p;
  updateHeight(avl, p);
  updateHeight(avl, q);
  return q;
}

/** `balance` with no frames, for the tree a slide starts from. */
function balanceQuietly(avl: Avl, n: NumberNode): NumberNode {
  updateHeight(avl, n);
  const b = factorIn(avl, n);
  if (Math.abs(b) <= 1) return n;
  const heavy: Side = b < 0 ? 'left' : 'right';
  const child = n[heavy]!;
  if (factorIn(avl, child) * b < 0) n[heavy] = rotate(avl, child, OTHER[heavy]);
  return rotate(avl, n, heavy);
}

/** Builds the AVL a slide starts from by inserting `values` in order, rotating as it goes. */
function avlOf(
  values: number[],
  columnOf: (v: number) => number,
  columns: Record<number, number>,
): { avl: Avl; place: (v: number) => NumberNode } {
  const avl: Avl = { root: null, height: new Map() };
  const place = (v: number): NumberNode => {
    const fresh = nodeOf(v);
    columns[fresh.id] = columnOf(v);
    avl.height.set(fresh.id, 0);
    return fresh;
  };
  const insert = (n: NumberNode | null, v: number): NumberNode => {
    if (n === null) return place(v);
    if (v < n.value) n.left = insert(n.left, v);
    else if (v > n.value) n.right = insert(n.right, v);
    return balanceQuietly(avl, n);
  };
  for (const v of values) avl.root = insert(avl.root, v);
  return { avl, place };
}

/** The rotation that fixes a node heavy on `heavy`, by the class's names. */
const rotationName = (heavy: Side, double: boolean): string =>
  `${double ? 'doble' : 'simple'} a la ${heavy === 'left' ? 'derecha' : 'izquierda'}`;

/**
 * The recorder of an insert or a remove: it writes every node's balance
 * factor beside it before each frame — read off the heights the nodes STORE,
 * as `balance` reads them, so a factor above the node being balanced may
 * still be the old one, and changes when the walk back reaches it.
 */
function avlRecorder(code: string, avl: Avl, strip: () => (TreeValue | null)[]) {
  const rec = new TreeRecorder(code, () => avl.root, strip);
  // A name a frame gives a node instead of its factor: the successor's.
  const names = new Map<number, string>();
  const push = (...args: Parameters<TreeRecorder['push']>) => {
    rec.badge.clear();
    for (const { node } of nodesOf(avl.root))
      rec.badge.set(node.id, signedFactor(factorIn(avl, node)));
    for (const [id, name] of names) rec.badge.set(id, name);
    rec.push(...args);
  };
  return { rec, push, names };
}

/**
 * `balance(node)` frame by frame, and the caller taking what it returns:
 * `relink` puts the subtree's new root where the old one hung, at once, so the
 * drawing never shows a tree the code no longer holds.
 */
function balanceFramed(
  avl: Avl,
  rec: TreeRecorder,
  push: (...args: Parameters<TreeRecorder['push']>) => void,
  n: NumberNode,
  relink: (c: NumberNode) => void,
  inBalance: Map<SequenceStep, number[]> = new Map(),
): NumberNode {
  // What the frame just pushed lights in `balance`'s own listing.
  const light = (...fragments: string[]) =>
    inBalance.set(
      rec.steps.at(-1)!,
      fragments.map((f) => lineOf(BALANCE, f)),
    );
  updateHeight(avl, n);
  const b = factorIn(avl, n);
  const v = n.value;
  const hl = heightIn(avl, n.left);
  const hr = heightIn(avl, n.right);
  const measured = `balance(${v}): su altura queda en ${heightIn(avl, n)}; su factor es ${heightText(hr)} − ${heightText(hl)} = ${signedFactor(b)}`;
  // Every frame of balance lights its call: its own lines are on the slide.
  const call = ['return balance(node);'];
  rec.cost += 1;
  rec.state.set(n.id, 'active');
  if (Math.abs(b) <= 1) {
    push('compare', call, `${measured}: la invariante de balance se cumple.`);
    light('updateHeight(node);', 'int b = factor(node);', 'return node;');
    rec.state.delete(n.id);
    return n;
  }
  push('compare', call, `${measured}: la invariante de balance se rompe en ${v}.`);
  light('updateHeight(node);', 'int b = factor(node);', b < 0 ? 'if (b < -1) {' : 'if (b > 1) {');
  const heavy: Side = b < 0 ? 'left' : 'right';
  const where = heavy === 'left' ? 'izquierda' : 'derecha';
  const child = n[heavy]!;
  const cf = factorIn(avl, child);
  const double = cf * b < 0;
  push(
    'compare',
    call,
    `${v} está cargado a la ${where}, y su ${CHILD[heavy]}, ${child.value}, tiene factor ${signedFactor(cf)}: ${
      cf === 0
        ? 'no está cargado hacia ningún lado, y basta una sola rotación'
        : double
          ? 'está cargado hacia el lado contrario'
          : 'está cargado hacia el mismo lado'
    }. Toca una rotación ${rotationName(heavy, double)}.`,
  );
  light(heavy === 'left' ? 'if (factor(node.left) > 0)' : 'if (factor(node.right) < 0)');
  const rotation = double
    ? heavy === 'left'
      ? 'return rotateLeftRight(node);'
      : 'return rotateRightLeft(node);'
    : heavy === 'left'
      ? 'return rotateRight(node);'
      : 'return rotateLeft(node);';
  if (double) {
    const raised = rotate(avl, child, OTHER[heavy]);
    n[heavy] = raised;
    rec.state.set(child.id, 'swap');
    rec.state.set(raised.id, 'swap');
    push(
      'link',
      call,
      `Primero ${heavy === 'left' ? 'rotateLeft' : 'rotateRight'}(${child.value}): ${raised.value} sube y ${child.value} baja. Ahora ${v} queda cargado a la ${where} por el mismo lado.`,
    );
    light(rotation);
    rec.state.delete(child.id);
    rec.state.delete(raised.id);
  }
  const q = rotate(avl, n, heavy);
  relink(q);
  const at = rec.path.lastIndexOf(n.id);
  if (at >= 0) rec.path[at] = q.id;
  rec.state.set(n.id, 'swap');
  rec.state.set(q.id, 'swap');
  push(
    'link',
    call,
    `${double ? 'Después' : 'Rotación ' + rotationName(heavy, false) + ':'} ${heavy === 'left' ? 'rotateRight' : 'rotateLeft'}(${v}): ${q.value} sube a su lugar y ${v} baja. Las alturas de los dos se actualizan, y ${q.value} queda con factor ${signedFactor(factorIn(avl, q))}.`,
  );
  light(rotation);
  rec.state.delete(n.id);
  rec.state.delete(q.id);
  return q;
}

/** The side a value goes to from a node, in the narration. */
const toward = (side: Side) => (side === 'left' ? 'la izquierda' : 'la derecha');

function traceAvlInsert(input: SequenceInput): SequenceTrace {
  const inserts = asRuns(input.value);
  if (inserts.length === 0) throw new Error('Falta el valor a insertar.');
  requireRuns(inserts.length);
  const code = CODE.insert;
  const everything = [...input.values, ...inserts];
  const columnOf = columnsFor(everything);
  const slots = new Set(everything).size;
  const columns: Record<number, number> = {};
  const { avl, place } = avlOf(input.values, columnOf, columns);
  const { rec, push } = avlRecorder(
    code,
    avl,
    stripOf(() => [avl.root], columns, slots),
  );
  const inBalance = new Map<SequenceStep, number[]>();

  for (const x of inserts) {
    rec.reset();
    push(
      'start',
      ['root = insert(root, value)'],
      `Insertar ${x}: se baja como en el árbol de búsqueda, y al volver cada nodo del camino se rebalancea.`,
    );
    let repeated = false;
    const insert = (
      n: NumberNode | null,
      relink: (c: NumberNode) => void,
      from: { parent: NumberNode; side: Side } | null,
    ): NumberNode => {
      if (n === null) {
        const leaf = place(x);
        relink(leaf);
        rec.path.push(leaf.id);
        rec.state.set(leaf.id, 'new');
        push(
          'build',
          ['return new Node<>(value)'],
          from === null
            ? `El árbol está vacío: ${x} pasa a ser la raíz, de altura 0.`
            : `${toward(from.side).replace('la ', 'La ')} de ${from.parent.value} es null: ${x} se cuelga ahí como hoja, de altura 0.`,
          columnOf(x),
        );
        rec.state.delete(leaf.id);
        rec.path.pop();
        return leaf;
      }
      rec.path.push(n.id);
      rec.cost += 1;
      rec.state.set(n.id, 'active');
      const v = n.value;
      if (x === v) {
        push(
          'done',
          ['int c = value.compareTo'],
          `${x} ya está en el árbol: no se inserta un repetido, y al volver nada cambia.`,
        );
        rec.state.delete(n.id);
        rec.path.pop();
        repeated = true;
        return n;
      }
      const side: Side = x < v ? 'left' : 'right';
      push(
        'walk',
        ['int c = value.compareTo', side === 'left' ? 'node.left = insert' : 'node.right = insert'],
        `insert(${v}): ${x} ${x < v ? '<' : '>'} ${v}, así que se baja por ${toward(side)}.`,
      );
      rec.state.delete(n.id);
      insert(n[side], (c) => (n[side] = c), { parent: n, side });
      const result = repeated ? n : balanceFramed(avl, rec, push, n, relink, inBalance);
      rec.path.pop();
      return result;
    };
    insert(avl.root, (c) => (avl.root = c), null);
  }
  rec.settle();
  push(
    'done',
    [],
    `El árbol cumple las dos invariantes, la de orden y la de balance. Su altura es ${heightText(heightIn(avl, avl.root))}.`,
  );
  // No strip, as the search tree's insertion (#322): no array beside the tree.
  const trace = finish(rec, code, columns, slots, false);
  return {
    ...trace,
    row: [
      { name: 'inserción', code },
      { name: 'balance', code: BALANCE },
    ],
    steps: trace.steps.map((step) => ({
      ...step,
      rowLines: [step.highlightLines, inBalance.get(step) ?? []],
    })),
  };
}

/**
 * Insertions run by a program, from an empty AVL (#322): the program on the
 * left — the tree created, then one `tree.insert(x);` per value — and the
 * insert method on the right, walked for every insertion as a single one is
 * walked, its program line lit the whole time (Miguel's review: the run of
 * insertions with the code beside it, step by step, so everything that
 * happens to the tree is seen). The same shape as the search tree's program
 * of removals.
 */
function traceAvlInsertProgram(values: number[], inserts: number[]): SequenceTrace {
  if (values.length > 0) {
    throw new Error(
      'El programa empieza con el árbol vacío: values va como [], y los valores que inserta, en value.',
    );
  }
  const walked = traceAvlInsert({ values: [], value: inserts });
  // The creation on two lines: the program's column is a fifth of the
  // slide's width, and on one line it was cut (#322).
  const code = [
    'AVL<Integer> tree =',
    '        new AVL<>();',
    ...inserts.map((x) => `tree.insert(${x});`),
  ].join('\n');
  const created: SequenceStep = {
    ...walked.steps[0]!,
    kind: 'start',
    highlightLines: [1, 2],
    rowLines: [[1, 2], [], []],
    description: 'El árbol se crea vacío: su raíz es null.',
    tree: { ...walked.steps[0]!.tree!, root: null, nodes: [], path: [] },
    cells: [],
  };
  // A run starts at the public call, the `start` frame of each insertion.
  let run = -1;
  const last = walked.steps.length - 1;
  const steps = walked.steps.map((step, i) => {
    if (step.kind === 'start') run += 1;
    // The closing frame speaks of the whole program: no line of it is running.
    if (i === last && step.kind === 'done') {
      return { ...step, highlightLines: [], rowLines: [[], [], []] };
    }
    const [inInsert = [], inBalanceLines = []] = step.rowLines ?? [];
    return { ...step, highlightLines: [run + 3], rowLines: [[run + 3], inInsert, inBalanceLines] };
  });
  return {
    ...walked,
    code,
    row: [{ name: 'programa', code }, ...walked.row!],
    steps: [created, ...steps],
  };
}

/**
 * Removals run by a program, from the AVL `values` builds (#322): the
 * program on a fifth of the slide — the tree created, the values in an array
 * and a loop inserting them, then one `tree.remove(x);` per target — beside
 * remove and balance, walked for every removal with its program line lit:
 * the insertions' shape, for the removals.
 */
function traceAvlRemoveProgram(values: number[], targets: number[]): SequenceTrace {
  if (values.length === 0) {
    throw new Error(
      'El programa elimina de un árbol: con values vacío el árbol está vacío y no hay nada que eliminar.',
    );
  }
  const walked = traceAvlRemove({ values, target: targets });
  // Four values to a line, so no line passes a fifth of the slide.
  const rows: string[] = [];
  for (let i = 0; i < values.length; i += 4) {
    const chunk = values.slice(i, i + 4).join(', ');
    rows.push(`    ${chunk}${i + 4 < values.length ? ',' : ''}`);
  }
  const build = [
    'AVL<Integer> tree =',
    '        new AVL<>();',
    'int[] v = {',
    ...rows,
    '};',
    'for (int x : v)',
    '    tree.insert(x);',
  ];
  const code = [...build, ...targets.map((x) => `tree.remove(${x});`)].join('\n');
  const builtLines = build.map((_, i) => i + 1);
  const built: SequenceStep = {
    ...walked.steps[0]!,
    kind: 'start',
    highlightLines: builtLines,
    rowLines: [builtLines, [], []],
    description: `El árbol, armado con esas inserciones: ${values.length} nodos.`,
  };
  let run = -1;
  const steps = walked.steps.map((step) => {
    if (step.kind === 'start') run += 1;
    const line = build.length + run + 1;
    const [inRemove = [], inBalanceLines = []] = step.rowLines ?? [];
    return { ...step, highlightLines: [line], rowLines: [[line], inRemove, inBalanceLines] };
  });
  return {
    ...walked,
    code,
    row: [{ name: 'programa', code }, ...walked.row!],
    steps: [built, ...steps],
  };
}

function traceAvlRemove(input: SequenceInput): SequenceTrace {
  const targets = asRuns(input.target);
  if (targets.length === 0) throw new Error('Falta el valor a eliminar.');
  requireRuns(targets.length);
  const code = CODE.remove;
  const columns: Record<number, number> = {};
  const slots = new Set(input.values).size;
  const { avl } = avlOf(input.values, columnsFor(input.values), columns);
  // No strip, as on `bst`: the listing, the tree and the narration fill the frame.
  const { rec, push, names } = avlRecorder(code, avl, () => []);
  const inBalance = new Map<SequenceStep, number[]>();

  for (const x of targets) {
    rec.reset();
    push(
      'start',
      ['root = remove(root, value)'],
      `Eliminar ${x}: primero se busca, como en el árbol de búsqueda.`,
    );
    let missing = false;
    const remove = (
      n: NumberNode | null,
      value: number,
      relink: (c: NumberNode | null) => void,
    ): NumberNode | null => {
      if (n === null) {
        push(
          'done',
          ['if (node == null) return null'],
          `${value} no está en el árbol: no se elimina nada.`,
        );
        missing = true;
        return null;
      }
      rec.path.push(n.id);
      rec.cost += 1;
      rec.state.set(n.id, 'active');
      const v = n.value;
      if (value !== v) {
        const side: Side = value < v ? 'left' : 'right';
        push(
          'walk',
          [
            'int c = value.compareTo',
            side === 'left'
              ? 'node.left = remove(node.left, value)'
              : 'node.right = remove(node.right, value)',
          ],
          `remove(${v}): ${value} ${value < v ? '<' : '>'} ${v}, así que se baja por ${toward(side)}.`,
        );
        rec.state.delete(n.id);
        remove(n[side], value, (c) => (n[side] = c));
        const result = missing ? n : balanceFramed(avl, rec, push, n, relink, inBalance);
        rec.path.pop();
        return result;
      }
      if (n.left === null || n.right === null) {
        const child = n.left ?? n.right;
        rec.state.set(n.id, 'leaving');
        push(
          'found',
          [n.left === null ? 'return node.right;' : 'return node.left;'],
          child === null
            ? `${value} es una hoja: se devuelve null, y su padre deja de apuntarle.`
            : `${value} tiene un solo hijo, ${child.value}: se devuelve ese hijo, y el padre de ${value} pasa a apuntarle.`,
        );
        rec.state.delete(n.id);
        avl.height.delete(n.id);
        relink(child);
        rec.path.pop();
        return child;
      }
      push(
        'walk',
        ['Node<T> next = node.right'],
        `${value} tiene dos hijos: se busca su sucesor, el menor valor de su subárbol derecho.`,
      );
      let next = n.right!;
      while (next.left !== null) next = next.left;
      // Accent is also the rotation's colour here, so the successor carries
      // its name, as the search tree's does (#322 review): the legend says
      // «sucesor o rotan», and the badge says which.
      rec.state.set(next.id, 'swap');
      names.set(next.id, 'sucesor');
      push(
        'found',
        ['while (next.left != null)'],
        `El sucesor de ${value} es ${next.value}: el menor de la derecha, sin hijo izquierdo.`,
      );
      rec.state.delete(next.id);
      names.delete(next.id);
      n.value = next.value;
      rec.state.set(n.id, 'new');
      push(
        'build',
        ['node.value = next.value'],
        `${value} toma el valor de su sucesor, ${next.value}, y queda borrar el sucesor de la derecha: no tiene hijo izquierdo, así que es una hoja o tiene un solo hijo.`,
      );
      rec.state.delete(n.id);
      remove(n.right, n.value, (c) => (n.right = c));
      const result = balanceFramed(avl, rec, push, n, relink, inBalance);
      rec.path.pop();
      return result;
    };
    remove(avl.root, x, (c) => (avl.root = c));
    if (!missing) {
      rec.settle();
      push(
        'done',
        [],
        `${x} ya no está en el árbol, y las dos invariantes se cumplen. Su altura es ${heightText(heightIn(avl, avl.root))}.`,
      );
    }
  }
  const trace = finish(rec, code, columns, slots, false);
  return {
    ...trace,
    row: [
      { name: 'eliminación', code },
      { name: 'balance', code: BALANCE },
    ],
    steps: trace.steps.map((step) => ({
      ...step,
      rowLines: [step.highlightLines, inBalance.get(step) ?? []],
    })),
  };
}
