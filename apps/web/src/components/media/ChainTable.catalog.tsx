import type { CatalogEntry } from '../../lib/catalogEntry';

import { ChainTable } from './ChainTable';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const chainTableCatalogEntry: CatalogEntry = {
  name: 'ChainTable',
  family: 'media',
  description:
    'A hash table with chaining drawn still: the table as a contiguous strip with its index, each position\'s list hanging under its cell, null where a list ends. It shares the cell and node heights of <SequenceStepper>\'s hash recipe (at size="rut" the key field is two units taller), so a figure and the widget beside it read alike.',
  whenToUse:
    'Where a class shows a hash table in one state rather than walking it: the table after some insertions, a search going to its position (picked, only), what a search passes over and finds (tones), a removal and the link that skips the node (cut), the same keys at two sizes, the node of a map with its value (values), or the order a traversal meets the nodes (order). Use size="rut" for keys as wide as a RUT. To walk the operation step by step, use <SequenceStepper eda="hash-chaining"> instead. ' +
    'Promoted from the figures local to edd-tablas-hash and edd-set-map when the second document copied the first (#353, add-a-course-document.md §6e-quater). ' +
    'A missing label, no positions, a window outside the table, or a tone for a key no list holds renders an authoring error.',
  props: [
    {
      name: 'chains',
      type: 'string[][]',
      description:
        'One list per position of the table, each from its first node. At least one position. A key may be written in two nodes (a class without its equals leaves one RUT in two lists); its tone and value reach every node that holds it, and cut removes the first one of each list, as remove does on a list.',
    },
    {
      name: 'size',
      type: "'name' | 'rut'",
      default: "'name'",
      description:
        "How wide a node is drawn: for a short name, or for a key as wide as a RUT, whose key field is two units taller than the widget's for the smaller face it takes.",
    },
    {
      name: 'picked',
      type: 'number',
      description: 'The position a search goes to: its cell outlined and its index in bold.',
    },
    {
      name: 'only',
      type: 'boolean',
      default: 'false',
      description: 'With picked, fades every other position.',
    },
    {
      name: 'tones',
      type: "Record<string, 'keep' | 'mark' | 'flag' | 'visited'>",
      description:
        'A tone per key: found (keep), new or broken (mark), a wrong turn (flag), passed over (visited). keep and mark take the strong stroke.',
    },
    {
      name: 'cut',
      type: 'string',
      description:
        'The key being removed: its node struck through and dashed, and the link that skips it drawn.',
    },
    {
      name: 'values',
      type: 'Record<string, string>',
      description: "A map's value per key, drawn in a band under the key: the node of a map.",
    },
    {
      name: 'order',
      type: 'boolean',
      default: 'false',
      description:
        'Numbers every node in the order a walk over the table meets it: position by position, each list from its front.',
    },
    {
      name: 'window',
      type: '[number, number]',
      description:
        'Only the positions from the first to the second, both included, with «…» where the table goes on.',
    },
    {
      name: 'caption',
      type: 'string',
      description: 'A line under the table; a part between backticks is drawn in the code face.',
    },
    {
      name: 'label',
      type: 'string',
      description: 'What the figure shows, in Spanish: its accessible name. Required.',
    },
  ],
  examples: [
    {
      title: 'A search goes to its position and finds the key',
      code: `<ChainTable
  chains={[['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []]}
  picked={2}
  only
  window={[1, 3]}
  tones={{ Leo: 'visited', Ana: 'keep' }}
  caption="buscar «Ana»: la encuentra en su lista"
  label="Las posiciones 1 a 3 de la tabla. La posición 2 está destacada: su lista pasa por Leo y encuentra a Ana."
/>`,
      render: () => (
        <ChainTable
          chains={[['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []]}
          picked={2}
          only
          window={[1, 3]}
          tones={{ Leo: 'visited', Ana: 'keep' }}
          caption="buscar «Ana»: la encuentra en su lista"
          label="Las posiciones 1 a 3 de la tabla. La posición 2 está destacada: su lista pasa por Leo y encuentra a Ana."
        />
      ),
    },
    {
      title: 'A removal, and the link that skips the node',
      code: `<ChainTable
  chains={[['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []]}
  picked={2}
  only
  window={[1, 3]}
  cut="Leo"
  caption="eliminar «Leo»: table[2] salta a «Ana»"
  label="Las posiciones 1 a 3. Leo, tachado, sale de la lista de la posición 2, y table[2] pasa a apuntar a Ana."
/>`,
      render: () => (
        <ChainTable
          chains={[['Eva'], ['Juan'], ['Leo', 'Ana'], ['Bea'], ['Sara'], [], []]}
          picked={2}
          only
          window={[1, 3]}
          cut="Leo"
          caption="eliminar «Leo»: table[2] salta a «Ana»"
          label="Las posiciones 1 a 3. Leo, tachado, sale de la lista de la posición 2, y table[2] pasa a apuntar a Ana."
        />
      ),
    },
    {
      title: 'A map of RUTs, each node with its value',
      code: `<ChainTable
  chains={[[], [], ['12.547.354-7'], ['22.715.853-0'], ['13.959.276-K', '13.180.992-1'], [], []]}
  size="rut"
  values={{ '12.547.354-7': 'mesa 2', '22.715.853-0': 'mesa 1', '13.959.276-K': 'mesa 3', '13.180.992-1': 'mesa 1' }}
  picked={4}
  tones={{ '13.959.276-K': 'keep' }}
  caption="\`get\` de 13.959.276-K: la posición de su \`hashCode\`, y el valor de su nodo"
  label="Una tabla de siete posiciones con cuatro RUT; cada nodo guarda el RUT y debajo su mesa. En la posición 4, destacada, el nodo de 13.959.276-K guarda la mesa 3."
/>`,
      render: () => (
        <ChainTable
          chains={[
            [],
            [],
            ['12.547.354-7'],
            ['22.715.853-0'],
            ['13.959.276-K', '13.180.992-1'],
            [],
            [],
          ]}
          size="rut"
          values={{
            '12.547.354-7': 'mesa 2',
            '22.715.853-0': 'mesa 1',
            '13.959.276-K': 'mesa 3',
            '13.180.992-1': 'mesa 1',
          }}
          picked={4}
          tones={{ '13.959.276-K': 'keep' }}
          caption="`get` de 13.959.276-K: la posición de su `hashCode`, y el valor de su nodo"
          label="Una tabla de siete posiciones con cuatro RUT; cada nodo guarda el RUT y debajo su mesa. En la posición 4, destacada, el nodo de 13.959.276-K guarda la mesa 3."
        />
      ),
    },
  ],
};
