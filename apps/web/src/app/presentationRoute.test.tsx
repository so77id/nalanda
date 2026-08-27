import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { courseIndex, registry, walkIndex } from '../content';

import { AppRoutes } from './AppRoutes';

// The router owns the URL in a MemoryRouter (window.location never moves), so
// URL-shape assertions read it through a hook probe rendered inside the router.
let lastLocation: { search: string; hash: string; pathname: string } = {
  search: '',
  hash: '',
  pathname: '',
};
function LocationProbe() {
  const location = useLocation();
  lastLocation = { search: location.search, hash: location.hash, pathname: location.pathname };
  return null;
}

const ids = walkIndex(courseIndex);
// The first PRESENTABLE document, not simply the first one (#108). These cases
// need a deck to drive, and `ids[0]` only happens to have one. This one stays on
// the index deliberately: what it wants IS the teaching path's opening document.
// Since #120 that is the course's opening class, which declares `explicit`; if a
// landing page ever declared `none`, `ids[0]` would redirect /present back to
// the book and these cases would go red for a reason with nothing to do with the
// viewer they test.
const firstId = ids.find((id) => registry.get(id)?.meta.presentation !== 'none')!;
const firstTitle = registry.get(firstId)?.meta.title ?? firstId;

/**
 * Renders at `path` with the first commit flushed.
 *
 * The flush is not decoration. `React.lazy` suspends once even when the module
 * is already in the ES module cache, so without it the assertion runs against
 * the Suspense fallback — verified: keep the preload below, drop the `act`, and
 * the cover-slide case fails with #102's own message.
 *
 * It lives in the helper rather than at the call sites because there are 37 of
 * them, and a step a call site has to remember is a step the 38th will not get.
 */
async function renderAt(path: string): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={[path]}>
        <LocationProbe />
        <AppRoutes />
      </MemoryRouter>,
    );
  });
}

/**
 * Every assertion in this file lives on the far side of `lazy(entry.load)`
 * (`content/lazyDoc.ts`), so each one raced the document module against the
 * 1000ms window `findBy*` gives an assertion. On a loaded machine the module
 * lost: the cover-slide case failed three times, once measured at 1402ms, and
 * because CI runs the same protocol a green run stopped being reproducible
 * (#102).
 *
 * Resolving the modules once, here, settles every boundary in the file on its
 * first commit. It is done at file level rather than inside a render helper on
 * purpose: 37 renders share this hazard, and a fix a call site has to remember
 * is a fix the 38th will not get. Dynamic imports are cached, so this costs one
 * resolution, not one per test.
 */
beforeAll(async () => {
  await Promise.all(registry.entries.map((entry) => entry.load()));
});

/**
 * jsdom implements no Fullscreen API, so after #111 the deck hides its
 * fullscreen control there — correctly, but for a reason no test intended.
 * A test that cares about that control declares the capability first, the way
 * a browser would present it.
 */
function withFullscreenSupport() {
  Object.defineProperty(document.documentElement, 'requestFullscreen', {
    configurable: true,
    value: () => Promise.resolve(),
  });
  return () => Reflect.deleteProperty(document.documentElement, 'requestFullscreen');
}

async function findCounter() {
  return screen.findByText(/^\d+ \/ \d+$/);
}

/** The counter without waiting — for the canary; see the cover-slide case. */
function getCounter() {
  return screen.getByText(/^\d+ \/ \d+$/);
}

describe('PresentationPage viewer', () => {
  it('opens on the cover slide with the document title and a counter', async () => {
    await renderAt(`/d/${firstId}/present`);

    // `getBy`, deliberately, not `findBy`: once the document is resolved there
    // is nothing left to wait for, and a query that cannot wait is the only
    // assertion that can prove it. If this throws, the boundary is being raced
    // again and every other case in this file is one busy machine away from
    // failing (#102).
    expect(screen.getByRole('heading', { name: firstTitle })).toBeInTheDocument();
    expect(getCounter()).toHaveTextContent(/^1 \/ \d+$/);
  });

  it('navigates with ArrowRight/ArrowLeft and clamps at the edges', async () => {
    await renderAt(`/d/${firstId}/present`);
    const counter = await findCounter();

    fireEvent.keyDown(window, { key: 'ArrowLeft' });
    expect(counter).toHaveTextContent(/^1 \//);

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('advances with Space and jumps with Home/End', async () => {
    await renderAt(`/d/${firstId}/present`);
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
    await renderAt(`/d/${firstId}/present?slide=2`);
    expect(await findCounter()).toHaveTextContent(/^2 \//);
  });

  it('survives a crafted non-integer ?slide value', async () => {
    await renderAt(`/d/${firstId}/present?slide=1.5`);
    expect(await findCounter()).toHaveTextContent(/^1 \//);
  });

  // The book anchors every h2 with `#<slug>`, and the deep-link contract
  // (ADR-0013 succession) says presentation should reach the same section
  // through `?section=<slug>`. The slug spine is the fixture's second slide
  // — the first h2 of `java-tipos-y-flujo`. Named through the registry so a
  // future re-cut of the deck doesn't red these cases silently.
  const EXPLICIT_FIXTURE = 'java-tipos-y-flujo';
  const explicitId = registry.get(EXPLICIT_FIXTURE)?.meta.id;

  it('deep-links to a slide via ?section=<slug>', async () => {
    // `tipos-primitivos` is the slug of the first <Slide title> of the fixture,
    // per its own MDX. If that slide is renamed the case fails loudly.
    await renderAt(`/d/${explicitId}/present?section=tipos-primitivos`);
    expect(await screen.findByRole('heading', { name: 'Tipos primitivos' })).toBeInTheDocument();
  });

  it('canonicalizes ?section=<slug> to ?slide=<N> so the back button behaves', async () => {
    await renderAt(`/d/${explicitId}/present?section=tipos-primitivos`);
    await screen.findByRole('heading', { name: 'Tipos primitivos' });
    // The URL is the source of truth (ADR-0013); after resolving the slug the
    // deck must publish the canonical `?slide=N` form so the browser history
    // holds one shape only and a bookmark of the current URL stays valid.
    const search = new URLSearchParams(lastLocation.search);
    expect(search.get('section')).toBeNull();
    expect(search.get('slide')).toMatch(/^\d+$/);
  });

  it('falls back to slide 1 for an unknown ?section slug (no white screen)', async () => {
    await renderAt(`/d/${firstId}/present?section=this-slug-does-not-exist`);
    expect(await findCounter()).toHaveTextContent(/^1 \//);
    // …and the canonical form is published even in the fallback.
    const search = new URLSearchParams(lastLocation.search);
    expect(search.get('section')).toBeNull();
    expect(search.get('slide')).toBe('1');
  });

  it('lets ?section win over a conflicting ?slide', async () => {
    // section=tipos-primitivos → slide 2 of the fixture; slide=1 would keep
    // the cover. If section had lost the race we would still see the doc
    // title heading rather than "Tipos primitivos".
    await renderAt(`/d/${explicitId}/present?slide=1&section=tipos-primitivos`);
    expect(await screen.findByRole('heading', { name: 'Tipos primitivos' })).toBeInTheDocument();
  });

  it('returns to the book view on Escape', async () => {
    await renderAt(`/d/${firstId}/present`);
    await findCounter();

    fireEvent.keyDown(window, { key: 'Escape' });
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  it('offers a fullscreen control that says what pressing it will do', async () => {
    const restore = withFullscreenSupport();
    await renderAt(`/d/${firstId}/present`);
    await findCounter();
    // Out of fullscreen the button ENTERS it, so the name is the destination.
    expect(screen.getByRole('button', { name: 'Pantalla completa' })).toBeInTheDocument();
    restore();
  });

  it('hides the fullscreen control where the platform has no fullscreen', async () => {
    // An iPhone: no browser there exposes requestFullscreen for a web page
    // (ADR-0023), so the control could only ever be a button that does nothing.
    // jsdom is that platform by default, which is exactly why the tests above
    // have to declare the capability rather than inherit it.
    await renderAt(`/d/${firstId}/present`);
    await findCounter();

    const footer = document.querySelector('footer')!;
    expect([...footer.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Salir de la presentación'],
    );
    // The way out and the counter stay; only the dead control goes.
    expect(screen.getByText(/^\d+ \/ \d+$/)).toBeInTheDocument();
  });

  it('renames the fullscreen control when fullscreen is entered by any means', async () => {
    const restoreSupport = withFullscreenSupport();
    // Not only after a click: Escape and the browser's own chrome change the
    // state too, so the name is derived from document.fullscreenElement rather
    // than from what this component last did (#106).
    await renderAt(`/d/${firstId}/present`);
    await findCounter();

    Object.defineProperty(document, 'fullscreenElement', {
      configurable: true,
      value: document.documentElement,
    });
    try {
      // Dispatched where the browser dispatches it: at the element that entered
      // fullscreen, bubbling — not directly at `document`, which would only
      // prove the listener's address.
      fireEvent(document.documentElement, new Event('fullscreenchange', { bubbles: true }));
      expect(
        await screen.findByRole('button', { name: 'Salir de pantalla completa' }),
      ).toBeInTheDocument();

      // …and back. One crossing is satisfied by a latch: an implementation that
      // never returns the name survived the enter-only assertion across 569
      // tests (#106 review).
      Reflect.deleteProperty(document, 'fullscreenElement');
      fireEvent(document.documentElement, new Event('fullscreenchange', { bubbles: true }));
      expect(await screen.findByRole('button', { name: 'Pantalla completa' })).toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      restoreSupport();
    }
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
    await renderAt(`/d/${firstId}/present`);

    // Waiting for the panel also waits for the lazy document: the deck is what
    // decides, so by now the slides exist and their absence is a decision.
    expect(await screen.findByRole('alertdialog')).toBeInTheDocument();
    expect(screen.queryByText(/^\d+ \/ \d+$/)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: firstTitle })).not.toBeInTheDocument();
  });

  it('leaves nothing but the way out reachable by keyboard', async () => {
    coarsePortrait(true);
    await renderAt(`/d/${firstId}/present`);
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
    await renderAt(`/d/${firstId}/present?slide=2`);
    await screen.findByRole('alertdialog');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    fireEvent.keyDown(window, { key: 'End' });

    media.turn(false);
    expect(await findCounter()).toHaveTextContent(/^2 \//);
  });

  it('still answers Escape behind the panel — a modal has a way out', async () => {
    coarsePortrait(true);
    await renderAt(`/d/${firstId}/present`);
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
      await renderAt(`/d/${firstId}/present`);
      await screen.findByRole('alertdialog');
      expect(exitFullscreen).toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'fullscreenElement');
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('shows the deck at the reader’s slide when the phone is turned, and back', async () => {
    const media = coarsePortrait(true);
    await renderAt(`/d/${firstId}/present?slide=2`);
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
    await renderAt(`/d/${firstId}/present`);
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
    await renderAt(`/d/${firstId}/present`);

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
    await renderAt(`/d/${firstId}/present?slide=2`);
    const counter = await findCounter();

    swipe(300, 150);
    expect(counter).toHaveTextContent(/^3 \//);

    swipe(150, 300);
    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('clamps at the first slide, as the keyboard does', async () => {
    await renderAt(`/d/${firstId}/present`);
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
    await renderAt(`/d/${firstId}/present?slide=2`);
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
    //
    // Slide 10 of `java-desde-cpp` is "Compilar y ejecutar", whose two ASCII
    // pipeline diagrams are the document's only language-less fences and so its
    // only real <pre>s. #107 re-cut the deck and moved this slide from index 5
    // to 10; repoint here if a later re-cut moves it again (the assertion below
    // fails loudly if this index stops carrying a <pre>).
    await renderAt('/d/java-desde-cpp/present?slide=10');
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
    await renderAt(`/d/${firstId}/present?slide=2`);
    const counter = await findCounter();
    const stage = screen.getByTestId('slide-stage');

    fireEvent.touchStart(stage, { touches: [{ clientX: 600, clientY: 200 }] });
    fireEvent.touchCancel(stage, { changedTouches: [{ clientX: 600, clientY: 200 }] });
    fireEvent.touchEnd(stage, { changedTouches: [{ clientX: 200, clientY: 205 }] });

    expect(counter).toHaveTextContent(/^2 \//);
  });

  it('ignores a two-finger gesture — a pinch is not a swipe', async () => {
    await renderAt(`/d/${firstId}/present?slide=2`);
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
    await renderAt(`/d/${firstId}/present`);
    await findCounter();
    // 300/600 is tighter than 800/896.
    expect(slideBox()).toHaveStyle({ transform: 'scale(0.5)' });
  });

  it('measures after a rotation, which mounts the deck without changing the slide', async () => {
    const media = coarsePortrait(true);
    await renderAt(`/d/${firstId}/present`);
    await screen.findByRole('alertdialog');

    media.turn(false);
    await findCounter();

    // The index never changed, so an effect keyed on it never re-ran and the
    // slide stayed at scale(1), overflowing its stage — measured in Chromium
    // before this fix (#99 review).
    expect(slideBox()).toHaveStyle({ transform: 'scale(0.5)' });
  });

  it('measures the slide that is on screen after a slide change, not the one leaving', async () => {
    await renderAt(`/d/${firstId}/present`);
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
    // Both halves of the name, asserted: that it is there, and that it sits
    // after the fullscreen control — which is the tab order a reader meets.
    // The capability is declared before the render, because the deck decides
    // whether to paint that neighbour at all (#111).
    const restore = withFullscreenSupport();
    await renderAt(`/d/${firstId}/present`);
    await findCounter();
    const footer = document.querySelector('footer')!;
    expect([...footer.querySelectorAll('button')].map((b) => b.getAttribute('aria-label'))).toEqual(
      ['Pantalla completa', 'Salir de la presentación'],
    );
    restore();
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
      await renderAt(`/d/${firstId}/present`);
      await findCounter();
      fireEvent.click(screen.getByRole('button', { name: /salir de la presentación/i }));
      await screen.findByRole('article');
      expect(exitFullscreen).not.toHaveBeenCalled();
    } finally {
      Reflect.deleteProperty(document, 'exitFullscreen');
    }
  });

  it('lands on the book view from any slide, including a deep link', async () => {
    await renderAt(`/d/${firstId}/present?slide=3`);
    await findCounter();

    fireEvent.click(screen.getByRole('button', { name: /salir de la presentación/i }));

    expect(await screen.findByRole('article')).toBeInTheDocument();
  });

  // The exit contract's second half (#256): when the reader leaves from a
  // slide that has a slug, the book takes them back to that heading via the
  // URL fragment — no scrolling back to the section by hand. `mdxHeading.tsx`
  // already renders `id={slug}` on every h2, so the browser handles the
  // scroll on its own.
  const EXPLICIT_FIXTURE = 'java-tipos-y-flujo';
  const explicitId = registry.get(EXPLICIT_FIXTURE)?.meta.id;

  it('lands on the book #<slug> when Escape leaves a slide that has one', async () => {
    // Slide 2 of the fixture is `<Slide title="Tipos primitivos">`, whose
    // slug is `tipos-primitivos` — the same anchor the book renders on the
    // heading (mdxHeading.tsx).
    await renderAt(`/d/${explicitId}/present?slide=2`);
    await screen.findByRole('heading', { name: 'Tipos primitivos' });

    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByRole('article');
    expect(lastLocation.pathname).toBe(`/d/${explicitId}`);
    expect(lastLocation.hash).toBe('#tipos-primitivos');
  });

  it('publishes no fragment when Escape leaves from the cover slide', async () => {
    // The cover slide has no slug (parser.ts §slugFor): the top-bar
    // "Presentar" button lands there, so `#doc-title` on exit would round-
    // trip the reader to the same spot they came from.
    await renderAt(`/d/${firstId}/present`);
    await findCounter();

    fireEvent.keyDown(window, { key: 'Escape' });
    await screen.findByRole('article');
    expect(lastLocation.pathname).toBe(`/d/${firstId}`);
    expect(lastLocation.hash).toBe('');
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
      await renderAt(`/d/${firstId}/present`);
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
      await renderAt(`/d/${firstId}/present`);
      await screen.findByRole('alertdialog');
      expect(
        screen.queryByRole('button', { name: /salir de la presentación/i }),
      ).not.toBeInTheDocument();
    } finally {
      Reflect.deleteProperty(window, 'matchMedia');
    }
  });
});

// Named and resolved from the registry, like EXPLICIT_FIXTURE below: what these
// two cases need is a document that declares `none`, which has nothing to do
// with the teaching path. Discovered by predicate over the index they reddened
// with "seed course needs a presentation:none document" — the wrong diagnosis —
// when a document was taken off the path, which is the failure the §Conventions
// rule this branch adds exists to prevent.
const NONE_FIXTURE = 'planificacion';
const noneId = registry.get(NONE_FIXTURE)?.meta.id;

describe('presentation: none documents', () => {
  it('the seed course still provides a book-only document', () => {
    expect(
      noneId,
      `${NONE_FIXTURE} left content/ or stopped declaring \`presentation: none\` — repoint at another book-only document`,
    ).toBeDefined();
  });

  it('redirects /present back to the book view', async () => {
    await renderAt(`/d/${noneId}/present`);
    expect(await screen.findByRole('article')).toBeInTheDocument();
  });
});

describe('book-view entry points to presentation', () => {
  it('shows a Presentar toggle in the document header', async () => {
    await renderAt(`/d/${firstId}`);
    // Exact match: since #256 an h2 slide can also carry a "Presentar la
    // sección «…»" link, so a `/presentar/i` regex now finds many. The
    // top-bar toggle is the one whose only word is `Presentar`.
    const toggle = await screen.findByRole('link', { name: 'Presentar' });
    expect(toggle).toHaveAttribute('href', `/d/${firstId}/present`);
  });

  it('hides the toggle for presentation: none documents', async () => {
    await renderAt(`/d/${noneId}`);
    await screen.findByRole('article');
    // Same reason as above: an h2 in a `presentation: none` document must not
    // carry the per-section button either, and the assertion has to be exact
    // to distinguish the two.
    expect(screen.queryByRole('link', { name: 'Presentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /presentar la sección/i })).not.toBeInTheDocument();
  });

  it('enters presentation with the p key from the book view', async () => {
    await renderAt(`/d/${firstId}`);
    await screen.findByRole('article');
    fireEvent.keyDown(window, { key: 'p' });
    expect(await screen.findByText(/^\d+ \/ \d+$/)).toBeInTheDocument();
  });
});

describe('present-section button in the book view', () => {
  // End-to-end: the S4 wrapper publishes the slugs and S5's button in
  // `mdxHeading` links to `?section=<slug>` on the presentation route, which
  // S2 resolves. Unit tests in `content/mdxHeading.test.tsx` cover the render
  // matrix; this block guards the wire-up.
  const EXPLICIT_FIXTURE = 'java-tipos-y-flujo';
  const explicitId = registry.get(EXPLICIT_FIXTURE)?.meta.id;

  it('offers a Presentar-sección link on a marked <Slide> h2 in the book', async () => {
    await renderAt(`/d/${explicitId}`);
    await screen.findByRole('article');
    const link = screen.getByRole('link', { name: /presentar la sección «tipos primitivos»/i });
    expect(link).toHaveAttribute('href', `/d/${explicitId}/present?section=tipos-primitivos`);
  });

  it('does not offer the button on a loose h2 (explicit-mode book-only section)', async () => {
    // "Ejercicios" in java-tipos-y-flujo is a loose h2 outside every <Slide>,
    // so it is presentation-invisible by design — no button, but the `#`
    // anchor stays.
    await renderAt(`/d/${explicitId}`);
    await screen.findByRole('article');
    expect(
      screen.getByRole('link', { name: /^enlace a la sección «ejercicios»$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: /presentar la sección «ejercicios»/i }),
    ).not.toBeInTheDocument();
  });

  it('does not offer the button on the catalog surface (no wrapper mounted)', async () => {
    // /catalog/c/slide renders the Slide component in isolation with no
    // PresentableSectionsWrapper above it, so the button must stay silent —
    // the default context value is what silences it, so nothing catalog-
    // specific was written to make this true.
    await renderAt('/catalog/c/slide');
    await screen.findByRole('heading', { level: 1 });
    expect(screen.queryByRole('link', { name: /presentar la sección/i })).not.toBeInTheDocument();
  });
});

// java-tipos-y-flujo is the DESIGNATED explicit-mode fixture (its own MDX carries
// the note saying so, and what it must keep):
// these tests guard the real compiled <Slide> path through the mdxChildrenOf
// adapter — the alarm the adapter's docs promise.
describe('explicit-mode documents (real compiled markers)', () => {
  // Named, not discovered (#108). The assertions below are this document's own
  // words — "Tipos primitivos", "Ejercicios" — so "the first explicit
  // document" was never what these cases meant; it merely resolved to the right
  // one while `busqueda-binaria` happened to come first in the index. The day
  // another document ahead of it declared `explicit`, both cases failed against
  // a fixture whose content they never claimed to know.
  //
  // Resolved through the REGISTRY, not `walkIndex`. These cases drive
  // `/d/<id>/present`, and that route answers for any compiled document: the
  // index decides the teaching path, never existence (ADR-0015 §6). Reading the
  // index conflated the two, and retiring the Fundamentos unit from the path
  // reddened three cases here about a document nobody had touched.
  const EXPLICIT_FIXTURE = 'java-tipos-y-flujo';
  const explicitId = registry.get(EXPLICIT_FIXTURE)?.meta.id;

  it('the seed course still provides the explicit fixture these cases describe', () => {
    expect(
      explicitId,
      `${EXPLICIT_FIXTURE} is gone from content/ — repoint this block at a document whose sections are <Slide> markers, and update the headings asserted below to its own. Leaving the index is not enough to trip this: the registry is what this reads.`,
    ).toBeDefined();
    expect(registry.get(explicitId!)?.meta.presentation).toBe('explicit');
  });

  // Named, not a bare URL (ADR-0025 §2). This drove `intro-estructuras` until
  // #135 deleted it; `java-desde-cpp` ends the same way — a navigation sentence
  // after the last <Slide> — so the case keeps exactly what it was written for.
  const CLOSING_FIXTURE = 'java-desde-cpp';

  // What #108 actually bought, pinned. Reverting content/ to its pre-#108 state
  // left the whole suite green except the declaration invariant — nothing was
  // watching the behaviour the WP exists for. `intro-estructuras` used to end
  // its deck on the book's own closing navigation sentence, projected alone,
  // because in `auto` there is no way to keep loose prose out of a deck.
  it('keeps the book’s closing navigation sentence out of the deck', async () => {
    renderAt(`/d/${CLOSING_FIXTURE}/present`);
    // The count is the vehicle, not the subject: what this pins is that `End`
    // lands on the last MARKED slide and the trailing sentence is not one. 13 is
    // this document's twelve `<Slide>` markers plus its one `<SectionBreak>`;
    // move the number whenever it gains or loses either.
    expect(await findCounter()).toHaveTextContent('1 / 13');

    fireEvent.keyDown(window, { key: 'End' });
    expect(
      await screen.findByRole('heading', { name: 'La prueba del nombre completo' }),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Es el próximo documento/)).not.toBeInTheDocument();
  });

  it('decks only the marked slides, leaving loose prose book-only', async () => {
    await renderAt(`/d/${explicitId}/present`);
    const counter = await findCounter();
    // Same as above: the number tracks the fixture's marked slides — twelve
    // `<Slide>` markers plus one `<SectionBreak>` — while the case is about the
    // loose prose staying out.
    expect(counter).toHaveTextContent('1 / 13');

    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(await screen.findByRole('heading', { name: 'Tipos primitivos' })).toBeInTheDocument();

    fireEvent.keyDown(window, { key: 'End' });
    // Awaited on purpose: `queryByText` cannot wait, and until the last slide has
    // painted the deck body is not in the DOM at all — so without this the
    // negative assertion below passes against an empty document and can never
    // fail. Found by mutation in #135's review: moving the closing prose INSIDE
    // the last <Slide> left the case green.
    await screen.findByRole('heading', { name: 'Ejercicio en vivo: ¿Es par?' });
    expect(screen.queryByText(/Es lo que viene más adelante en el curso/)).not.toBeInTheDocument();
  });

  it('renders marked slides as heading + prose in the book view, with the loose section present', async () => {
    await renderAt(`/d/${explicitId}`);
    const article = await screen.findByRole('article');
    const { within } = await import('@testing-library/react');
    expect(
      await within(article).findByRole('heading', { level: 2, name: /Tipos primitivos/ }),
    ).toBeInTheDocument();
    // A markdown `##`, not a <Slide title> — the loose section the case is named
    // for, and the second heading source this fixture was chosen to carry.
    expect(
      within(article).getByRole('heading', { level: 2, name: /Ejercicios/ }),
    ).toBeInTheDocument();
  });
});
