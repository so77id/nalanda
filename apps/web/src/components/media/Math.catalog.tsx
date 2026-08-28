import type { CatalogEntry } from '../../lib/catalogEntry';

import { MathTex } from './Math';

export const mathTexCatalogEntry: CatalogEntry = {
  name: 'Math',
  family: 'media',
  description:
    'A LaTeX math formula rendered at runtime by KaTeX. Authors of prose use `$...$` and `$$...$$` in MDX directly — rehype-katex handles those at build time. This component covers the OTHER path: JSX expression attributes like `<ComplexityExercise reveal={...}>`, where the reveal is JS code and rehype-katex never runs. The component is Suspense-wrapped so KaTeX (~260 kB) never enters the entry chunk; pages without a `<Math>` never pull it. Under the hood the component is `MathTex` — a name that avoids shadowing the JS global `Math` in TypeScript modules; the MDX map aliases it back to `<Math>` for course authors.',
  whenToUse:
    'Inside JSX expression props (a `reveal={...}` panel, a JSX children of a widget that computes JSX) when you need a KaTeX-rendered formula. In regular MDX prose you write `$...$` / `$$...$$` — rehype-katex renders those, and using `<Math>` there is a redundant runtime cost. ' +
    'NOT for iterative expression evaluation (`<Math>` renders a static formula; nothing animates or steps through it).',
  props: [
    {
      name: 'children',
      type: 'string',
      description:
        'The LaTeX source, as a plain string. Backslashes must be escaped when the string is a JS literal (`{"\\\\Theta(N)"}`).',
    },
    {
      name: 'block',
      type: 'boolean',
      description:
        "When true, render as display math (centered, own block). Same distinction as KaTeX's `displayMode`. Default false (inline).",
    },
  ],
  examples: [
    {
      title: 'Inline math (default)',
      code: `<Math>{'T(N) = T(N-1) + c'}</Math>`,
      render: () => <MathTex>{'T(N) = T(N-1) + c'}</MathTex>,
    },
    {
      title: 'Block math (centered, own block)',
      code: `<Math block>{'\\\\Theta(N)'}</Math>`,
      render: () => <MathTex block>{'\\Theta(N)'}</MathTex>,
    },
    {
      title: 'A piecewise function (as a reveal panel would use it)',
      code: `<Math block>{'T(N) = \\\\begin{cases} c & N = 1 \\\\\\\\ T(N-1) + c & N > 1 \\\\end{cases}'}</Math>`,
      render: () => (
        <MathTex block>
          {'T(N) = \\begin{cases} c & N = 1 \\\\ T(N-1) + c & N > 1 \\end{cases}'}
        </MathTex>
      ),
    },
  ],
};
