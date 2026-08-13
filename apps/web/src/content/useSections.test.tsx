import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSections } from './useSections';

// jsdom ships no IntersectionObserver. This fake records what was observed and
// lets a test say "these headings are in the band now" — the only part of
// scrolling the suite can express (the real thing is verified in a browser).
class FakeIntersectionObserver {
  static current: FakeIntersectionObserver | undefined;
  readonly targets = new Set<Element>();
  readonly callback: IntersectionObserverCallback;
  constructor(callback: IntersectionObserverCallback) {
    this.callback = callback;
    FakeIntersectionObserver.current = this;
  }
  observe(target: Element) {
    this.targets.add(target);
  }
  unobserve(target: Element) {
    this.targets.delete(target);
  }
  disconnect() {
    this.targets.clear();
  }
  /** Reports the given heading ids as intersecting and the rest as not. */
  reportVisible(ids: string[]) {
    const entries = [...this.targets].map((target) => ({
      target,
      isIntersecting: ids.includes(target.id),
    })) as unknown as IntersectionObserverEntry[];
    this.callback(entries, this as unknown as IntersectionObserver);
  }
}

function Harness({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const { sections, activeId } = useSections(ref);
  return (
    <>
      <div ref={ref}>{children}</div>
      <ul data-testid="sections">
        {sections.map((s) => (
          <li key={s.id} data-active={s.id === activeId ? 'yes' : 'no'}>
            {s.id}:{s.text}
          </li>
        ))}
      </ul>
    </>
  );
}

// The shape mdxHeading.tsx really produces: an id, and a self-anchor sibling of
// the heading text — before it in one case, after it in the other, because both
// orders have to survive.
const ARTICLE = (
  <>
    <h1>Java desde C++</h1>
    <h2 id="tipos" className="group">
      <a href="#tipos">#</a>Tipos
    </h2>
    <p>prosa</p>
    <h3 id="detalle">Detalle</h3>
    <h2 id="memoria" className="group">
      Memoria<a href="#memoria">#</a>
    </h2>
  </>
);

function items() {
  return [...screen.getByTestId('sections').querySelectorAll('li')];
}

beforeEach(() => {
  vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
});

afterEach(() => {
  vi.unstubAllGlobals();
  FakeIntersectionObserver.current = undefined;
});

describe('useSections', () => {
  it('lists the h2 headings of the rendered article, in document order', () => {
    render(<Harness>{ARTICLE}</Harness>);
    expect(items().map((li) => li.textContent)).toEqual(['tipos:Tipos', 'memoria:Memoria']);
  });

  it('leaves the self-anchor out of the section text, wherever it sits', () => {
    render(<Harness>{ARTICLE}</Harness>);
    // The marker is a sibling of the heading text (mdxHeading.tsx), so a naive
    // textContent reads "Tipos#" and the rail grows a column of hashes.
    expect(items().map((li) => li.textContent)).not.toContain('tipos:Tipos#');
  });

  it('ignores headings below h2 — the section spine is h2 (ADR)', () => {
    render(<Harness>{ARTICLE}</Harness>);
    expect(items().map((li) => li.textContent)).not.toContainEqual(
      expect.stringContaining('detalle'),
    );
  });

  it('ignores an h2 the slugger could not give an id, since it cannot be linked', () => {
    render(
      <Harness>
        <h2>???</h2>
        <h2 id="real">Real</h2>
      </Harness>,
    );
    expect(items()).toHaveLength(1);
  });

  it('picks up headings that arrive after the first render', async () => {
    // The document loads lazily behind Suspense: on the first paint the article
    // is empty, and an effect that only ran once would leave the rail empty too.
    const { rerender } = render(
      <Harness>
        <h2 id="uno">Uno</h2>
      </Harness>,
    );
    expect(items()).toHaveLength(1);

    await act(async () => {
      rerender(
        <Harness>
          <h2 id="uno">Uno</h2>
          <h2 id="dos">Dos</h2>
        </Harness>,
      );
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    expect(items().map((li) => li.textContent)).toEqual(['uno:Uno', 'dos:Dos']);
  });

  it('marks the heading that entered the reading band as active', () => {
    render(<Harness>{ARTICLE}</Harness>);
    act(() => FakeIntersectionObserver.current!.reportVisible(['memoria']));
    expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'yes']);
  });

  it('keeps the topmost of several headings sharing the band', () => {
    render(<Harness>{ARTICLE}</Harness>);
    act(() => FakeIntersectionObserver.current!.reportVisible(['tipos', 'memoria']));
    expect(items().map((li) => li.dataset['active'])).toEqual(['yes', 'no']);
  });

  it('keeps the last active heading while scrolling through a long section', () => {
    // Mid-section nothing is in the band. Clearing the mark there would blink
    // the rail off for most of the time a reader spends in a section.
    render(<Harness>{ARTICLE}</Harness>);
    act(() => FakeIntersectionObserver.current!.reportVisible(['memoria']));
    act(() => FakeIntersectionObserver.current!.reportVisible([]));
    expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'yes']);
  });

  it('survives a browser without IntersectionObserver instead of blanking the page', () => {
    vi.stubGlobal('IntersectionObserver', undefined);
    render(<Harness>{ARTICLE}</Harness>);
    expect(items()).toHaveLength(2);
    expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'no']);
  });
});
