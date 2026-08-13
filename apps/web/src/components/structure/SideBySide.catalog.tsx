import type { CatalogEntry } from '../../lib/catalogEntry';

import { SideBySide } from './SideBySide';

/** Catalog entry (ADR-0010) — colocated with the component, exported via the seam. */
export const sideBySideCatalogEntry: CatalogEntry = {
  name: 'SideBySide',
  family: 'structure',
  description:
    'Two blocks shown next to each other with a label each, stacked on a narrow screen. Each column scrolls on its own, so a long line in one never widens the page.',
  whenToUse:
    'When the comparison IS the lesson — most often the language a student already knows beside the one they are learning. Stacking the two listings instead makes the reader hold the first in their head while reading the second, which is exactly the work the layout should be doing for them. ' +
    'It expects exactly two children and says so when it gets any other number: with three blocks the pairing is ambiguous, and guessing would silently drop one.',
  props: [
    { name: 'left', type: 'string', description: 'Label above the first column. Optional.' },
    { name: 'right', type: 'string', description: 'Label above the second column. Optional.' },
    {
      name: 'children',
      type: 'MDX',
      description:
        'Exactly two blocks, typically two code fences. Authored order is kept: the first is the left column.',
    },
  ],
  examples: [
    {
      title: 'El mismo programa en dos lenguajes',
      code: `<SideBySide left="C++" right="Java">

\`\`\`cpp
#include <iostream>

int main() {
    std::cout << "Hola" << std::endl;
}
\`\`\`

\`\`\`java
class Hola {
    public static void main(String[] args) {
        System.out.println("Hola");
    }
}
\`\`\`

</SideBySide>`,
      render: () => (
        <SideBySide left="C++" right="Java">
          <pre>{`#include <iostream>

int main() {
    std::cout << "Hola" << std::endl;
}`}</pre>
          <pre>{`class Hola {
    public static void main(String[] args) {
        System.out.println("Hola");
    }
}`}</pre>
        </SideBySide>
      ),
    },
    {
      title: 'Con un número de bloques que no es dos',
      code: `<SideBySide left="C++" right="Java">

\`\`\`cpp
int main() {}
\`\`\`

</SideBySide>`,
      render: () => (
        <SideBySide left="C++" right="Java">
          <pre>int main() {}</pre>
        </SideBySide>
      ),
    },
  ],
};
