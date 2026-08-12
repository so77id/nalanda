import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// What the HTML document declares about itself, before React runs. None of it is
// reachable from a component test: jsdom builds its own document, so the shipped
// `index.html` and the global stylesheet are only ever asserted here.
// vitest runs with apps/web as its cwd.
const html = readFileSync(join(process.cwd(), 'index.html'), 'utf8');
const css = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8');

describe('the document shell', () => {
  it('declares the language the course is written in', () => {
    // Course content is Spanish (root CLAUDE.md). Left at `en`, a screen reader
    // pronounces the whole site with English phonemes.
    expect(html).toMatch(/<html[^>]*\blang="es"/);
  });

  it('declares a dark colour scheme', () => {
    // Without it the language <select>, the stdin <textarea> and the scrollbars
    // render with light-mode native chrome inside a dark UI.
    expect(css).toMatch(/color-scheme:\s*dark/);
  });

  it('paints the surface on the document itself, not only on a div', () => {
    // The dark background came from `div.bg-slate-950` inside #root, so macOS
    // overscroll showed white behind the page.
    expect(css).toMatch(/\bhtml\b[^{]*\{[^}]*background/s);
  });

  it('tells a mobile browser what colour to paint its own chrome', () => {
    expect(html).toMatch(/<meta[^>]*name="theme-color"[^>]*content="#020617"/);
  });

  it('found real files (guards against a vacuous check)', () => {
    expect(html).toContain('<div id="root">');
    expect(css).toContain('@import');
  });
});
