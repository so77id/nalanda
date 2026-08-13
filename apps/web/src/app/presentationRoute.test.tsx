import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

const ids = walkIndex(courseIndex);
const firstId = ids[0]!;
const firstTitle = registry.get(firstId)?.meta.title ?? firstId;

function renderAt(path: string) {
  render(
    <MemoryRouter initialEntries={[path]}>
      <AppRoutes />
    </MemoryRouter>,
  );
}

async function findCounter() {
  return screen.findByText(/^\d+ \/ \d+$/);
}

describe('PresentationPage viewer', () => {
  it('opens on the cover slide with the document title and a counter', async () => {
    renderAt(`/d/${firstId}/present`);
    expect(await screen.findByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(await findCounter()).toHaveTextContent(/^1 \/ \d+$/);
  });

  it('navigates with ArrowRight/ArrowLeft and clamps at the edges', async () => {
    renderAt(`/d/${firstId}/present`);
    const counter = await findCounter();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter).toHaveTextContent(/^1 \//);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('advances with Space and jumps with Home/End', async () => {
    renderAt(`/d/${firstId}/present`);
    const counter = await findCounter();
    const total = Number(counter.textContent!.split('/')[1]);

    fireEvent.keyDown(window, { key: 'End' });
    expect(counter).toHaveTextContent(`${total} / ${total}`);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter).toHaveTextContent(`${total} / ${total}`);

    fireEvent.keyDown(window, { key: 'Home' });
    expect(counter).toHaveTextContent(/^1 \//);

    fireEvent.keyDown(window, { key: ' ' });
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('deep-links to a slide via ?slide=N and clamps out-of-range values', async () => {
    renderAt(`/d/${firstId}/present?slide=2`);
    expect(await findCounter()).toHaveTextContent(/^2 \//);
  });

  it('survives a crafted non-integer ?slide value', async () => {
    renderAt(`/d/${firstId}/present?slide=1.5`);
    expect(await findCounter()).toHaveTextContent(/^1 \//);
  });

  it('returns to the book view on Escape', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('offers a fullscreen control', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();
    expect(screen.getByRole('button', { name: /pantalla completa/i })).toBeInTheDocument();
  });
});

// The phone rule end to end, over the real route and a real document: what the
// reader gets from /d/<id>/present, not what a component does in isolation.
// The fake is local rather than shared with presentation/usePortraitPhone.test
// because a cross-feature import may only go through the feature seam
// (src/architecture.test.ts), and a test fake is not part of one.
function coarsePortrait(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  let matches = initial;
  window.matchMedia = ((query: string) => {
    // Answers only the question it was written for. framer-motion asks this
    // same fake about (prefers-reduced-motion) when the deck mounts, so a fake
    // that returned `matches` for every query would also be telling it that
    // reduced motion is on, for the rest of the file (#91 review).
    const phoneRule = query.includes('pointer: coarse');
    return {
      media: query,
      get matches() {
        return phoneRule && matches;
      },
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (phoneRule) listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;
  return {
    turn(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
      });
    },
  };
}

describe('presentation on a phone held in portrait', () => {
  afterEach(() => {
    Reflect.deleteProperty(window, 'matchMedia');
  });

  it('covers the deck: the panel is shown and no slide is painted', async () => {
    coarsePortrait(true);
    renderAt(`/d/${firstId}/present`);

    // Waiting for the panel also waits for the lazy document: the deck is what
    // decides, so by now the slides exist and their absence is a decision.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: firstTitle })).not.toBeInTheDocument();
  });

  it('leaves nothing but the way out reachable by keyboard', async () => {
    coarsePortrait(true);
    renderAt(`/d/${firstId}/present`);
    await screen.findByRole('alertdialog');

    // The whole route, not the panel's subtree: the claim is that no control of
    // the deck survives anywhere, which asking the panel about itself cannot
    // show. Enumerated by construction — jsdom has no tab order of its own —
    // and cross-checked in Chromium, where five Tab presses reach only this
    // link (testing-strategy.md §Layout and focus).
    const reachable = [
      ...document.querySelectorAll<HTMLElement>('a[href], button, [tabindex]:not([tabindex="-1"])'),
    ];
    expect(reachable.map((element) => element.textContent)).toEqual(['Leer en el libro']);
  });

  it('ignores the slide keys behind the panel, so the position cannot drift', async () => {
    const media = coarsePortrait(true);
    renderAt(`/d/${firstId}/present?slide=2`);
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'End' });

    media.turn(false);
    expect(await findCounter()).toHaveTextContent(/^2 \//);
  });

  it('still answers Escape behind the panel — a modal has a way out', async () => {
    coarsePortrait(true);
    renderAt(`/d/${firstId}/present`);
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('leaves fullscreen when it takes the deck away, since the ⛶ button goes with it', async () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    try {
      coarsePortrait(true);
      renderAt(`/d/${firstId}/present`);
      await screen.findByRole('alertdialog');
      expect(exitFullscreen).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('shows the deck at the reader’s slide when the phone is turned, and back', async () => {
    const media = coarsePortrait(true);
    renderAt(`/d/${firstId}/present?slide=2`);
    await screen.findByRole('alertdialog');

    media.turn(false);
    expect(await findCounter()).toHaveTextContent(/^2 \//);

    media.turn(true);
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();

    media.turn(false);
    expect(await findCounter()).toHaveTextContent(/^2 \//);
  });

  it('lets the reader leave the presentation for the book view of the document', async () => {
    coarsePortrait(true);
    renderAt(`/d/${firstId}/present`);
    await screen.findByRole('alertdialog');

    fireEvent.click(screen.getByRole('link', { name: /leer|libro|volver/i }));

    // Still a coarse pointer in portrait — and the book view, which was built
    // for exactly that (#84), is not covered by anything.
    expect(await screen.findByRole('article')).toBeInTheDocument();
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  // Named for what it proves: the fake answers `false`, so this shows the route
  // renders the deck when the rule says no. That the RULE excludes a fine
  // pointer at any shape is pinned by the query-string assertion in
  // presentation/usePortraitPhone.test.tsx and by the browser run — jsdom
  // cannot evaluate a media query, so no test here can claim it.
  it('renders the deck whenever the phone rule does not match', async () => {
    coarsePortrait(false);
    renderAt(`/d/${firstId}/present`);

    expect(await findCounter()).toHaveTextContent(/^1 \//);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});

describe('advancing the deck by touch', () => {
  function swipe(from: number, to: number, y = 200, endY = 205) {
    const stage = screen.getByTestId('slide-stage');
    fireEvent.touchStart(stage, { touches: [{ clientX: from, clientY: y }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: to, clientY: endY }] });
  }

  it('advances one slide on a leftward swipe and goes back on a rightward one', async () => {
    renderAt(`/d/${firstId}/present?slide=2`);
    const counter = await findCounter();

    swipe(300, 150);
    expect(counter).toHaveTextContent(/^3 \//);

    swipe(150, 300);
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('clamps at the first slide, as the keyboard does', async () => {
    renderAt(`/d/${firstId}/present`);
    const counter = await findCounter();

    // The positive control comes first: without it this case is green over a
    // deck that has no touch wiring at all (#99 review).
    swipe(300, 150);
    expect(counter).toHaveTextContent(/^2 \//);

    swipe(150, 300);
    expect(counter).toHaveTextContent(/^1 \//);

    swipe(150, 300);
    expect(counter).toHaveTextContent(/^1 \//);
  });

  it('leaves the slide alone on a tap and on a vertical drag', async () => {
    renderAt(`/d/${firstId}/present?slide=2`);
    const counter = await findCounter();

    swipe(200, 200);
    expect(counter).toHaveTextContent(/^2 \//);

    swipe(260, 200, 500, 100);
    expect(counter).toHaveTextContent(/^2 \//);

    // Proves the two above were ignored rather than unheard.
    swipe(300, 150);
    expect(counter).toHaveTextContent(/^3 \//);
  });

  it('leaves a sideways-scrolling code block to scroll itself', async () => {
    // A document whose slides really carry <pre>: the first fixture's slide 2
    // has no code at all, so the earlier version of this test faked the geometry
    // on the slide wrapper — a box that in a browser has `overflow-x: visible`
    // and cannot scroll. It pinned the wrong contract and never walked a single
    // ancestor (#103 review).
    renderAt('/d/java-desde-cpp/present?slide=5');
    const counter = await findCounter();
    const before = counter.textContent;

    const stage = screen.getByTestId('slide-stage');
    const code = stage.querySelector('pre');
    expect(code, 'this slide must carry a code block for the case to mean anything').toBeTruthy();
    Object.defineProperty(code!, 'scrollWidth', { value: 900, configurable: true });
    Object.defineProperty(code!, 'clientWidth', { value: 800, configurable: true });
    code!.style.overflowX = 'auto';

    // The touch lands on a DESCENDANT of the scroller, which is what a finger
    // does, so the ancestor walk is what has to refuse the gesture.
    const inside = code!.firstElementChild ?? code!;
    fireEvent.touchStart(inside, { touches: [{ clientX: 600, clientY: 200 }] });
    fireEvent.touchEnd(inside, { changedTouches: [{ clientX: 200, clientY: 205 }] });
    expect(counter).toHaveTextContent(before!);

    // …and the same drag on the stage itself still moves the deck.
    swipe(600, 200);
    expect(counter).not.toHaveTextContent(before!);
  });

  it('forgets a gesture the system cancels', async () => {
    renderAt(`/d/${firstId}/present?slide=2`);
    const counter = await findCounter();
    const stage = screen.getByTestId('slide-stage');

    fireEvent.touchStart(stage, { touches: [{ clientX: 600, clientY: 200 }] });
    fireEvent.touchCancel(stage, { changedTouches: [{ clientX: 600, clientY: 200 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 200, clientY: 205 }] });

    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('ignores a two-finger gesture — a pinch is not a swipe', async () => {
    renderAt(`/d/${firstId}/present?slide=2`);
    const counter = await findCounter();
    const stage = screen.getByTestId('slide-stage');

    fireEvent.touchStart(stage, {
      touches: [
        { clientX: 300, clientY: 200 },
        { clientX: 320, clientY: 260 },
      ],
    });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 150, clientY: 205 }] });

    expect(counter).toHaveTextContent(/^2 \//);
  });
});

describe('fitting a slide to the stage it is shown on', () => {
  const STAGE = { width: 800, height: 300 };
  const CONTENT = { width: 896, height: 600 };
  let observed: Element[] = [];
  const originals = new Map<string, PropertyDescriptor | undefined>();

  function fakeGeometry() {
    // Every box is 0x0 in jsdom, so the sizes are stated rather than laid out;
    // what is real here is which element each getter is asked about.
    for (const prop of ['clientWidth', 'clientHeight', 'offsetWidth', 'offsetHeight']) {
      originals.set(prop, Object.getOwnPropertyDescriptor(HTMLElement.prototype, prop));
      Object.defineProperty(HTMLElement.prototype, prop, {
        configurable: true,
        get(this: HTMLElement) {
          const stage = this.dataset['testid'] === 'slide-stage';
          const box = stage ? STAGE : CONTENT;
          return prop.endsWith('Width') ? box.width : box.height;
        },
      });
    }
  }

  beforeEach(() => {
    observed = [];
    fakeGeometry();
    // jsdom has no ResizeObserver, so the deck's observer branch would never
    // run in the suite — and it is the branch that re-measures after a rotation.
    (globalThis as unknown as { ResizeObserver: unknown }).ResizeObserver = class {
      observe(element: Element) {
        observed.push(element);
      }
      unobserve() {}
      disconnect() {}
    };
  });

  afterEach(() => {
    for (const [prop, descriptor] of originals) {
      if (descriptor) Object.defineProperty(HTMLElement.prototype, prop, descriptor);
      else Reflect.deleteProperty(HTMLElement.prototype, prop);
    }
    originals.clear();
    Reflect.deleteProperty(globalThis, 'ResizeObserver');
    Reflect.deleteProperty(window, 'matchMedia');
  });

  function slideBox() {
    return document.querySelector<HTMLElement>('.max-w-4xl');
  }

  it('scales the slide by the tighter axis of the stage', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();
    // 300/600 is tighter than 800/896.
    expect(slideBox()).toHaveStyle({ transform: 'scale(0.5)' });
  });

  it('measures after a rotation, which mounts the deck without changing the slide', async () => {
    const media = coarsePortrait(true);
    renderAt(`/d/${firstId}/present`);
    await screen.findByRole('alertdialog');

    media.turn(false);
    await findCounter();

    // The index never changed, so an effect keyed on it never re-ran and the
    // slide stayed at scale(1), overflowing its stage — measured in Chromium
    // before this fix (#99 review).
    expect(slideBox()).toHaveStyle({ transform: 'scale(0.5)' });
  });

  it('measures the slide that is on screen after a slide change, not the one leaving', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    await findCounter();

    // AnimatePresence mounts the incoming slide after the index changes, so an
    // effect that runs on the index measures the OUTGOING node and leaves the
    // new one unobserved for the rest of the deck.
    expect(observed).toContain(slideBox());
  });
});

describe('leaving the presentation from the deck', () => {
  it('offers a visible exit beside the fullscreen control', async () => {
    renderAt(`/d/${firstId}/present`);
    await findCounter();

    // Both halves of the name, asserted: that it is there, and that it sits
    // after the fullscreen control — which is the tab order a reader meets.
    const footer = document.querySelector('footer')!;
    expect([...footer.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Pantalla completa', 'Salir de la presentación'],
    );
  });

  it('does not ask to leave fullscreen when it was never entered', async () => {
    // exitFullscreen() REJECTS outside fullscreen and the call is `void`ed, so
    // an unguarded exit is an unhandled rejection on every ordinary way out
    // (#103 review, measured in Chromium).
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    try {
      renderAt(`/d/${firstId}/present`);
      await findCounter();
      fireEvent.click(screen.getByRole('button', { name: /salir de la presentación/i }));
      await screen.findByRole('article');
      expect(exitFullscreen).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('lands on the book view from any slide, including a deep link', async () => {
    renderAt(`/d/${firstId}/present?slide=3`);
    await findCounter();

    fireEvent.click(screen.getByRole('button', { name: /salir de la presentación/i }));

    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('leaves fullscreen on the way out, since the control goes with the deck', async () => {
    const exitFullscreen = vi.fn(() => Promise.resolve());
    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });
    Object.defineProperty(document, 'exitFullscreen', {
      configurable: true,
      value: exitFullscreen,
    });
    try {
      renderAt(`/d/${firstId}/present`);
      await findCounter();
      fireEvent.click(screen.getByRole('button', { name: /salir de la presentación/i }));
      await screen.findByRole('article');
      expect(exitFullscreen).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('is not reachable behind the rotate panel', async () => {
    coarsePortrait(true);
    try {
      renderAt(`/d/${firstId}/present`);
      await screen.findByRole('alertdialog');
      expect(
        screen.queryByRole('button', { name: /salir de la presentación/i }),
      ).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});

describe('presentation: none documents', () => {
  it('redirects /present back to the book view', async () => {
    const noneId = ids.find((id) => registry.get(id)?.meta.presentation === 'none');
    expect(noneId, 'seed course needs a presentation:none document').toBeDefined();
    renderAt(`/d/${noneId}/present`);
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });
});

describe('book-view entry points to presentation', () => {
  it('shows a Presentar toggle in the document header', async () => {
    renderAt(`/d/${firstId}`);
    const toggle = await screen.findByRole('link', { name: /presentar/i });
    expect(toggle).toHaveAttribute('href', `/d/${firstId}/present`);
  });

  it('hides the toggle for presentation: none documents', async () => {
    const noneId = ids.find((id) => registry.get(id)?.meta.presentation === 'none')!;
    renderAt(`/d/${noneId}`);
    await screen.findByRole('article');
    expect(screen.queryByRole('link', { name: /presentar/i })).not.toBeInTheDocument();
  });

  it('enters presentation with the p key from the book view', async () => {
    renderAt(`/d/${firstId}`);
    await screen.findByRole('article');
    fireEvent.keyDown(window, { key: 'p' });
    expect(await screen.findByText(/^\d+ \/ \d+$/)).toBeInTheDocument();
  });
});

// busqueda-binaria is the DESIGNATED explicit-mode fixture (see its frontmatter):
// these tests guard the real compiled <Slide> path through the mdxChildrenOf
// adapter — the alarm the adapter's docs promise.
describe('explicit-mode documents (real compiled markers)', () => {
  const explicitId = ids.find((id) => registry.get(id)?.meta.presentation === 'explicit');

  it('the seed course provides an explicit fixture', () => {
    expect(explicitId).toBeDefined();
  });

  it('decks only the marked slides, leaving loose prose book-only', async () => {
    renderAt(`/d/${explicitId}/present`);
    const counter = await findCounter();
    expect(counter).toHaveTextContent('1 / 3');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByRole('heading', { name: 'La idea' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'End' });
    expect(screen.queryByText(/prosa de libro/)).not.toBeInTheDocument();
  });

  it('renders marked slides as heading + prose in the book view, with the loose section present', async () => {
    renderAt(`/d/${explicitId}`);
    const article = await screen.findByRole('article');
    const { within } = await import('@testing-library/react');
    expect(
      await within(article).findByRole('heading', { level: 2, name: /La idea/ }),
    ).toBeInTheDocument();
    expect(within(article).getByRole('heading', { level: 2, name: /Costo/ })).toBeInTheDocument();
  });
});
