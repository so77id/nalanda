import { describe, expect, it } from 'vitest';

import { javaListing } from './grammar';

/** How many error nodes the highlighter's parse leaves in a source. */
const errorsIn = (source: string) => {
  let errors = 0;
  javaListing.parser.parse(source).iterate({
    enter: (node) => {
      if (node.type.isError) errors += 1;
    },
  });
  return errors;
};

describe('the Java grammar', () => {
  // A course shows methods on their own, outside their class: the AVL's
  // rotations and balance, every listing of the search tree. Read as a whole
  // program they were errors, and the highlighter left them black (#322).
  it('reads methods written on their own as the members of a class', () => {
    expect(
      errorsIn(
        'Node<T> rotateRight(Node<T> p) {\n' +
          '    Node<T> q = p.left;\n' +
          '    p.left = q.right;\n' +
          '    q.right = p;\n' +
          '    return q;\n' +
          '}',
      ),
    ).toBe(0);
    expect(
      errorsIn(
        'public void insert(T value) {\n' +
          '    root = insert(root, value);\n' +
          '}\n\n' +
          'private Node<T> insert(Node<T> node, T value) {\n' +
          '    if (node == null) return new Node<>(value);\n' +
          '    return node;\n' +
          '}',
      ),
    ).toBe(0);
  });

  it('still reads a whole program, and statements on their own, as before', () => {
    expect(errorsIn('import java.util.List;\n\nclass Node<T> {\n    T value;\n}')).toBe(0);
    expect(errorsIn('Node<Integer> root = new Node<>(8);\nroot.left = new Node<>(4);')).toBe(0);
  });
});
