import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { problemMap } from '../../lib/problemMaps';
import { ModeProvider } from '../../presentation';
import { ProblemMap, stateOf } from './ProblemMap';

const rows = (c: HTMLElement) =>
  [...c.querySelectorAll('tbody tr')].map((tr) => ({
    state: tr.getAttribute('data-state'),
    tool: tr.querySelectorAll('td')[2].textContent,
  }));
const count = (c: HTMLElement, state: string) => rows(c).filter((r) => r.state === state).length;

describe('stateOf', () => {
  const docs = ['a', 'b', 'c'];
  it('is here in its own document, solved after it, later before it', () => {
    expect(stateOf(docs, 'b', { question: '¿?', solvedIn: 'b', tool: 't' })).toBe('here');
    expect(stateOf(docs, 'c', { question: '¿?', solvedIn: 'b', tool: 't' })).toBe('solved');
    expect(stateOf(docs, 'a', { question: '¿?', solvedIn: 'b', tool: 't' })).toBe('later');
  });

  it('is open when no document solves it', () => {
    expect(stateOf(docs, 'a', { question: '¿?', tool: 't' })).toBe('open');
  });
});

describe('the grafos map, its single source', () => {
  const map = problemMap('grafos')!;

  it('exists', () => {
    expect(map).not.toBeNull();
  });

  it('names each of its documents once', () => {
    expect(new Set(map.docs).size).toBe(map.docs.length);
  });

  it('solves every solved problem in one of its own documents', () => {
    for (const p of map.problems) {
      if (p.solvedIn !== undefined) expect(map.docs, p.question).toContain(p.solvedIn);
    }
  });

  it('asks each question once, and gives each one a tool', () => {
    expect(new Set(map.problems.map((p) => p.question)).size).toBe(map.problems.length);
    for (const p of map.problems) expect(p.tool, p.question).not.toBe('');
  });
});

describe('ProblemMap', () => {
  it('shows every problem, from where the document stands', () => {
    const { container } = render(<ProblemMap map="grafos" at="grafos-representacion" />);
    expect(rows(container)).toHaveLength(15);
    expect(count(container, 'here')).toBe(3);
    expect(count(container, 'later')).toBe(6);
    expect(count(container, 'open')).toBe(6);
  });

  it('counts what an earlier document solved as solved', () => {
    const { container } = render(<ProblemMap map="grafos" at="grafos-recorridos" />);
    expect(count(container, 'solved')).toBe(3);
    expect(count(container, 'here')).toBe(4);
  });

  it('keeps the tool of a later problem to itself, and names an open one’s', () => {
    const { container } = render(<ProblemMap map="grafos" at="grafos-representacion" />);
    const all = rows(container);
    expect(all.filter((r) => r.state === 'later').every((r) => r.tool === '—')).toBe(true);
    expect(all.find((r) => r.state === 'open')!.tool).toBe('Bellman-Ford');
  });

  it('draws the same in the book and on a slide', () => {
    const book = render(
      <ModeProvider mode="book">
        <ProblemMap map="grafos" at="grafos-representacion" />
      </ModeProvider>,
    ).container.innerHTML;
    const slide = render(
      <ModeProvider mode="presentation">
        <ProblemMap map="grafos" at="grafos-representacion" />
      </ModeProvider>,
    ).container.innerHTML;
    expect(slide).toBe(book);
  });

  it('tells the author when the map does not exist', () => {
    const { container } = render(<ProblemMap map="nada" at="grafos-representacion" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });

  it('tells the author when the document is not one of the map’s', () => {
    const { container } = render(<ProblemMap map="grafos" at="edd-set-map" />);
    expect(container.querySelector('[data-authoring-error]')).not.toBeNull();
  });
});
