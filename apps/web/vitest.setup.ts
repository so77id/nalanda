import { cleanup } from '@testing-library/react';
import { afterEach } from 'vitest';

import '@testing-library/jest-dom/vitest';

// Testing Library only auto-registers cleanup when a global afterEach exists;
// with globals disabled it must be wired explicitly.
afterEach(cleanup);

// jsdom does not implement ResizeObserver — a class every modern layout hook
// touches. Mafs (behind `<MathPlot>`, ADR-0046) mounts a `use-resize-observer`
// that throws on import when the global is missing, which turned every
// document rendering `<MathPlot>` into a red test for the wrong reason. This
// polyfill is inert: observe/unobserve/disconnect are no-ops, which is
// exactly what a suite that lays nothing out needs. The paint-side effects of
// resize observation are verified in a real browser like every other
// jsdom-can't-lay-things-out concern (apps/web/CLAUDE.md §the suite cannot
// lay out a page).
if (typeof globalThis.ResizeObserver === 'undefined') {
  class ResizeObserverShim {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.ResizeObserver = ResizeObserverShim as unknown as typeof ResizeObserver;
}
