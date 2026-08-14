import { act, render, screen } from '@testing-library/react';
import { useRef } from 'react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useSections } from './useSections';

// jsdom lays nothing out: every rect is zero. Scrolling is therefore expressed
// the only way it can be — by stating where each heading sits relative to the
// viewport — and the reading band is derived from window.innerHeight, which jsdom
// does provide.
function placeHeadings(tops: Record<string, number>) {
  for (const [id, top] of Object.entries(tops)) {
    const heading = document.getElementById(id);
    if (!heading) throw new Error(`no heading #${id} to place`);
    heading.getBoundingClientRect = () => ({ top, bottom: top + 30 }) as DOMRect;
  }
}

function scroll() {
  act(() => {
    window.dispatchEvent(new Event('scroll'));
    // The handler defers to the next frame, so the frame has to happen.
    vi.advanceTimersByTime(20);
  });
}

// What `## Costo de $$\log_2 n$$` compiles to, trimmed to the three parts that
// matter: the MathML tree, the LaTeX annotation inside it, and the aria-hidden
// visual rendering.
const KATEX_HEADING =
  'Costo de <span class="katex">' +
  '<span class="katex-mathml"><math xmlns="http://www.w3.org/1998/Math/MathML"><semantics>' +
  '<mrow>log₂n</mrow><annotation encoding="application/x-tex">\\log_2 n</annotation>' +
  '</semantics></math></span>' +
  '<span class="katex-html" aria-hidden="true"><span class="base">log2n</span></span>' +
  '</span>';

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
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
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

  it('marks the section whose heading has passed the reading band', () => {
    render(<Harness>{ARTICLE}</Harness>);
    placeHeadings({ tipos: -400, memoria: 5000 });
    scroll();

    expect(items().map((li) => li.dataset['active'])).toEqual(['yes', 'no']);
  });

  it('moves the mark on when the next heading passes the band', () => {
    render(<Harness>{ARTICLE}</Harness>);
    placeHeadings({ tipos: -900, memoria: -100 });
    scroll();

    expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'yes']);
  });

  it('marks nothing above the first heading', () => {
    render(<Harness>{ARTICLE}</Harness>);
    placeHeadings({ tipos: 600, memoria: 5000 });
    scroll();

    expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'no']);
  });

  it('keeps the mark while the reader sits inside a long section', () => {
    // The defect this replaced: the first implementation asked an
    // IntersectionObserver "is a heading in the band", which is false for most
    // of a long section — so it fired on crossings only and the mark went out.
    // Measured in a browser on /d/java-desde-cpp: empty through 70% of the page.
    render(<Harness>{ARTICLE}</Harness>);
    placeHeadings({ tipos: -400, memoria: 5000 });
    scroll();

    placeHeadings({ tipos: -3000, memoria: 4000 });
    scroll();

    expect(items().map((li) => li.dataset['active'])).toEqual(['yes', 'no']);
  });

  it('marks a section on arrival, with no event of any kind dispatched', () => {
    // The reason `decide()` is called once on mount. Every other case in this
    // file dispatches a scroll, so deleting that call left all of them green —
    // and a #fragment deep link produces no scroll event to react to. The
    // positions are installed on the prototype BEFORE render, because the only
    // chance the mount-time call gets is the moment the effect runs.
    const tops: Record<string, number> = { tipos: -400, memoria: -200 };
    const original = Element.prototype.getBoundingClientRect;
    Element.prototype.getBoundingClientRect = function () {
      const top = tops[(this as HTMLElement).id];
      return (top === undefined ? { top: 0, bottom: 0 } : { top, bottom: top + 30 }) as DOMRect;
    };
    try {
      render(
        <Harness>
          <h2 id="tipos">Tipos</h2>
          <h2 id="memoria">Memoria</h2>
        </Harness>,
      );
      expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'yes']);
    } finally {
      Element.prototype.getBoundingClientRect = original;
    }
  });

  it('marks the right section after a jump, with no crossing to observe', () => {
    // A fragment link lands mid-document without a scroll event per heading.
    render(<Harness>{ARTICLE}</Harness>);
    placeHeadings({ tipos: -9000, memoria: -8000 });
    scroll();

    expect(items().map((li) => li.dataset['active'])).toEqual(['no', 'yes']);
  });

  it('reads a heading with a formula once, not three times', () => {
    // Verbatim KaTeX output rather than JSX — MathML has no JSX intrinsics, and
    // the markup is the thing under test. Three renderings of one formula:
    // MathML glyphs for assistive technology, an <annotation> carrying the
    // LaTeX source, and aria-hidden spans that draw it. Plain textContent
    // concatenates all three, so the rail read "Costo de log⁡2n\log_2 nlog2n"
    // (#118 review).
    render(
      <Harness>
        <h2 id="costo" dangerouslySetInnerHTML={{ __html: KATEX_HEADING }} />
      </Harness>,
    );

    expect(items().map((li) => li.textContent)).toEqual(['costo:Costo de log₂n']);
  });
});
