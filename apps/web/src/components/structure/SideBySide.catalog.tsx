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
    'Also, since #321, a listing beside the drawing of what it builds — a class beside the node it makes in memory — when both columns want their labels: pass `align="center"`. Anything else beside a picture is a <Split> (ADR-0029 §Amended by — #321). ' +
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
    {
      name: 'align',
      type: '"start" | "center"',
      description:
        'Where each column puts content shorter than its sibling. "start" (default) keeps it at the top: two listings compared line by line stay level. A child that places itself — DivideCombineTree centres in any column — does so whatever `align` says. "center" puts it in the middle of its column — a listing beside a drawing, where the shorter of the two would otherwise hug the top. A listing fills its column either way, so its background never stops halfway down; "center" moves its lines, not its background.',
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
      title: 'A listing beside a drawing — align="center"',
      code: `<SideBySide left="El código" right="En memoria" align="center">

\`\`\`java
class Node<T> {
    T value;
    Node<T> next;
}
\`\`\`

<svg …>…</svg>

</SideBySide>`,
      render: () => (
        <SideBySide left="El código" right="En memoria" align="center">
          <MdxPre>
            <code className="language-java">{`class Node<T> {
    T value;
    Node<T> next;
}
`}</code>
          </MdxPre>
          <svg
            viewBox="0 0 240 200"
            role="img"
            aria-label="Dos nodos en memoria, uno debajo del otro: el primero apunta al segundo, y el segundo apunta a null."
            style={{ width: '100%', maxWidth: '240px', display: 'block', margin: '0.75rem auto' }}
          >
            <rect
              x="80"
              y="20"
              width="80"
              height="34"
              rx="4"
              style={{ fill: 'var(--color-surface)', stroke: 'var(--color-rule-strong)' }}
            />
            <text
              x="120"
              y="42"
              textAnchor="middle"
              fontSize="14"
              style={{ fill: 'var(--color-ink)' }}
            >
              3
            </text>
            <line
              x1="120"
              y1="54"
              x2="120"
              y2="100"
              style={{ stroke: 'var(--color-ink-soft)' }}
              strokeWidth="1.6"
            />
            <rect
              x="80"
              y="104"
              width="80"
              height="34"
              rx="4"
              style={{ fill: 'var(--color-surface)', stroke: 'var(--color-rule-strong)' }}
            />
            <text
              x="120"
              y="126"
              textAnchor="middle"
              fontSize="14"
              style={{ fill: 'var(--color-ink)' }}
            >
              8
            </text>
            <line
              x1="120"
              y1="138"
              x2="120"
              y2="160"
              style={{ stroke: 'var(--color-rule-strong)' }}
              strokeWidth="1.6"
            />
            <text
              x="120"
              y="176"
              textAnchor="middle"
              fontSize="12"
              fontFamily="monospace"
              style={{ fill: 'var(--color-ink-faint)' }}
            >
              null
            </text>
          </svg>
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
