import { act, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { usePortraitPhone } from './usePortraitPhone';

// jsdom does not implement `window.matchMedia` AT ALL — it is undefined, so a
// hook that calls it unguarded throws here instead of getting `false`
// (testing-strategy.md §Layout and focus). The fake is therefore both the way
// to state an answer and the only way this hook can be exercised at all; the
// real media query is verified in a browser.
function fakeMatchMedia(initial: boolean) {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const asked: string[] = [];
  let matches = initial;

  window.matchMedia = ((query: string) => {
    asked.push(query);
    return {
      media: query,
      get matches() {
        return matches;
      },
      addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.add(listener);
      },
      removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
        listeners.delete(listener);
      },
    } as unknown as MediaQueryList;
  }) as typeof window.matchMedia;

  return {
    asked,
    get listenerCount() {
      return listeners.size;
    },
    /** What the browser does when the phone is turned. */
    set(next: boolean) {
      matches = next;
      act(() => {
        for (const listener of listeners) listener({ matches: next } as MediaQueryListEvent);
      });
    },
  };
}

function Harness() {
  return <span data-testid="answer">{usePortraitPhone() ? 'yes' : 'no'}</span>;
}

function answer() {
  return screen.getByTestId('answer').textContent;
}

afterEach(() => {
  Reflect.deleteProperty(window, 'matchMedia');
});

describe('usePortraitPhone', () => {
  it('asks for a coarse pointer AND portrait, so a narrow desktop window is not a phone', () => {
    const media = fakeMatchMedia(false);
    render(<Harness />);
    // Asserted by construction: jsdom cannot evaluate a media query, so the only
    // thing the suite can pin is which question is asked. Both halves matter —
    // dropping `pointer: coarse` tells a laptop user to rotate their screen.
    expect(media.asked.join(' ')).toContain('pointer: coarse');
    expect(media.asked.join(' ')).toContain('orientation: portrait');
  });

  it('is false where the browser cannot answer, rather than throwing', () => {
    render(<Harness />);
    expect(answer()).toBe('no');
  });

  it('is true on a coarse pointer in portrait', () => {
    fakeMatchMedia(true);
    render(<Harness />);
    expect(answer()).toBe('yes');
  });

  it('follows the phone when it is turned, both ways', () => {
    const media = fakeMatchMedia(true);
    render(<Harness />);

    media.set(false);
    expect(answer()).toBe('no');

    media.set(true);
    expect(answer()).toBe('yes');
  });

  it('stops listening when it unmounts', () => {
    const media = fakeMatchMedia(true);
    const { unmount } = render(<Harness />);
    expect(media.listenerCount).toBe(1);

    unmount();
    expect(media.listenerCount).toBe(0);
  });
});
