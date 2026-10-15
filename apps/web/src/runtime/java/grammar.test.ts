import { describe, expect, it } from 'vitest';

import { grammar, javaListing } from './grammar';

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

  // The second reading costs a whole parse of the document, and an editor
  // calls the parser on every keystroke, mid-edit, with errors most of the
  // time (#322 review: 34 of 50 keystrokes re-parsed the intersection
  // program, and the members reading won none). Two cases never need it.
  it('reads a program that imports as a program, even with an error', () => {
    // An import cannot be the member of a class: whatever else the source
    // holds, it is a whole program, and a student typing in it has an error
    // on most keystrokes.
    const tree = javaListing.parser.parse(
      'import java.util.List;\n\nint first() {\n    return 1;\n}\nint second() {\n    return 2;\n}',
    );
    expect(tree.topNode.name).toBe('Program');
  });

  it('leaves a parse that stopped before the end as it is', () => {
    // CodeMirror stops a parse at the viewport or at its time budget; the
    // part not reached yet is not a reading to second-guess, and re-reading
    // the whole document would undo the bound.
    const source = 'void f() {\n    int x = 1;\n}\n'.repeat(400);
    const parse = javaListing.parser.startParse(source);
    parse.stopAt(300);
    let tree = parse.advance();
    while (tree === null) tree = parse.advance();
    expect(tree.length).toBeLessThan(source.length);
  });

  it('installs the listing language, and names it', () => {
    const installed = grammar() as { language?: unknown; extension?: unknown };
    expect(installed.language).toBe(javaListing);
    expect(installed.extension).toBe(javaListing);
  });
});
