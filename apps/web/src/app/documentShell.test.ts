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

  it('tells a mobile browser what colour to paint its own chrome, per theme', () => {
    // Two metas since #109, because there are two grounds. A single value paints
    // the phone's chrome in one theme's colour whichever theme the reader is in.
    expect(html).toMatch(
      /<meta[^>]*name="theme-color"[^>]*media="\(prefers-color-scheme: light\)"/,
    );
    expect(html).toMatch(/<meta[^>]*name="theme-color"[^>]*media="\(prefers-color-scheme: dark\)"/);
  });

  it('keeps each meta colour and the ground token it stands for the same colour', () => {
    // Both sides carry a comment saying they are kept in step by hand, and both
    // were asserted in isolation — so moving the CSS to slate-900 once shipped
    // green with the phone chrome no longer matching the page.
    //
    // Asserting a literal on each side is what allowed that, and it happened
    // AGAIN in #109: `html` moved to var(--color-ground) while the meta still
    // said #020617, and only this case noticed. So neither side is a literal any
    // more — the metas are compared against the token values read out of the
    // stylesheet, which is the only version of this check that cannot drift.
    const themeColour = (scheme: string) =>
      new RegExp(
        `<meta[^>]*name="theme-color"[^>]*media="\\(prefers-color-scheme: ${scheme}\\)"[^>]*content="(#[0-9a-fA-F]{6})"|` +
          `<meta[^>]*name="theme-color"[^>]*content="(#[0-9a-fA-F]{6})"[^>]*media="\\(prefers-color-scheme: ${scheme}\\)"`,
      )
        .exec(html)
        ?.slice(1)
        .find(Boolean)
        ?.toLowerCase();

    // The light ground is the bare :root block; the dark one is the explicit
    // [data-theme='dark'] block, which carries the same values as the media query.
    const groundIn = (selector: string) =>
      new RegExp(`${selector}\\s*\\{[^}]*--nl-ground:\\s*(#[0-9a-fA-F]{6})`, 's')
        .exec(css)?.[1]
        ?.toLowerCase();

    expect(css).toMatch(/html\s*\{[^}]*var\(--color-ground\)/s);
    expect(themeColour('light'), 'no light theme-color meta').toBe(groundIn(':root'));
    expect(themeColour('dark'), 'no dark theme-color meta').toBe(
      groundIn(":root\\[data-theme='dark'\\]"),
    );
  });

  it('gives focus an outline of its own, thick enough to see', () => {
    // The browser default was a 1px #005FCC hairline at 3.13:1 — technically
    // above the 3:1 minimum, and a colour used nowhere else in the product.
    const rule = /:focus-visible\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(rule, 'no :focus-visible rule at all').not.toBe('');
    expect(rule).toMatch(/outline:\s*(?:[2-9]|\d{2,})px/);
    // Offset so the outline lands on the surface AROUND a control: sky-400 is
    // 6.95:1 on a panel and 1.76:1 on the emerald run button.
    expect(rule).toMatch(/outline-offset:\s*[1-9]/);
  });

  it('gives the code editor an outline, since CodeMirror removes its own', () => {
    const rule = /\.cm-editor\.cm-focused\s*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(rule, 'no rule for the focused editor').not.toBe('');
    expect(rule).toMatch(/outline:\s*[2-9]px/);
    // NEGATIVE, and the sign is the whole thing. Outward it is clipped by the
    // scrolling box and the shell's overflow-hidden, and getComputedStyle keeps
    // reporting an outline no screenshot has. Lose the minus and it vanishes.
    expect(rule).toMatch(/outline-offset:\s*-\d/);
  });

  it('gives running text a measure narrower than the column it sits in', () => {
    // The audit measured 84 characters per line at 768px — comfortable prose is
    // 60–75. The container stays 768px because <SideBySide> needs it (#76), so
    // the narrowing happens to the text, not to the column.
    const rule = /\.measured-prose[^{]*\{[^}]*\}/s.exec(css)?.[0] ?? '';
    expect(rule, 'no measure rule at all').not.toBe('');
    expect(rule).toMatch(/max-width:\s*\d/);
  });

  it('exempts blocks from the measure, so code and components keep the column', () => {
    // `not-prose` is already the product's marker for "this is a block, not
    // text": CodeEditor, Exercise, SideBySide and AuthoringError all carry it.
    // Narrowing those would re-break the #76 fix, which needs 376px a side.
    const selector = /\.measured-prose[^{]*(?=\{)/s.exec(css)?.[0] ?? '';
    expect(selector).toContain('not-prose');
    expect(selector).toContain('pre');
    expect(selector).toContain('measure-full');
  });

  it('found real files (guards against a vacuous check)', () => {
    expect(html).toContain('<div id="root">');
    expect(css).toContain('@import');
  });
});
