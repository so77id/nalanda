/**
 * Pure traces for the tree recipes of `<SequenceStepper>` (#321). Same
 * contract as `sequenceStepperTrace`, which dispatches here: a recipe, an
 * operation and an author-written input become a frame list and the Java
 * listing those frames light lines of — so the suite pins every frame and the
 * browser is left only "does it look right" (`apps/web/CLAUDE.md` §2).
 *
 * A tree frame carries the whole tree (`step.tree`): every node with its two
 * links and its paint, the calls still open, and the strip under the tree.
 * `cells` mirrors the nodes so the widget's readout counts them.
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
 * differ in ONE line's position — where the visit sits among the two calls —
 * and that is the whole lesson of the three orders.
 */
const TRAVERSAL_CODE: Record<Traversal, string> = {
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
};

/** The traversal's name in the narration. */
const TRAVERSAL_NAME: Record<Traversal, string> = {
  preorder: 'preorden',
  inorder: 'inorden',
  postorder: 'postorden',
};

/** The 1-based line of the first line containing `fragment` — never a number. */
function lineOf(code: string, fragment: string): number {
  const at = code.split('\n').findIndex((line) => line.includes(fragment));
  if (at < 0) throw new Error(`El listado no contiene «${fragment}».`);
  return at + 1;
}

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
function nodesOf(root: TreeNode): TreeNode[] {
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

/** Column = inorder position; depth = distance from the root. */
function placeOf(root: TreeNode): { columns: Record<number, number>; depth: number } {
  const columns: Record<number, number> = {};
  let column = 0;
  let depth = 0;
  const walk = (n: TreeNode | null, level: number) => {
    if (n === null) return;
    walk(n.left, level + 1);
    columns[n.id] = column;
    column += 1;
    depth = Math.max(depth, level);
    walk(n.right, level + 1);
  };
  walk(root, 0);
  return { columns, depth };
}

export function traceTree(operation: SequenceOperation, input: SequenceInput): SequenceTrace {
  const traversal = operation as Traversal;
  const root = fromLevelOrder(input.levelOrder ?? input.values);
  const all = nodesOf(root);
  const { columns, depth } = placeOf(root);
  const code = TRAVERSAL_CODE[traversal];
  const name = TRAVERSAL_NAME[traversal];

  const state = new Map<number, SequenceCellState>();
  const badge = new Map<number, string>();
  const path: number[] = [];
  const strip: (number | null)[] = all.map(() => null);
  const steps: SequenceStep[] = [];
  let written = 0;
  let cost = 0;

  /** Only the node being looked at NOW stays lit; the rest settle. */
  const settle = () => {
    for (const [id, s] of state) {
      if (s === 'new') state.set(id, 'visited');
      if (s === 'active') state.set(id, 'idle');
    }
  };

  const frame = (stripFresh?: number): TreeFrame => {
    const nodes: TreeFrameNode[] = all.map((n) => {
      const out: TreeFrameNode = {
        id: n.id,
        value: n.value,
        left: n.left?.id ?? null,
        right: n.right?.id ?? null,
        state: state.get(n.id) ?? 'idle',
      };
      const mark = badge.get(n.id);
      if (mark !== undefined) out.badge = mark;
      return out;
    });
    const out: TreeFrame = { root: root.id, nodes, path: [...path], strip: [...strip] };
    if (stripFresh !== undefined) out.stripFresh = stripFresh;
    return out;
  };

  const push = (
    kind: SequenceStepKind,
    fragments: string[],
    description: string,
    stripFresh?: number,
  ) => {
    const tree = frame(stripFresh);
    const cells: SequenceCell[] = tree.nodes.map((n) => ({
      id: n.id,
      value: n.value,
      state: n.state,
    }));
    steps.push({
      kind,
      cells,
      pointers: [],
      highlightLines: fragments.map((f) => lineOf(code, f)),
      description,
      cost,
      tree,
    });
  };

  const enter = (n: TreeNode, description: string, fragment: string) => {
    settle();
    state.set(n.id, 'active');
    push('walk', [fragment], description);
  };

  const write = (n: TreeNode, description: string) => {
    settle();
    const slot = written;
    written += 1;
    cost += 1;
    state.set(n.id, 'new');
    badge.set(n.id, String(written));
    strip[slot] = n.value;
    push('build', ['System.out.print'], description, slot);
  };

  const hasChildren = (n: TreeNode) => n.left !== null || n.right !== null;

  const visit = (n: TreeNode) => {
    path.push(n.id);
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
    } else {
      if (hasChildren(n)) {
        enter(
          n,
          `postorder(${v}): ${v} se visita después de sus dos lados.`,
          'postorder(node.left)',
        );
        if (n.left !== null) visit(n.left);
        if (n.right !== null) visit(n.right);
        write(n, `postorder(${v}): sus dos lados ya se recorrieron; se visita ${v}.`);
      } else {
        write(n, `postorder(${v}): no tiene hijos; se visita ${v}.`);
      }
    }
    path.pop();
  };

  push('start', [`void ${traversal}(`], `El ${name} empieza por la raíz, ${root.value}.`);
  visit(root);
  settle();
  push('done', [], `El ${name} completo es ${strip.join(' ')}.`);

  return {
    steps,
    code,
    maxCells: all.length,
    align: 'left',
    hasCarry: false,
    tree: { columns, slots: all.length, depth },
  };
}
