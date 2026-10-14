import { describe, expect, it } from 'vitest';

import {
  AVL_OPERATIONS,
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceStep,
  type SequenceTrace,
  type TreeFrameNode,
} from './sequenceStepperTrace';

const byValue = (step: SequenceStep, v: number): TreeFrameNode =>
  step.tree!.nodes.find((n) => n.value === v)!;

/** The inorder of a frame's tree, read from its links from the root. */
const inorderOf = (step: SequenceStep): number[] => {
  const byId = new Map(step.tree!.nodes.map((n) => [n.id, n]));
  const out: number[] = [];
  const walk = (id: number | null) => {
    if (id === null) return;
    const n = byId.get(id)!;
    walk(n.left);
    out.push(Number(n.value));
    walk(n.right);
  };
  walk(step.tree!.root);
  return out;
};

const rootValue = (step: SequenceStep) =>
  step.tree!.nodes.find((n) => n.id === step.tree!.root)?.value;

/** The listing's line that holds this fragment, 1-based. */
const lineOf = (code: string, fragment: string) =>
  code.split('\n').findIndex((l) => l.includes(fragment)) + 1;

describe('sequenceStepperTrace · avl · the valid combinations', () => {
  it('takes the two rotations, and they are valid on no other recipe', () => {
    for (const operation of ['rotate-right', 'rotate-left'] as const) {
      expect(AVL_OPERATIONS).toContain(operation);
      for (const recipe of RECIPES) {
        expect(isValidCombination(recipe, operation), `${recipe} × ${operation}`).toBe(
          recipe === 'avl',
        );
      }
    }
  });

  it('refuses every operation it has no listing for', () => {
    for (const operation of OPERATIONS) {
      expect(isValidCombination('avl', operation), operation).toBe(
        AVL_OPERATIONS.includes(operation),
      );
    }
  });
});

/** Built by inserting 6, 4, 7, 2, 5 into a plain search tree: 4 has both children. */
const WITH_B = [6, 4, 7, 2, 5];

describe('sequenceStepperTrace · avl · rotate-right', () => {
  const trace = traceFor('avl', 'rotate-right', { values: WITH_B, target: 6 });
  const steps = trace.steps;

  it('runs the method one assignment per frame', () => {
    expect(steps.map((s) => s.highlightLines)).toEqual([
      [lineOf(trace.code, 'Node<T> rotateRight(')],
      [lineOf(trace.code, 'Node<T> q = p.left;')],
      [lineOf(trace.code, 'p.left = q.right;')],
      [lineOf(trace.code, 'q.right = p;')],
      [lineOf(trace.code, 'return q;')],
      [],
    ]);
  });

  it('shows the listing the class writes: no height yet', () => {
    expect(trace.code).toBe(`Node<T> rotateRight(Node<T> p) {
    Node<T> q = p.left;
    p.left = q.right;
    q.right = p;
    return q;
}`);
  });

  it('leaves the left child on top, with the old root as its right child', () => {
    const last = steps.at(-1)!;
    expect(rootValue(last)).toBe(4);
    expect(byValue(last, 4).right).toBe(byValue(last, 6).id);
    expect(byValue(last, 4).left).toBe(byValue(last, 2).id);
  });

  it('hands the left child’s right subtree over to the old root', () => {
    const last = steps.at(-1)!;
    expect(byValue(last, 6).left).toBe(byValue(last, 5).id);
    expect(byValue(last, 6).right).toBe(byValue(last, 7).id);
  });

  it('keeps the inorder, link by link, in every frame', () => {
    for (const s of [steps[0]!, steps.at(-1)!]) expect(inorderOf(s)).toEqual([2, 4, 5, 6, 7]);
    for (const s of steps) expect(s.tree!.strip).toEqual([2, 4, 5, 6, 7]);
  });

  it('draws every node in every frame, the one only q holds included', () => {
    for (const s of steps) {
      expect(s.tree!.nodes.map((n) => n.value).sort((a, b) => Number(a) - Number(b))).toEqual([
        2, 4, 5, 6, 7,
      ]);
    }
  });

  it('holds every node at its level until the caller takes q, so only links change', () => {
    const depths = (s: SequenceStep) => [2, 4, 5, 6, 7].map((v) => byValue(s, v).depth);
    const before = depths(steps[0]!);
    expect(before).toEqual([2, 1, 2, 0, 1]);
    for (const s of steps.slice(0, 4)) expect(depths(s)).toEqual(before);
    // After `return q`: 4 and 2 up a level, 6 and 7 down one, 5 where it was.
    expect(depths(steps.at(-1)!)).toEqual([1, 0, 2, 1, 2]);
  });

  it('shows the moment two references point at the same subtree', () => {
    const handed = steps[2]!;
    expect(byValue(handed, 6).left).toBe(byValue(handed, 5).id);
    expect(byValue(handed, 4).right).toBe(byValue(handed, 5).id);
    expect(rootValue(handed)).toBe(6);
  });

  it('shows q pointing back up at p before anyone points at q', () => {
    const up = steps[3]!;
    expect(byValue(up, 4).right).toBe(byValue(up, 6).id);
    expect(byValue(up, 4).depth).toBeGreaterThan(byValue(up, 6).depth);
    expect(rootValue(up)).toBe(6);
  });

  it('names p and q on the drawing, as the listing does', () => {
    const s = steps[1]!;
    expect(byValue(s, 6).badge).toBe('p');
    expect(byValue(s, 4).badge).toBe('q');
  });

  it('counts three reference changes, whatever the size of the tree', () => {
    expect(steps.at(-1)!.cost).toBe(3);
  });

  it('says the inorder did not change', () => {
    expect(steps.at(-1)!.description).toContain('2 4 5 6 7');
    expect(steps.at(-1)!.description).toContain('invariante');
  });
});

describe('sequenceStepperTrace · avl · a rotation lowers a chain', () => {
  it('turns a chain to the left into a tree of height 1, and says so', () => {
    const last = traceFor('avl', 'rotate-right', { values: [3, 2, 1], target: 3 }).steps.at(-1)!;
    expect(rootValue(last)).toBe(2);
    expect(last.description).toMatch(/de 2 a 1/);
  });

  it('mirrors it to the right', () => {
    const trace = traceFor('avl', 'rotate-left', { values: [1, 2, 3], target: 1 });
    const last = trace.steps.at(-1)!;
    expect(rootValue(last)).toBe(2);
    expect(byValue(last, 2).left).toBe(byValue(last, 1).id);
    expect(byValue(last, 2).right).toBe(byValue(last, 3).id);
    expect(trace.code).toContain('Node<T> q = p.right;');
  });

  it('works below the root: the parent takes q in its place', () => {
    const trace = traceFor('avl', 'rotate-right', { values: [8, 6, 9, 4, 7, 2], target: 6 });
    const last = trace.steps.at(-1)!;
    expect(rootValue(last)).toBe(8);
    expect(byValue(last, 8).left).toBe(byValue(last, 4).id);
    expect(byValue(last, 4).right).toBe(byValue(last, 6).id);
    // 4 had no right child: p.left becomes null.
    expect(byValue(last, 6).left).toBeNull();
    expect(trace.steps[4]!.description).toContain('8');
  });
});

describe('sequenceStepperTrace · avl · the double rotations (#322)', () => {
  // 12 leans left, and its left child 4 leans right: the weight is inside, under 8.
  const INSIDE_LEFT = [12, 4, 14, 2, 8, 6, 10];
  // The mirror: 4 leans right, and its right child 12 leans left, under 8.
  const INSIDE_RIGHT = [4, 2, 12, 8, 14, 6, 10];
  const lit = (code: string, step: SequenceStep) =>
    step.highlightLines.map((l) => code.split('\n')[l - 1]!.trim());
  const shape = (step: SequenceStep) => {
    const byId = new Map(step.tree!.nodes.map((n) => [n.id, n]));
    const of = (id: number | null): unknown =>
      id === null
        ? null
        : { v: byId.get(id)!.value, l: of(byId.get(id)!.left), r: of(byId.get(id)!.right) };
    return of(step.tree!.root);
  };
  const SETTLED = {
    v: 8,
    l: { v: 4, l: { v: 2, l: null, r: null }, r: { v: 6, l: null, r: null } },
    r: { v: 12, l: { v: 10, l: null, r: null }, r: { v: 14, l: null, r: null } },
  };

  it('are two valid operations of avl, and of no other recipe', () => {
    for (const operation of ['rotate-left-right', 'rotate-right-left'] as const) {
      expect(AVL_OPERATIONS).toContain(operation);
      for (const recipe of RECIPES) {
        expect(isValidCombination(recipe, operation), `${recipe} × ${operation}`).toBe(
          recipe === 'avl',
        );
      }
    }
  });

  it('lists the double as two calls: the child first, then the node', () => {
    const trace = traceFor('avl', 'rotate-left-right', { values: INSIDE_LEFT, target: 12 });
    expect(trace.code).toBe(
      'Node<T> rotateLeftRight(Node<T> p) {\n' +
        '    p.left = rotateLeft(p.left);\n' +
        '    return rotateRight(p);\n' +
        '}',
    );
    expect(traceFor('avl', 'rotate-right-left', { values: INSIDE_RIGHT, target: 4 }).code).toBe(
      'Node<T> rotateRightLeft(Node<T> p) {\n' +
        '    p.right = rotateRight(p.right);\n' +
        '    return rotateLeft(p);\n' +
        '}',
    );
  });

  // What a frame lights in each of the two simple rotations listed under the double.
  const inCallee = (trace: SequenceTrace, step: SequenceStep, i: number) =>
    (step.calleeLines?.[i] ?? []).map((l) => trace.callees![i]!.code.split('\n')[l - 1]!.trim());

  it('lists the two simple rotations under the double, the left one first', () => {
    for (const [operation, values, target] of [
      ['rotate-left-right', INSIDE_LEFT, 12],
      ['rotate-right-left', INSIDE_RIGHT, 4],
    ] as const) {
      const trace = traceFor('avl', operation, { values: [...values], target });
      expect(trace.callees!.map((c) => c.name)).toEqual([
        'rotación a la izquierda',
        'rotación a la derecha',
      ]);
      expect(trace.callees![0]!.code).toBe(
        traceFor('avl', 'rotate-left', { values: [1, 2], target: 1 }).code,
      );
      expect(trace.callees![1]!.code).toBe(
        traceFor('avl', 'rotate-right', { values: [2, 1], target: 2 }).code,
      );
    }
  });

  it('walks each call inside its own listing, the call lit in the double the whole time', () => {
    const trace = traceFor('avl', 'rotate-left-right', { values: INSIDE_LEFT, target: 12 });
    expect(
      trace.steps.map((s) => [
        lit(trace.code, s)[0] ?? '',
        inCallee(trace, s, 0)[0] ?? '',
        inCallee(trace, s, 1)[0] ?? '',
      ]),
    ).toEqual([
      ['Node<T> rotateLeftRight(Node<T> p) {', '', ''],
      ['p.left = rotateLeft(p.left);', 'Node<T> rotateLeft(Node<T> p) {', ''],
      ['p.left = rotateLeft(p.left);', 'Node<T> q = p.right;', ''],
      ['p.left = rotateLeft(p.left);', 'p.right = q.left;', ''],
      ['p.left = rotateLeft(p.left);', 'q.left = p;', ''],
      ['p.left = rotateLeft(p.left);', 'return q;', ''],
      ['return rotateRight(p);', '', 'Node<T> rotateRight(Node<T> p) {'],
      ['return rotateRight(p);', '', 'Node<T> q = p.left;'],
      ['return rotateRight(p);', '', 'p.left = q.right;'],
      ['return rotateRight(p);', '', 'q.right = p;'],
      ['return rotateRight(p);', '', 'return q;'],
      ['', '', ''],
    ]);
    // When the first call returns, 8 is up under 12, and 4 down to its left.
    expect(shape(trace.steps[5]!)).toEqual({
      v: 12,
      l: {
        v: 8,
        l: { v: 4, l: { v: 2, l: null, r: null }, r: { v: 6, l: null, r: null } },
        r: { v: 10, l: null, r: null },
      },
      r: { v: 14, l: null, r: null },
    });
    expect(shape(trace.steps.at(-1)!)).toEqual(SETTLED);
  });

  it('names on the drawing the variables of the method that is running', () => {
    const trace = traceFor('avl', 'rotate-left-right', { values: INSIDE_LEFT, target: 12 });
    const names = (step: SequenceStep) =>
      Object.fromEntries(
        step.tree!.nodes.filter((n) => n.badge !== undefined).map((n) => [n.badge, n.value]),
      );
    expect(names(trace.steps[0]!)).toEqual({ p: 12 });
    // Inside rotateLeft(p.left), its p is 4 and its q is 8.
    expect(names(trace.steps[2]!)).toEqual({ p: 4, q: 8 });
    // Inside rotateRight(p), its p is 12 and its q is 8 again.
    expect(names(trace.steps[7]!)).toEqual({ p: 12, q: 8 });
  });

  it('keeps the inorder in the strip in every frame, and says the height went down', () => {
    for (const [operation, values, target] of [
      ['rotate-left-right', INSIDE_LEFT, 12],
      ['rotate-right-left', INSIDE_RIGHT, 4],
    ] as const) {
      const trace = traceFor('avl', operation, { values: [...values], target });
      for (const step of trace.steps) {
        expect(step.tree!.strip.map(Number)).toEqual([2, 4, 6, 8, 10, 12, 14]);
      }
      expect(shape(trace.steps.at(-1)!)).toEqual(SETTLED);
      expect(inorderOf(trace.steps.at(-1)!)).toEqual([2, 4, 6, 8, 10, 12, 14]);
      expect(trace.steps.at(-1)!.description).toContain('pasó de 3 a 2');
    }
  });

  it('counts six reference changes, three per simple rotation', () => {
    const trace = traceFor('avl', 'rotate-left-right', { values: INSIDE_LEFT, target: 12 });
    expect(trace.steps.at(-1)!.cost).toBe(6);
  });

  it('refuses a node whose child has nothing inside to raise', () => {
    // 4 has a left child, 2, but 2 has no right child.
    expect(() => traceFor('avl', 'rotate-left-right', { values: [6, 4, 7, 2], target: 6 })).toThrow(
      /hijo derecho/,
    );
    expect(() => traceFor('avl', 'rotate-right-left', { values: [2, 4], target: 2 })).toThrow(
      /hijo izquierdo/,
    );
  });
});

describe('sequenceStepperTrace · avl · what a rotation refuses', () => {
  it('refuses a right rotation where there is no left child to raise', () => {
    expect(() => traceFor('avl', 'rotate-right', { values: [1, 2, 3], target: 1 })).toThrow(
      /hijo izquierdo/,
    );
  });

  it('refuses a left rotation where there is no right child to raise', () => {
    expect(() => traceFor('avl', 'rotate-left', { values: [3, 2, 1], target: 3 })).toThrow(
      /hijo derecho/,
    );
  });

  it('refuses a value that is not in the tree', () => {
    expect(() => traceFor('avl', 'rotate-right', { values: [3, 2, 1], target: 9 })).toThrow(
      /no está/,
    );
  });

  it('refuses a rotation with no node named', () => {
    expect(() => traceFor('avl', 'rotate-right', { values: [3, 2, 1] })).toThrow(/rotar/);
  });

  it('refuses a repeated value, as a search tree does', () => {
    expect(() => traceFor('avl', 'rotate-right', { values: [3, 2, 3], target: 3 })).toThrow(
      /repetido/,
    );
  });
});

/** The factor of every node of a frame, from its links: right height − left height. */
const factorsOf = (step: SequenceStep): Map<number, number> => {
  const byId = new Map(step.tree!.nodes.map((n) => [n.id, n]));
  const out = new Map<number, number>();
  const height = (id: number | null): number => {
    if (id === null) return -1;
    const n = byId.get(id)!;
    const l = height(n.left);
    const r = height(n.right);
    out.set(Number(n.value), r - l);
    return 1 + Math.max(l, r);
  };
  height(step.tree!.root);
  return out;
};

/** Both invariants of an AVL tree, read off a frame. */
const isAvl = (step: SequenceStep): boolean => {
  const order = inorderOf(step);
  const sorted = order.every((v, i) => i === 0 || order[i - 1]! < v);
  return sorted && [...factorsOf(step).values()].every((f) => Math.abs(f) <= 1);
};

describe('sequenceStepperTrace · avl · how many runs', () => {
  const thirteen = Array.from({ length: 13 }, (_, i) => i);

  it('refuses more than twelve runs on every operation, as every other recipe does', () => {
    expect(() => traceFor('avl', 'rotate-right', { values: [3, 2, 1], target: thirteen })).toThrow(
      /Entre 1 y 12/,
    );
    expect(() => traceFor('avl', 'rotate-left', { values: [1, 2, 3], target: thirteen })).toThrow(
      /Entre 1 y 12/,
    );
    expect(() => traceFor('avl', 'insert', { values: [], value: thirteen })).toThrow(
      /Entre 1 y 12/,
    );
    expect(() => traceFor('avl', 'remove', { values: [2, 1, 3], target: thirteen })).toThrow(
      /Entre 1 y 12/,
    );
  });
});

describe('sequenceStepperTrace · avl · insert', () => {
  it('builds its starting values as an AVL tree, rotating with no frames', () => {
    const first = traceFor('avl', 'insert', { values: [1, 2, 3], value: 4 }).steps[0]!;
    expect(rootValue(first)).toBe(2);
    expect(isAvl(first)).toBe(true);
  });

  it('shows the BST insert with balance as its last line, and not balance itself', () => {
    // balance's own lines sit on the slide before: beside insert, the slide
    // measured 0.545, under the 0.70 floor.
    const trace = traceFor('avl', 'insert', { values: [], value: [30, 20, 10] });
    expect(trace.code).toContain('return balance(node);');
    expect(trace.code).not.toContain('Node<T> balance(');
    // Every frame of the walk back lights the call.
    const call = lineOf(trace.code, 'return balance(node);');
    for (const s of trace.steps.filter((s) => s.description.startsWith('balance('))) {
      expect(s.highlightLines).toEqual([call]);
    }
  });

  it('rotates right once when 30, 20 and 10 arrive in that order', () => {
    const trace = traceFor('avl', 'insert', { values: [], value: [30, 20, 10] });
    const last = trace.steps.at(-1)!;
    expect(rootValue(last)).toBe(20);
    expect(inorderOf(last)).toEqual([10, 20, 30]);
    const rotation = trace.steps.find((s) => s.description.startsWith('Rotación simple'))!;
    expect(rotation.description).toMatch(/simple a la derecha: rotateRight\(30\)/);
  });

  it('rotates twice, child first, when 30, 10 and 20 arrive: the double rotation to the right', () => {
    const trace = traceFor('avl', 'insert', { values: [], value: [30, 10, 20] });
    expect(rootValue(trace.steps.at(-1)!)).toBe(20);
    const child = trace.steps.findIndex((s) => s.description.startsWith('Primero rotateLeft(10)'));
    const node = trace.steps.findIndex((s) => s.description.startsWith('Después rotateRight(30)'));
    expect(child).toBeGreaterThan(0);
    expect(node).toBeGreaterThan(child);
    expect(trace.steps.some((s) => /doble a la derecha/.test(s.description))).toBe(true);
  });

  it('writes the balance factor beside every node, with a real minus sign', () => {
    const trace = traceFor('avl', 'insert', { values: [], value: [30, 20, 10] });
    const broken = trace.steps.find((s) => s.description.includes('−2'))!;
    const thirty = broken.tree!.nodes.find((n) => n.value === 30)!;
    expect(thirty.badge).toBe('−2');
    for (const n of trace.steps.at(-1)!.tree!.nodes) {
      expect(['−1', '0', '+1']).toContain(n.badge);
    }
  });

  it('leaves both invariants in place after every insertion, whatever the order', () => {
    const orders = [
      [1, 2, 3, 4, 5, 6, 7],
      [7, 6, 5, 4, 3, 2, 1],
      [4, 2, 6, 1, 3, 5, 7],
      [3, 1, 6, 5, 7, 4, 2],
      [5, 1, 4, 2, 3, 7, 6],
      [2, 7, 1, 6, 3, 5, 4],
    ];
    for (const order of orders) {
      const trace = traceFor('avl', 'insert', { values: [], value: order });
      expect(isAvl(trace.steps.at(-1)!), order.join(' ')).toBe(true);
      expect(inorderOf(trace.steps.at(-1)!)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    }
  });

  it('keeps the strip sorted in every frame: a rotation never touches the order', () => {
    const trace = traceFor('avl', 'insert', { values: [], value: [1, 2, 3, 4, 5] });
    for (const s of trace.steps) {
      const written = s.tree!.strip.filter((v): v is number => v !== null);
      expect(written).toEqual([...written].sort((a, b) => a - b));
    }
  });

  it('marks the new leaf, and inserts nothing twice', () => {
    const trace = traceFor('avl', 'insert', { values: [2, 1, 3], value: 3 });
    expect(trace.steps.some((s) => s.description.includes('ya está'))).toBe(true);
    expect(trace.steps.at(-1)!.tree!.nodes).toHaveLength(3);
    const fresh = traceFor('avl', 'insert', { values: [2, 1, 3], value: 4 });
    const built = fresh.steps.find((s) =>
      s.highlightLines.includes(lineOf(fresh.code, 'return new Node<>(value)')),
    )!;
    expect(byValue(built, 4).state).toBe('new');
  });
});

describe('sequenceStepperTrace · avl · remove', () => {
  it('shows the BST remove with balance on the way back', () => {
    const { code } = traceFor('avl', 'remove', { values: [2, 1, 3], target: 1 });
    expect(code).toContain('return balance(node);');
    expect(code).toContain('node.value = next.value;');
  });

  it('rotates once when the child it lifts leans neither way: a factor only removal produces', () => {
    const trace = traceFor('avl', 'remove', { values: [4, 2, 5, 1, 3], target: 5 });
    const last = trace.steps.at(-1)!;
    expect(rootValue(last)).toBe(2);
    expect(byValue(last, 2).right).toBe(byValue(last, 4).id);
    expect(byValue(last, 4).left).toBe(byValue(last, 3).id);
    expect(isAvl(last)).toBe(true);
    expect(trace.steps.some((s) => /factor 0/.test(s.description))).toBe(true);
    expect(trace.steps.some((s) => /simple a la derecha/.test(s.description))).toBe(true);
  });

  it('removes with no rotation when every factor stays within one', () => {
    const trace = traceFor('avl', 'remove', { values: [4, 2, 5], target: 5 });
    expect(inorderOf(trace.steps.at(-1)!)).toEqual([2, 4]);
    expect(trace.steps.some((s) => /rotación/.test(s.description))).toBe(false);
  });

  it('copies the successor into a node with two children, as the BST does', () => {
    const last = traceFor('avl', 'remove', { values: [4, 2, 6, 1, 3, 5, 7], target: 4 }).steps.at(
      -1,
    )!;
    expect(rootValue(last)).toBe(5);
    expect(isAvl(last)).toBe(true);
  });

  it('says a value that is not there is not removed', () => {
    const trace = traceFor('avl', 'remove', { values: [2, 1, 3], target: 9 });
    expect(trace.steps.at(-1)!.description).toContain('no está');
  });

  it('leaves both invariants in place after every removal', () => {
    const start = [5, 2, 8, 1, 4, 7, 9, 3];
    for (const target of start) {
      const last = traceFor('avl', 'remove', { values: start, target }).steps.at(-1)!;
      expect(isAvl(last), `remove ${target}`).toBe(true);
      expect(inorderOf(last)).toEqual(start.filter((v) => v !== target).sort((a, b) => a - b));
    }
  });
});
