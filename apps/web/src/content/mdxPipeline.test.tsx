import { evaluate } from '@mdx-js/mdx';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as runtime from 'react/jsx-runtime';
import { describe, expect, it } from 'vitest';

import { contentMdxComponents } from './mdxComponents';
import { remarkPlugins } from './mdxPlugins';

// The two documents of the Java unit (#107 split it in two). This list is
// duplicated in app/documentFences.test.tsx on purpose, NOT shared. A
// cross-feature test import would be legal (architecture.test.ts:145 exempts
// `.test.` files from the seam), so this is a deliberate choice, not a
// constraint: a two-element filename list is not worth a shared test-util module.
const JAVA_DOCS = ['06-java-desde-cpp.mdx', '07-java-tipos-y-flujo.mdx'];

/**
 * Compiles and renders MDX through the *same* plugin list the build uses.
 *
 * Every other test in this folder drives a plugin's transform directly, which
 * says nothing about what a document turns into. This is the only place that
 * answers "what does an author actually get".
 */
async function renderMdx(source: string): Promise<HTMLElement> {
  const { default: Content } = await evaluate(source, { ...runtime, remarkPlugins });
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

  it('renders the tables of the shipped Java documents', async () => {
    // The real thing, not a fixture: these files are why the WP exists. #107
    // split the Java material in two, moving three of the four tables into the
    // second document; reading only the first would assert against a count the
    // split invalidated. Both are read so the four tables of the unit are covered
    // wherever they now live (AC10).
    const source = JAVA_DOCS.map((file) =>
      readFileSync(join(process.cwd(), '../../content/courses/sample-course/', file), 'utf8'),
    ).join('\n');
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
});
