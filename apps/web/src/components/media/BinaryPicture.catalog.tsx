import type { CatalogEntry } from '../../lib/catalogEntry';

import { BinaryPicture } from './BinaryPicture';

/** (3 + 4) * (5 − 1), the expression Árboles I threads through its binary act. */
const EXPR = {
  v: '*',
  l: { v: '+', l: { v: 3 }, r: { v: 4 } },
  r: { v: '−', l: { v: 5 }, r: { v: 1 } },
};

/** A search tree of the values 1 to 7, the one Árboles II walks. */
const SEARCH = {
  v: 4,
  l: { v: 2, l: { v: 1 }, r: { v: 3 } },
  r: { v: 6, l: { v: 5 }, r: { v: 7 } },
};

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const binaryPictureCatalogEntry: CatalogEntry = {
  name: 'BinaryPicture',
  family: 'media',
  description:
    'A static drawing of a binary tree, with the geometry of the binary-tree recipe of <SequenceStepper>: every node in the column of its inorder position and on the row of its depth, at the same sizes (components/treeGeometry.ts), so a figure and the widget beside it draw the same tree. It draws one moment of what a class says about a tree — an order of visits, the open calls of a recursion, an empty call, an exchange, a search.',
  whenToUse:
    'When a slide shows a tree in one state: a definition, a counterexample, one frame of a <StepShow> beside the line of code it belongs to. To WALK an operation frame by frame with its listing, use <SequenceStepper eda="binary-tree"> or eda="bst" instead. ' +
    'Promoted from a figure local to edd-arboles-i when edd-arboles-ii became the second document to want it (#322, add-a-course-document.md §6e-quater). ' +
    'Two runtime contracts, because MDX is not typechecked: a missing `label` renders an authoring error instead of an image the screen reader cannot name, and so does a value that appears twice — tones, badges and notes are keyed by value, so a repeated one would paint two nodes at once.',
  props: [
    {
      name: 'tree',
      type: '{ v, l?, r? }',
      description:
        'The tree: a value per node and its two sides, a side left out when empty. A value is a number or a symbol (an expression keeps its operators), unique within the tree.',
    },
    {
      name: 'label',
      type: 'string',
      description: 'What the figure shows, in Spanish: its accessible name. Required.',
    },
    {
      name: 'tones',
      type: "Record<value, 'idle' | 'focus' | 'mark' | 'keep' | 'accent' | 'done' | 'faint' | 'hidden'>",
      default: '{}',
      description:
        'The tone of some nodes, keyed by value. `accent` is the unit token for what is being moved, as the avl recipe paints the two nodes of a rotation; `faint` fades a node and dashes its edge; `hidden` keeps its place and draws neither it nor its edge, so a tree built from the leaves up shows its subtrees loose before their parent is made.',
    },
    {
      name: 'badges',
      type: 'Record<value, string | number>',
      default: '{}',
      description:
        'A short mark at the top right of some nodes: a height, a size, a balance factor.',
    },
    {
      name: 'notes',
      type: 'Record<value, string>',
      default: '{}',
      description: 'A note under some nodes; the layout keeps room for it under every level.',
    },
    {
      name: 'levels',
      type: 'boolean',
      default: 'false',
      description:
        'Writes "nivel 0", "nivel 1", … at the left of every level, with a dotted line across.',
    },
    {
      name: 'strip',
      type: 'boolean',
      default: 'false',
      description:
        'Writes the inorder in a strip under the tree, each value under its own node: the inorder of a search tree reads sorted.',
    },
    {
      name: 'splits',
      type: 'boolean',
      default: 'false',
      description:
        "A binary search's divisions, in place of the strip: one row per level under the tree, every node over the stretch of the sorted array it halves (its subtree's columns), the node — the middle — filled. Each level has a colour, shared by its nodes and its stretches; a tone written in `tones` still wins.",
    },
    {
      name: 'caption',
      type: 'string',
      description: 'A line under the drawing. A caption wider than the drawing widens the canvas.',
    },
    {
      name: 'size',
      type: 'number',
      default: '1',
      description: 'Scales the largest size the drawing takes: 0.7 for a frame beside a listing.',
    },
    {
      name: 'minColumns',
      type: 'number',
      default: '0',
      description:
        'Columns to make room for at least, so figures set side by side come out the same size; the tree is centred in them.',
    },
    {
      name: 'compact',
      type: 'boolean',
      default: 'false',
      description: 'Narrower columns and levels, for figures set three in a row.',
    },
    {
      name: 'visits',
      type: "'pre' | 'in' | 'post'",
      description:
        'Numbers the nodes in this order, in its own colour, and draws an arrow from every visit to the next: along the edge to a child or the parent, dashed when the walk jumps to another branch.',
    },
    {
      name: 'sequence',
      type: 'boolean',
      default: 'false',
      description: 'Writes the visit order under the tree as a row of chips.',
    },
    {
      name: 'until',
      type: 'value',
      description: 'Stops the visits at this value, as a search does when it finds it.',
    },
    {
      name: 'holes',
      type: 'boolean | value[]',
      default: 'false',
      description:
        'Draws the empty tree under every missing child, as a dashed square — or only under these values. An empty list keeps the room without drawing any, so the frames of one walk keep one height.',
    },
    {
      name: 'ruler',
      type: 'string',
      description: 'The height, drawn at the left as a ruler: "h = 2".',
    },
    {
      name: 'levelNotes',
      type: 'string[]',
      description: 'One note per level, at the right: how many nodes it holds, how many it could.',
    },
    {
      name: 'fresh',
      type: 'value',
      description: 'The node just added: its edge is drawn in the mark colour.',
    },
    {
      name: 'edgeLabels',
      type: 'Record<value, string>',
      default: '{}',
      description:
        'A word beside the edge that reaches a node, keyed by that node: the side it hangs on.',
    },
    {
      name: 'frames',
      type: "Record<value, string | { text, tone?: 'keep' | 'accent' | 'mark' }>",
      default: '{}',
      description:
        'A dashed box around the subtree rooted at a node, with its name under it; a tone tells two subtrees apart as they move.',
    },
    {
      name: 'path',
      type: 'value[]',
      default: '[]',
      description: 'The open calls of a recursion, from the root down: their edges are lit.',
    },
    {
      name: 'probe',
      type: "{ at: value, side: 'l' | 'r' }",
      description: 'A call that landed on an empty side, drawn as a dashed box with null in it.',
    },
    {
      name: 'swap',
      type: '[value, value]',
      description: 'The two nodes a visit just exchanged, joined by a double-headed arrow.',
    },
    {
      name: 'seek',
      type: 'value',
      description:
        'The value a search is looking for, written in the top left corner in a neutral pill: the colour stays for the node that holds it.',
    },
    {
      name: 'subtrees',
      type: 'value[]',
      default: '[]',
      description:
        'Values drawn as a named subtree, a triangle in its own column, instead of a node: the A, B and C of a generic rotation, which move whole. A triangle draws no empty children under it.',
    },
    {
      name: 'turn',
      type: "{ at: value; dir: 'right' | 'left' }",
      description:
        'A rotation about to happen at the node `at`, drawn as a curved arrow over the edge it turns, on the side away from the subtrees: clockwise over the edge to the left child for `right`, which brings that child up and the node down to its right; counterclockwise over the edge to the right child for `left`. For the picture BEFORE a rotation, so the reader sees which way it turns; the picture after needs none. A node without the child the rotation brings up is an authoring error.',
    },
    {
      name: 'emptyNote',
      type: 'string',
      default: "'root = null'",
      description:
        'What a drawing with every node hidden says. A tree built from the leaves up has no root to name yet, and passes an empty one.',
    },
  ],
  examples: [
    {
      title: 'A search tree with its inorder in the strip',
      code: `<BinaryPicture
  tree={{ v: 4, l: { v: 2, l: { v: 1 }, r: { v: 3 } }, r: { v: 6, l: { v: 5 }, r: { v: 7 } } }}
  strip
  label="Un árbol de búsqueda con los valores del 1 al 7. Debajo, su inorden: del 1 al 7, cada valor bajo su nodo."
  caption="el inorden de un árbol de búsqueda sale ordenado"
/>`,
      render: () => (
        <BinaryPicture
          tree={SEARCH}
          strip
          label="Un árbol de búsqueda con los valores del 1 al 7. Debajo, su inorden: del 1 al 7, cada valor bajo su nodo."
          caption="el inorden de un árbol de búsqueda sale ordenado"
        />
      ),
    },
    {
      title: 'A preorder, numbered, with its sequence',
      code: `<BinaryPicture
  tree={{ v: '*', l: { v: '+', l: { v: 3 }, r: { v: 4 } }, r: { v: '−', l: { v: 5 }, r: { v: 1 } } }}
  visits="pre"
  sequence
  label="La expresión (3 + 4) por (5 − 1) recorrida en preorden: el producto, la suma, el 3, el 4, la resta, el 5 y el 1."
/>`,
      render: () => (
        <BinaryPicture
          tree={EXPR}
          visits="pre"
          sequence
          label="La expresión (3 + 4) por (5 − 1) recorrida en preorden: el producto, la suma, el 3, el 4, la resta, el 5 y el 1."
        />
      ),
    },
    {
      title: 'A recursive call that landed on an empty side',
      code: `<BinaryPicture
  tree={{ v: '*', l: { v: '+', l: { v: 3 }, r: { v: 4 } }, r: { v: '−', l: { v: 5 }, r: { v: 1 } } }}
  path={['*', '+', 3]}
  probe={{ at: 3, side: 'l' }}
  holes={[3]}
  tones={{ 3: 'focus' }}
  label="Las llamadas abiertas bajan del producto a la suma y de la suma al 3; la llamada sobre el hijo izquierdo del 3 recibe el árbol vacío."
/>`,
      render: () => (
        <BinaryPicture
          tree={EXPR}
          path={['*', '+', 3]}
          probe={{ at: 3, side: 'l' }}
          holes={[3]}
          tones={{ 3: 'focus' }}
          label="Las llamadas abiertas bajan del producto a la suma y de la suma al 3; la llamada sobre el hijo izquierdo del 3 recibe el árbol vacío."
        />
      ),
    },
    {
      title: 'A generic right rotation, subtrees as triangles, its inorder in the strip',
      code: `<BinaryPicture
  tree={{ v: 'q', l: { v: 'A' }, r: { v: 'p', l: { v: 'B' }, r: { v: 'C' } } }}
  subtrees={['A', 'B', 'C']}
  tones={{ p: 'accent', q: 'accent', B: 'mark' }}
  strip
  label="Después de rotar a la derecha: q arriba, con el subárbol A a su izquierda y p a su derecha; p tiene a B a la izquierda y a C a la derecha. Debajo, el inorden: A, q, B, p, C."
/>`,
      render: () => (
        <BinaryPicture
          tree={{ v: 'q', l: { v: 'A' }, r: { v: 'p', l: { v: 'B' }, r: { v: 'C' } } }}
          subtrees={['A', 'B', 'C']}
          tones={{ p: 'accent', q: 'accent', B: 'mark' }}
          strip
          label="Después de rotar a la derecha: q arriba, con el subárbol A a su izquierda y p a su derecha; p tiene a B a la izquierda y a C a la derecha. Debajo, el inorden: A, q, B, p, C."
        />
      ),
    },
    {
      title: 'Before a right rotation: the arrow says which way it turns',
      code: `<BinaryPicture
  tree={{ v: 'p', l: { v: 'q', l: { v: 'A' }, r: { v: 'B' } }, r: { v: 'C' } }}
  subtrees={['A', 'B', 'C']}
  tones={{ p: 'accent', q: 'accent' }}
  turn={{ at: 'p', dir: 'right' }}
  label="Antes de rotar a la derecha en p: p arriba, con q a su izquierda y el subárbol C a su derecha. Una flecha curva, en el sentido de las agujas del reloj, sobre la arista entre p y q."
/>`,
      render: () => (
        <BinaryPicture
          tree={{ v: 'p', l: { v: 'q', l: { v: 'A' }, r: { v: 'B' } }, r: { v: 'C' } }}
          subtrees={['A', 'B', 'C']}
          tones={{ p: 'accent', q: 'accent' }}
          turn={{ at: 'p', dir: 'right' }}
          label="Antes de rotar a la derecha en p: p arriba, con q a su izquierda y el subárbol C a su derecha. Una flecha curva, en el sentido de las agujas del reloj, sobre la arista entre p y q."
        />
      ),
    },
    {
      title: 'Before a left rotation, the mirror',
      code: `<BinaryPicture
  tree={{ v: 'p', l: { v: 'A' }, r: { v: 'q', l: { v: 'B' }, r: { v: 'C' } } }}
  subtrees={['A', 'B', 'C']}
  tones={{ p: 'accent', q: 'accent' }}
  turn={{ at: 'p', dir: 'left' }}
  label="Antes de rotar a la izquierda en p: p arriba, con el subárbol A a su izquierda y q a su derecha. Una flecha curva, en contra de las agujas del reloj, sobre la arista entre p y q."
/>`,
      render: () => (
        <BinaryPicture
          tree={{ v: 'p', l: { v: 'A' }, r: { v: 'q', l: { v: 'B' }, r: { v: 'C' } } }}
          subtrees={['A', 'B', 'C']}
          tones={{ p: 'accent', q: 'accent' }}
          turn={{ at: 'p', dir: 'left' }}
          label="Antes de rotar a la izquierda en p: p arriba, con el subárbol A a su izquierda y q a su derecha. Una flecha curva, en contra de las agujas del reloj, sobre la arista entre p y q."
        />
      ),
    },
    {
      title: 'The decision tree of a binary search, with the stretch each node halves',
      code: `<BinaryPicture
  tree={{ v: 8, l: { v: 4, l: { v: 2 }, r: { v: 6 } }, r: { v: 12, l: { v: 10 }, r: { v: 14 } } }}
  splits
  label="El árbol de decisiones de una búsqueda binaria sobre 2, 4, 6, 8, 10, 12, 14, y debajo el arreglo partido nivel por nivel, cada tramo del color de su nodo."
/>`,
      render: () => (
        <BinaryPicture
          tree={{
            v: 8,
            l: { v: 4, l: { v: 2 }, r: { v: 6 } },
            r: { v: 12, l: { v: 10 }, r: { v: 14 } },
          }}
          splits
          label="El árbol de decisiones de una búsqueda binaria sobre 2, 4, 6, 8, 10, 12, 14, y debajo el arreglo partido nivel por nivel, cada tramo del color de su nodo."
        />
      ),
    },
    {
      title: 'Given a repeated value',
      code: `<BinaryPicture tree={{ v: 5, l: { v: 3 }, r: { v: 3 } }} label="Un árbol con un 3 repetido." />`,
      render: () => (
        <BinaryPicture
          tree={{ v: 5, l: { v: 3 }, r: { v: 3 } }}
          label="Un árbol con un 3 repetido."
        />
      ),
    },
  ],
};
