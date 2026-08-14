import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { Toc } from './Toc';
import { parseCourseIndex } from './courseIndex';
import { registry } from './liveContent';

// The cases below use a real document as the label-less entry, so they assert a
// title that belongs to the course rather than to the test — and course titles
// move (#120 renamed this one). Named here rather than repeated inline, with the
// guard case below turning "the title changed" into a message that says so
// instead of four `getByRole` misses.
const BIENVENIDA_TITLE = 'Estructuras de Datos y Algoritmos';

const index = parseCourseIndex(
  [
    'entries:',
    '  - label: Introducción',
    '    levelName: Unidad',
    '    children:',
    '      - docId: bienvenida',
    '  - docId: doc-without-label',
  ].join('\n'),
  'index.yaml',
);

function renderToc(at: string) {
  render(
    <MemoryRouter initialEntries={[at]}>
      <Toc index={index} />
    </MemoryRouter>,
  );
}

// Deeper than the sample course's two levels: the bug this guards against —
// "expand the parent" instead of "expand every ancestor" — is invisible at two.
const deepIndex = parseCourseIndex(
  [
    'entries:',
    '  - docId: portada',
    '  - label: Estructuras lineales',
    '    levelName: Unidad',
    '    children:',
    '      - label: Listas',
    '        children:',
    '          - docId: hoja-profunda',
    '      - label: Pilas',
    '        children:',
    '          - docId: otra-hoja',
    '  - label: Grafos',
    '    children:',
    '      - docId: lejos',
  ].join('\n'),
  'index.yaml',
);

/**
 * Labels of the currently open groups. The levelName is dropped by removing its
 * element, not by stripping a prefix: a regex that ate a leading "Unidad" also
 * ate it from labels that legitimately start with the word.
 */
function openGroups(): string[] {
  return [...document.querySelectorAll('details[open] > summary')].map((summary) => {
    const label = summary.querySelector('span')!.cloneNode(true) as HTMLElement;
    label.querySelector('span')?.remove();
    return (label.textContent ?? '').trim();
  });
}

describe('Toc expand policy', () => {
  it('collapses every group when the reader is not inside one', () => {
    render(
      <MemoryRouter initialEntries={['/d/portada']}>
        <Toc index={deepIndex} activeId="portada" />
      </MemoryRouter>,
    );
    expect(openGroups()).toEqual([]);
  });

  it('opens every ancestor of the current document, not only its parent', () => {
    render(
      <MemoryRouter initialEntries={['/d/hoja-profunda']}>
        <Toc index={deepIndex} activeId="hoja-profunda" />
      </MemoryRouter>,
    );
    expect(openGroups()).toEqual(['Estructuras lineales', 'Listas']);
  });

  it('leaves the siblings of the path closed', () => {
    render(
      <MemoryRouter initialEntries={['/d/hoja-profunda']}>
        <Toc index={deepIndex} activeId="hoja-profunda" />
      </MemoryRouter>,
    );
    expect(openGroups()).not.toContain('Pilas');
    expect(openGroups()).not.toContain('Grafos');
  });

  it('lets the reader open a group the path did not open', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={['/d/portada']}>
        <Toc index={deepIndex} activeId="portada" />
      </MemoryRouter>,
    );

    await user.click(screen.getByText('Grafos'));
    expect(openGroups()).toContain('Grafos');
  });

  it('keeps what the reader opened when the parent re-renders for its own reasons', async () => {
    // The index arrives EQUAL BUT NEW on every render — the observable form of
    // "React dropped a useMemo cache", which is the only thing that made the
    // old identity-keyed model work. Re-rendering with the same object passes
    // either way, so it proves nothing; this is the shape that fails when the
    // key goes back to an identity.
    const user = userEvent.setup();
    const yaml = [
      'entries:',
      '  - docId: portada',
      '  - label: Grafos',
      '    children:',
      '      - docId: lejos',
    ].join('\n');
    function Parent() {
      const [tick, setTick] = useState(0);
      return (
        <MemoryRouter initialEntries={['/d/portada']}>
          <button onClick={() => setTick(tick + 1)}>re-render</button>
          <span>{tick}</span>
          <Toc index={parseCourseIndex(yaml, 'index.yaml')} activeId="portada" />
        </MemoryRouter>
      );
    }
    render(<Parent />);

    await user.click(screen.getByText('Grafos'));
    expect(openGroups()).toContain('Grafos');

    await user.click(screen.getByRole('button', { name: 're-render' }));
    expect(openGroups()).toContain('Grafos');
  });

  it('forgets what the reader opened once they are reading somewhere else', async () => {
    const user = userEvent.setup();
    const { rerender } = render(
      <MemoryRouter initialEntries={['/d/portada']}>
        <Toc index={deepIndex} activeId="portada" />
      </MemoryRouter>,
    );
    await user.click(screen.getByText('Grafos'));
    expect(openGroups()).toContain('Grafos');

    rerender(
      <MemoryRouter initialEntries={['/d/otra-hoja']}>
        <Toc index={deepIndex} activeId="otra-hoja" />
      </MemoryRouter>,
    );

    // The new document's path opens; the old manual toggle is gone.
    expect(openGroups()).toEqual(['Estructuras lineales', 'Pilas']);
  });

  it('opens the group of a document that IS a group, so its mark is visible', () => {
    // A unit with a cover page: the aria-current link lives inside the group's
    // own <details>, so leaving it shut hides the only "you are here" there is.
    const withCover = parseCourseIndex(
      [
        'entries:',
        '  - label: Unidad con portada',
        '    docId: portada-unidad',
        '    children:',
        '      - docId: hijo',
      ].join('\n'),
      'index.yaml',
    );
    render(
      <MemoryRouter initialEntries={['/d/portada-unidad']}>
        <Toc index={withCover} activeId="portada-unidad" />
      </MemoryRouter>,
    );

    expect(openGroups()).toEqual(['Unidad con portada']);
  });

  it('reaches a document inside a group that starts collapsed', () => {
    // Collapsed is not hidden: <details> keeps its children in the DOM, so the
    // links are still there for a filter to surface and for the browser to find.
    render(
      <MemoryRouter initialEntries={['/d/portada']}>
        <Toc index={deepIndex} activeId="portada" />
      </MemoryRouter>,
    );
    expect(screen.getByRole('link', { name: 'lejos' })).toBeInTheDocument();
  });
});

describe('Toc filter', () => {
  function renderDeep() {
    render(
      <MemoryRouter initialEntries={['/d/portada']}>
        <Toc index={deepIndex} activeId="portada" />
      </MemoryRouter>,
    );
    return userEvent.setup();
  }

  function filterField() {
    return screen.getByRole('searchbox', { name: /filtrar/i });
  }

  it('offers a named field a keyboard can reach', async () => {
    const user = renderDeep();
    await user.tab();
    expect(filterField()).toHaveFocus();
  });

  it('narrows the tree to what matches, dropping the rest', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'lejos');

    expect(screen.getByRole('link', { name: 'lejos' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'portada' })).not.toBeInTheDocument();
  });

  it('keeps the ancestors of a match visible, so the result has a place', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'hoja-profunda');

    expect(screen.getByText('Estructuras lineales')).toBeInTheDocument();
    expect(screen.getByText('Listas')).toBeInTheDocument();
    expect(screen.queryByText('Grafos')).not.toBeInTheDocument();
  });

  it('opens the groups it kept — a match behind a closed triangle is not a result', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'hoja-profunda');

    expect(openGroups()).toEqual(['Estructuras lineales', 'Listas']);
  });

  it('says how many documents matched', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'profunda');

    expect(screen.getByRole('status')).toHaveTextContent(/^1 documento$/i);
  });

  it('counts in the plural when more than one matched', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'hoja');

    expect(screen.getByRole('status')).toHaveTextContent(/^2 documentos$/i);
  });

  it('answers instead of showing an empty panel when nothing matches', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'zzzz');

    expect(screen.getByRole('status')).toHaveTextContent(/nada|ningún/i);
    expect(screen.queryAllByRole('link')).toHaveLength(0);
  });

  it('lets the reader shut a group mid-filter, and remembers it', async () => {
    // Returning early from onToggle while filtering left the controlled
    // <details> and the DOM disagreeing: React kept rendering open={true} on a
    // node the browser had shut, so it never reopened.
    //
    // Asserting the DOM right after the click cannot see that — a component
    // that recorded nothing renders the same open={true} and leaves the shut
    // node alone. What distinguishes the two is whether the model AGREES: a
    // re-render that changes nothing else must not reopen the group.
    const user = renderDeep();
    await user.type(filterField(), 'hoja');
    expect(openGroups()).toContain('Estructuras lineales');

    await user.click(screen.getByText('Estructuras lineales'));
    expect(openGroups()).not.toContain('Estructuras lineales');

    // Re-render with the query unchanged (a character typed and removed).
    await user.type(filterField(), 'x');
    await user.keyboard('{Backspace}');
    expect(openGroups()).not.toContain('Estructuras lineales');
  });

  it('opens the kept groups again when the query changes', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'hoja');
    await user.click(screen.getByText('Estructuras lineales'));
    expect(openGroups()).not.toContain('Estructuras lineales');

    // A new query is a new answer; the previous collapse does not carry over,
    // or the count would keep reporting matches the tree refuses to show.
    await user.type(filterField(), '-profunda');
    expect(openGroups()).toContain('Estructuras lineales');
  });

  it('restores the collapsed-plus-active-path tree when cleared', async () => {
    const user = renderDeep();
    await user.type(filterField(), 'hoja-profunda');
    expect(openGroups()).toHaveLength(2);

    await user.clear(filterField());

    expect(openGroups()).toEqual([]);
    expect(screen.getByRole('link', { name: 'lejos' })).toBeInTheDocument();
  });
});

describe('Toc', () => {
  it('still describes the document these cases label themselves with', () => {
    expect(
      registry.get('bienvenida')?.meta.title,
      `bienvenida's title moved. Update BIENVENIDA_TITLE at the top of this file — the cases below look their link up by that name, and without this guard they fail as four unrelated "unable to find a link" errors.`,
    ).toBe(BIENVENIDA_TITLE);
  });

  it('renders groups and document links following the index nesting', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByText('Introducción')).toBeInTheDocument();
    const link = screen.getByRole('link', { name: BIENVENIDA_TITLE });
    expect(link).toHaveAttribute('href', '/d/bienvenida');
  });

  it('labels a label-less entry with the registry title of its document', () => {
    renderToc('/d/bienvenida');
    // The bienvenida entry has no label: the title can only come from the registry.
    expect(screen.getByRole('link', { name: BIENVENIDA_TITLE })).toBeInTheDocument();
  });

  it('names a group that has children and a docId but no label of its own', () => {
    // parseEntry accepts it (the label is only required when there is no
    // docId), and rendering entry.label raw gave a summary with a chevron and
    // no name — while the filter still matched it by the registry title.
    const withCover = parseCourseIndex(
      ['entries:', '  - docId: bienvenida', '    children:', '      - docId: otro'].join('\n'),
      'index.yaml',
    );
    render(
      <MemoryRouter initialEntries={['/d/bienvenida']}>
        <Toc index={withCover} activeId="bienvenida" />
      </MemoryRouter>,
    );

    expect(document.querySelector('summary')?.textContent?.trim()).not.toBe('');
  });

  it('falls back to the raw id when the document is not in the registry', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByRole('link', { name: 'doc-without-label' })).toBeInTheDocument();
  });

  it('uses a lucide marker, not the browser default triangle', () => {
    renderToc('/d/bienvenida');
    const summary = screen.getByText('Introducción').closest('summary')!;
    expect(summary.querySelector('svg'), 'no icon in the summary').not.toBeNull();
    // The default marker is drawn by list-style; left on, the page shows two.
    expect(summary.className).toContain('list-none');
  });

  it('keeps the marker in its own column, so a wrapped label keeps one left edge', () => {
    renderToc('/d/bienvenida');
    const summary = screen.getByText('Introducción').closest('summary')!;
    const marker = summary.querySelector('svg')!;
    const label = screen.getByText('Introducción');

    // The defect: with the marker as an inline sibling of a bare text node, the
    // second line of a long label starts UNDER the triangle, left of the
    // label's own first line. The text must live in its own box.
    expect(label.contains(marker)).toBe(false);
    expect(marker.parentElement).not.toBe(label);
    expect(summary.className).toContain('flex');
    expect(marker.getAttribute('class') ?? '').toContain('shrink-0');
  });

  it('indents children behind a guide line, deep enough to read as nesting', () => {
    renderToc('/d/bienvenida');
    const link = screen.getByRole('link', { name: BIENVENIDA_TITLE });
    const indent = link.closest('div')!;
    // 16px (ml-3 + pl-1) was measured too shallow to read as nesting once
    // labels wrap — and these labels wrap.
    expect(indent.className).toMatch(/border-l/);
    expect(indent.className).toMatch(/pl-4/);
  });

  it('marks the current document link', () => {
    renderToc('/d/bienvenida');
    expect(screen.getByRole('link', { name: BIENVENIDA_TITLE })).toHaveAttribute(
      'aria-current',
      'page',
    );
  });
});
