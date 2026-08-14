import { evaluate } from '@mdx-js/mdx';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as runtime from 'react/jsx-runtime';
import { describe, expect, it } from 'vitest';

import { contentMdxComponents } from './mdxComponents';
import { remarkPlugins } from './mdxPlugins';
import { rehypePlugins } from './rehypePlugins';

/**
 * Compiles and renders MDX through the *same* plugin list the build uses.
 *
 * Every other test in this folder drives a plugin's transform directly, which
 * says nothing about what a document turns into. This is the only place that
 * answers "what does an author actually get".
 */
async function renderMdx(source: string): Promise<HTMLElement> {
  const { default: Content } = await evaluate(source, { ...runtime, remarkPlugins, rehypePlugins });
  // Through the real component map, and inside a router: wiki links render
  // react-router `Link`s, and a document is never rendered outside one.
  return render(
    <MemoryRouter>
      <Content components={contentMdxComponents} />
    </MemoryRouter>,
  ).container;
}

const TABLE = `
| Palabra | Qué dice |
|---|---|
| public | Se puede llamar desde fuera |
| static | Pertenece a la clase |
`;

describe('the MDX pipeline', () => {
  it('turns a markdown table into a table', async () => {
    const container = await renderMdx(TABLE);

    // Without GFM, CommonMark has no table syntax and the whole block arrives as
    // one paragraph of literal pipes — which is what the published Java document
    // shipped: 0 tables, 4 pipe paragraphs, from 4 tables of reference material.
    const table = container.querySelector('table');
    expect(table, 'the table rendered as prose, not as a table').not.toBeNull();
    expect(table?.querySelectorAll('th')).toHaveLength(2);
    expect(table?.querySelectorAll('tbody tr')).toHaveLength(2);
    expect(container.textContent).not.toContain('|---|');
  });

  it('lets a wide table scroll on its own instead of widening the page', async () => {
    const container = await renderMdx(TABLE);

    // Measured at 390px before this existed: the page overflowed by 340px, up
    // from 108px, because a table has a minimum content width where the
    // paragraph of pipes it replaced simply wrapped. The page must never be the
    // thing that scrolls sideways.
    const scroller = container.querySelector('table')?.parentElement;
    expect(scroller?.className).toContain('overflow-x-auto');
  });

  it('renders the tables of the shipped Java document', async () => {
    // The real thing, not a fixture: this file is why the WP exists.
    const source = readFileSync(
      join(process.cwd(), '../../content/courses/sample-course/06-java-desde-cpp.mdx'),
      'utf8',
    );
    // Only the tables are under test here; the document's components are not the
    // pipeline's business. Non-table lines are blanked rather than dropped —
    // dropping them glues consecutive tables into one, which is a bug in the test
    // and looks exactly like a bug in the code.
    const tables = source
      .split('\n')
      .map((line) => (line.startsWith('|') ? line : ''))
      .join('\n');

    const container = await renderMdx(tables);

    // A count, not a floor: the document has exactly four tables, and a floor
    // that happens to equal the real number proves nothing about either.
    expect(container.querySelectorAll('table')).toHaveLength(4);
  });

  it('still keeps a fence meta as a data attribute', async () => {
    const container = await renderMdx('```java starter\nint x = 1;\n```\n');

    // GFM arriving must not disturb what Exercise reads its fences by (ADR-0019).
    expect(container.querySelector('code')?.getAttribute('data-meta')).toBe('starter');
  });

  it('still renders a wiki link', async () => {
    const container = await renderMdx('Ver [[busqueda-binaria]].\n');

    expect(container.querySelector('a')).not.toBeNull();
  });

  it('turns inline mathematics into mathematics', async () => {
    const container = await renderMdx('Hay a lo más $$\\log_2(n) + 1$$ iteraciones.\n');

    // Without remark-math the dollars are literal text and the subscript is
    // whatever the author could type — which is what the shipped binary-search
    // document says today, `log₂(n) + 1` in hand-typed Unicode.
    expect(
      container.querySelector('.katex'),
      'the formula stayed literal text instead of becoming mathematics',
    ).not.toBeNull();
    expect(container.textContent).not.toContain('$');
  });

  it('gives a display formula its own block, not a line of prose', async () => {
    const container = await renderMdx('La nota de presentación:\n\n$$\nN_p = 0{,}25\\,S_1\n$$\n');

    // The delimiters go on their OWN lines, like a code fence. `$$formula$$` on
    // a single line is *inline* math that merely looks like a block in the
    // source — measured, after this test was first written the wrong way round.
    // Worth pinning precisely because the mistake produces something that
    // renders, just not where the author meant.
    expect(
      container.querySelector('.katex-display'),
      'the display formula rendered inline, in the middle of the sentence',
    ).not.toBeNull();
  });

  it('leaves a lone dollar sign alone', async () => {
    const container = await renderMdx('El servidor cuesta $200 al mes, el otro $350.\n');

    // The reason `singleDollarTextMath: false` exists in the plugin list, and
    // the case that put it there. With single dollars enabled this exact
    // sentence renders "200 al mes, el otro" as a formula — measured, not
    // feared — and the opening class has it on the cloud-cost slide. An author
    // writing prose about prices never opted into mathematics and must not be
    // able to trip over it.
    expect(container.querySelector('.katex'), 'prices were parsed as mathematics').toBeNull();
    expect(container.textContent).toContain('$200');
    expect(container.textContent).toContain('$350');
  });

  it('gives a formula a MathML tree, not only a visual one', async () => {
    const container = await renderMdx('Hay a lo más $$\\log_2(n) + 1$$ iteraciones.\n');

    // KaTeX emits both: spans that look right, and MathML that a screen reader
    // can read. Asserted separately because dropping the second is invisible on
    // screen and total for anyone not looking at one — and the page is served
    // lang="es", so this is the same class of defect documentShell.test.ts
    // guards for accessible names.
    expect(container.querySelector('math'), 'no MathML for assistive technology').not.toBeNull();
    expect(container.querySelector('.katex-html'), 'no visual rendering').not.toBeNull();
  });
});
