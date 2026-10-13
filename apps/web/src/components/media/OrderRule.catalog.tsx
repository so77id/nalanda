import type { CatalogEntry } from '../../lib/catalogEntry';

import { OrderRule } from './OrderRule';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const orderRuleCatalogEntry: CatalogEntry = {
  name: 'OrderRule',
  family: 'media',
  description:
    "The rule of a traversal written short: its parts as pills joined by arrows, in the traversal's colour — node then children for the preorder, left then root then right for the inorder.",
  whenToUse:
    'On the slide that introduces a traversal, before the drawing that walks it (a <BinaryPicture> with visits) and before the widget that runs its code: the rule first, then how the tree is walked, then the code. Use the colour the traversal is drawn in elsewhere — focus for the preorder, accent for the inorder, mark for the postorder. ' +
    'Promoted from a figure local to edd-arboles-i when edd-arboles-ii became the second document to want it (#322, add-a-course-document.md §6e-quater). ' +
    'A missing `label`, or fewer than two parts, renders an authoring error.',
  props: [
    {
      name: 'parts',
      type: 'string[]',
      description: 'The parts of the rule, in order. At least two.',
    },
    {
      name: 'tone',
      type: "'focus' | 'accent' | 'mark' | 'keep'",
      default: "'focus'",
      description: 'The colour of the traversal it states.',
    },
    {
      name: 'label',
      type: 'string',
      description: 'What the rule says, in Spanish: its accessible name. Required.',
    },
  ],
  examples: [
    {
      title: 'The inorder, in its colour',
      code: `<OrderRule parts={['izquierda', 'raíz', 'derecha']} tone="accent" label="La regla del inorden: el subárbol izquierdo, después la raíz, después el derecho." />`,
      render: () => (
        <OrderRule
          parts={['izquierda', 'raíz', 'derecha']}
          tone="accent"
          label="La regla del inorden: el subárbol izquierdo, después la raíz, después el derecho."
        />
      ),
    },
    {
      title: 'The preorder of a general tree',
      code: `<OrderRule parts={['nodo', 'hijos']} label="La regla del preorden: el nodo, y después sus hijos." />`,
      render: () => (
        <OrderRule
          parts={['nodo', 'hijos']}
          label="La regla del preorden: el nodo, y después sus hijos."
        />
      ),
    },
  ],
};
