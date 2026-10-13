import { describe, expect, it } from 'vitest';

import {
  AVL_OPERATIONS,
  OPERATIONS,
  RECIPES,
  isValidCombination,
  traceFor,
  type SequenceStep,
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
