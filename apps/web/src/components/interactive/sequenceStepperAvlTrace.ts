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
import { asRuns } from './sequenceStepperTraceShared';
import type { AvlOperation, SequenceInput, SequenceTrace, TreeValue } from './sequenceStepperTrace';
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
 * last line. Insert shows the `balance` it calls, whose lines are the lesson;
 * remove shows only the call, which insert has already opened.
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
  insert: `Node<T> insert(Node<T> node, T value) {
    if (node == null) return new Node<>(value);
    int c = value.compareTo(node.value);
    if (c < 0) {
        node.left = insert(node.left, value);
    } else if (c > 0) {
        node.right = insert(node.right, value);
    }
    return balance(node);
}

Node<T> balance(Node<T> node) {
    updateHeight(node);
    int b = height(node.right) - height(node.left);
    if (b < -1) {
        Node<T> child = node.left;
        if (height(child.right) > height(child.left)) {
            node.left = rotateLeft(child);
        }
        return rotateRight(node);
    }
    if (b > 1) {
        Node<T> child = node.right;
        if (height(child.left) > height(child.right)) {
            node.right = rotateRight(child);
        }
        return rotateLeft(node);
    }
    return node;
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
    return balance(node);
}`,
};

/** A child in the narration. */
const CHILD: Record<Side, string> = { left: 'hijo izquierdo', right: 'hijo derecho' };
const OTHER: Record<Side, Side> = { left: 'right', right: 'left' };

/** The height of a subtree, the empty one's −1. */
function heightOf(n: TreeNode | null): number {
  return n === null ? -1 : 1 + Math.max(heightOf(n.left), heightOf(n.right));
}

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
  if (operation === 'insert') return traceAvlInsert(input);
  if (operation === 'remove') return traceAvlRemove(input);
  return traceRotation(operation === 'rotate-right' ? 'right' : 'left', input);
}

// ── the rotation, on its own ──────────────────────────────────────────────

function traceRotation(direction: Side, input: SequenceInput): SequenceTrace {
  const operation: AvlOperation = direction === 'right' ? 'rotate-right' : 'rotate-left';
  const targets = asRuns(input.target);
  if (targets.length === 0) throw new Error('Falta el valor del nodo a rotar.');
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
    const inorder = rec.steps.at(-1)!.tree!.strip.join(' ');
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

/** Which listing `balance` speaks in: its own lines, or only the call to it. */
type BalanceLines = 'own' | 'call';

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
  const push = (...args: Parameters<TreeRecorder['push']>) => {
    rec.badge.clear();
    for (const { node } of nodesOf(avl.root))
      rec.badge.set(node.id, signedFactor(factorIn(avl, node)));
    rec.push(...args);
  };
  return { rec, push };
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
  lines: BalanceLines,
): NumberNode {
  updateHeight(avl, n);
  const b = factorIn(avl, n);
  const v = n.value;
  const hl = heightIn(avl, n.left);
  const hr = heightIn(avl, n.right);
  const measured = `balance(${v}): su altura queda en ${heightIn(avl, n)}; su factor es ${signedFactor(hr)} − ${signedFactor(hl)} = ${signedFactor(b)}`;
  const own = (...fragments: string[]) => (lines === 'own' ? fragments : ['return balance(node);']);
  rec.cost += 1;
  rec.state.set(n.id, 'active');
  if (Math.abs(b) <= 1) {
    push(
      'compare',
      own('updateHeight(node);', 'int b = height(node.right)', 'return node;'),
      `${measured}: la invariante de balance se cumple.`,
    );
    rec.state.delete(n.id);
    return n;
  }
  push(
    'compare',
    own('updateHeight(node);', 'int b = height(node.right)'),
    `${measured}: la invariante de balance se rompe en ${v}.`,
  );
  const heavy: Side = b < 0 ? 'left' : 'right';
  const where = heavy === 'left' ? 'izquierda' : 'derecha';
  const child = n[heavy]!;
  const cf = factorIn(avl, child);
  const double = cf * b < 0;
  push(
    'compare',
    heavy === 'left'
      ? own(
          'if (b < -1)',
          'Node<T> child = node.left;',
          'if (height(child.right) > height(child.left))',
        )
      : own(
          'if (b > 1)',
          'Node<T> child = node.right;',
          'if (height(child.left) > height(child.right))',
        ),
    `${v} está cargado a la ${where}, y su ${CHILD[heavy]}, ${child.value}, tiene factor ${signedFactor(cf)}: ${
      cf === 0
        ? 'no está cargado hacia ningún lado, y basta una sola rotación'
        : double
          ? 'está cargado hacia el lado contrario'
          : 'está cargado hacia el mismo lado'
    }. Toca una rotación ${rotationName(heavy, double)}.`,
  );
  if (double) {
    const raised = rotate(avl, child, OTHER[heavy]);
    n[heavy] = raised;
    rec.state.set(child.id, 'swap');
    rec.state.set(raised.id, 'swap');
    push(
      'link',
      heavy === 'left'
        ? own('node.left = rotateLeft(child);')
        : own('node.right = rotateRight(child);'),
      `Primero ${heavy === 'left' ? 'rotateLeft' : 'rotateRight'}(${child.value}): ${raised.value} sube y ${child.value} baja. Ahora ${v} queda cargado a la ${where} por el mismo lado.`,
    );
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
    heavy === 'left' ? own('return rotateRight(node);') : own('return rotateLeft(node);'),
    `${double ? 'Después' : 'Rotación ' + rotationName(heavy, false) + ':'} ${heavy === 'left' ? 'rotateRight' : 'rotateLeft'}(${v}): ${q.value} sube a su lugar y ${v} baja. Las alturas de los dos se actualizan, y ${q.value} queda con factor ${signedFactor(factorIn(avl, q))}.`,
  );
  rec.state.delete(n.id);
  rec.state.delete(q.id);
  return q;
}

/** The side a value goes to from a node, in the narration. */
const toward = (side: Side) => (side === 'left' ? 'la izquierda' : 'la derecha');

function traceAvlInsert(input: SequenceInput): SequenceTrace {
  const inserts = asRuns(input.value);
  if (inserts.length === 0) throw new Error('Falta el valor a insertar.');
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

  for (const x of inserts) {
    rec.reset();
    push(
      'start',
      ['Node<T> insert('],
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
      const result = repeated ? n : balanceFramed(avl, rec, push, n, relink, 'own');
      rec.path.pop();
      return result;
    };
    insert(avl.root, (c) => (avl.root = c), null);
  }
  rec.settle();
  push(
    'done',
    [],
    `El árbol cumple las dos invariantes, la de orden y la de balance. Su altura es ${heightIn(avl, avl.root)}.`,
  );
  return finish(rec, code, columns, slots, true);
}

function traceAvlRemove(input: SequenceInput): SequenceTrace {
  const targets = asRuns(input.target);
  if (targets.length === 0) throw new Error('Falta el valor a eliminar.');
  const code = CODE.remove;
  const columns: Record<number, number> = {};
  const slots = new Set(input.values).size;
  const { avl } = avlOf(input.values, columnsFor(input.values), columns);
  // No strip, as on `bst`: the listing, the tree and the narration fill the frame.
  const { rec, push } = avlRecorder(code, avl, () => []);

  for (const x of targets) {
    rec.reset();
    push(
      'start',
      ['Node<T> remove('],
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
        const result = missing ? n : balanceFramed(avl, rec, push, n, relink, 'call');
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
      rec.state.set(next.id, 'swap');
      push(
        'found',
        ['while (next.left != null)'],
        `El sucesor de ${value} es ${next.value}: el menor de la derecha, sin hijo izquierdo.`,
      );
      rec.state.delete(next.id);
      n.value = next.value;
      rec.state.set(n.id, 'new');
      push(
        'build',
        ['node.value = next.value'],
        `${value} toma el valor de su sucesor, ${next.value}, y queda borrar el sucesor de la derecha: no tiene hijo izquierdo, así que es una hoja o tiene un solo hijo.`,
      );
      rec.state.delete(n.id);
      remove(n.right, n.value, (c) => (n.right = c));
      const result = balanceFramed(avl, rec, push, n, relink, 'call');
      rec.path.pop();
      return result;
    };
    remove(avl.root, x, (c) => (avl.root = c));
    if (!missing) {
      rec.settle();
      push(
        'done',
        [],
        `${x} ya no está en el árbol, y las dos invariantes se cumplen. Su altura es ${heightIn(avl, avl.root)}.`,
      );
    }
  }
  return finish(rec, code, columns, slots, false);
}
