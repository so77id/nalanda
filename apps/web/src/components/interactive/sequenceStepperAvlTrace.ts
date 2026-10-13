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
 */
import { asRuns } from './sequenceStepperTraceShared';
import type { AvlOperation, SequenceInput, SequenceTrace, TreeValue } from './sequenceStepperTrace';
import {
  TreeRecorder,
  bstOf,
  columnsFor,
  finish,
  nodesOf,
  type NumberNode,
  type TreeNode,
} from './sequenceStepperTreeTrace';

type Side = 'left' | 'right';

/** The class's rotations, before the AVL gives its nodes a height. */
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
