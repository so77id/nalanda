import type { CatalogEntry } from '../../lib/catalogEntry';

import { MdxPre } from '../MdxPre';
import { SideBySide } from './SideBySide';

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
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
        'Exactly two blocks, typically two code fences. Authored order is kept: the first is the left column. A fence in a runtime language renders as the read-only editor (#85) and the column suppresses its frame, filename, language chip and line numbers — the column already provides all four.',
    },
    {
      name: 'direction',
      type: '"horizontal" | "vertical"',
      description:
        '"horizontal" (default): two columns on desktop, stacked on narrow. "vertical": always stacked. Use vertical when both blocks need the full page width (for example prompt + revealed answer in a complexity exercise). The reading "SideBySide direction=vertical" is acknowledged awkward — Discussion #220 tracks a rename.',
    },
  ],
  examples: [
    {
      title: 'The same program in two languages',
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
      // The shape a document really produces: MDX hands `pre` a `code` child
      // carrying `language-*`, and since #85 the shell maps that onto the
      // read-only editor. Rendering bare <pre> here showed authors the one
      // thing the WP removed — coloured, unframed, no gutter, with a copy
      // button is what they get.
      render: () => (
        <SideBySide left="C++" right="Java">
          <MdxPre>
            <code className="language-cpp">{`#include <iostream>

int main() {
    std::cout << "Hola" << std::endl;
}
`}</code>
          </MdxPre>
          <MdxPre>
            <code className="language-java">{`class Hola {
    public static void main(String[] args) {
        System.out.println("Hola");
    }
}
`}</code>
          </MdxPre>
        </SideBySide>
      ),
    },
    {
      title: 'Vertical direction — two blocks stacked, each at full width',
      code: `<SideBySide direction="vertical" left="Prompt" right="Solution">

\`\`\`java
int algo(int n) { ... }
\`\`\`

\`\`\`java
// desarrollo revelado
\`\`\`

</SideBySide>`,
      render: () => (
        <SideBySide direction="vertical" left="Prompt" right="Solution">
          <MdxPre>
            <code className="language-java">{`int algo(int n) {
    // code to analyse
}
`}</code>
          </MdxPre>
          <MdxPre>
            <code className="language-java">{`// revealed development
// T(n) = ...
`}</code>
          </MdxPre>
        </SideBySide>
      ),
    },
    {
      title: 'Given any number of blocks that is not two',
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
