import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Split } from './Split';
import { useEmbedded } from '../embedded';

function EmbeddedProbe() {
  return <span data-testid="probe">{String(useEmbedded())}</span>;
}

describe('Split', () => {
  it('renders both blocks in the order they were authored', () => {
    const { container } = render(
      <Split>
        <p>izquierda</p>
        <p>derecha</p>
      </Split>,
    );

    const paragraphs = [...container.querySelectorAll('p')].map((p) => p.textContent);
    expect(paragraphs).toEqual(['izquierda', 'derecha']);
  });

  it('asks for two columns from the md breakpoint up, and none below it', () => {
    // A class assertion, deliberately: jsdom lays nothing out, so the only
    // honest thing to pin here is the instruction. That the columns are really
    // side by side is a browser check (S6).
    const { container } = render(
      <Split>
        <p>a</p>
        <p>b</p>
      </Split>,
    );

    const grid = container.firstElementChild?.className ?? '';
    expect(grid).toContain('grid');
    expect(grid).toMatch(/md:grid-cols/);
  });

  it('gives the first block more room when asked for an uneven ratio', () => {
    const template = (ratio: '50/50' | '60/40' | '40/60'): string => {
      const { container } = render(
        <Split ratio={ratio}>
          <p>a</p>
          <p>b</p>
        </Split>,
      );
      return container.firstElementChild?.className ?? '';
    };

    // The whole reason the prop exists: a curve beside three bullets should not
    // take half the slide from the text it illustrates.
    expect(template('60/40')).toContain('md:grid-cols-[3fr_2fr]');
    expect(template('40/60')).toContain('md:grid-cols-[2fr_3fr]');
    expect(template('50/50')).toContain('md:grid-cols-2');
  });

  it.each([
    ['one block', 1],
    ['three blocks', 3],
  ])('tells the author when it gets %s instead of two', (_label, count) => {
    const { container } = render(
      <Split>
        {Array.from({ length: count }, (_, i) => (
          <p key={i}>bloque</p>
        ))}
      </Split>,
    );

    // Same reasoning as SideBySide: with three blocks the pairing is ambiguous,
    // and guessing would silently drop one.
    expect(container.textContent).toContain('<Split>');
    expect(container.querySelector('.grid')).toBeNull();
  });

  it('does not tell its children they are inside a frame', () => {
    // This is the line between Split and SideBySide, and it is behaviour rather
    // than looks: SideBySide draws a border and a language chip, so it declares
    // itself embedded and the editor inside drops its own chrome (#85). A Split
    // draws nothing, so a fence inside it must keep its frame, its filename and
    // its gutter.
    render(
      <Split>
        <EmbeddedProbe />
        <p>derecha</p>
      </Split>,
    );

    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });

  it('keeps the full column without cancelling prose styling', () => {
    // `measure-full`, not `not-prose` (ADR-0022): a Split's columns usually hold
    // running text — bullets beside a figure — and `not-prose` would strip the
    // typography from exactly the half that needs it.
    const { container } = render(
      <Split>
        <p>a</p>
        <p>b</p>
      </Split>,
    );

    const grid = container.firstElementChild?.className ?? '';
    expect(grid).toContain('measure-full');
    expect(grid).not.toContain('not-prose');
  });
});
