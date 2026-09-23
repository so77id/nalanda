import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SheetEmbed } from './SheetEmbed';

const ID = '1_cxMUbcF9Tscd3_4Nu71HiXy-MZuaz28IapmvhS7FkM';
const SHARE = `https://docs.google.com/spreadsheets/d/${ID}/edit?usp=sharing`;
const TITLE = 'Planificacion del curso';

const frameOf = (container: HTMLElement) => container.querySelector('iframe');

describe('SheetEmbed', () => {
  it('frames the sheet at the url Google will actually serve', () => {
    const { container } = render(<SheetEmbed src={SHARE} title={TITLE} />);

    expect(frameOf(container)?.getAttribute('src')).toBe(
      `https://docs.google.com/spreadsheets/d/${ID}/preview`,
    );
  });

  it('names the frame so a screen reader can identify it', () => {
    render(<SheetEmbed src={SHARE} title={TITLE} />);

    // An iframe's accessible name comes from `title` and nowhere else: with no
    // title it is announced as an unnamed frame the reader cannot skip past.
    expect(screen.getByTitle(TITLE).tagName).toBe('IFRAME');
  });

  it('tells the author when the title is missing', () => {
    // Same runtime contract as <Figure>'s alt (ADR-0029): MDX is not
    // typechecked, and the reader who needs the name is the one who cannot see
    // that it is missing.
    const { container } = render(<SheetEmbed src={SHARE} />);

    expect(container.textContent).toContain('<SheetEmbed>');
    expect(container.textContent).toMatch(/title/);
    expect(frameOf(container)).toBeNull();
  });

  it('tells the author when the title is empty', () => {
    const { container } = render(<SheetEmbed src={SHARE} title="" />);

    expect(container.textContent).toContain('<SheetEmbed>');
    expect(container.textContent).toMatch(/title/);
    expect(frameOf(container)).toBeNull();
  });

  it('tells the author when there is no src', () => {
    const { container } = render(<SheetEmbed title={TITLE} />);

    expect(container.textContent).toContain('<SheetEmbed>');
    expect(container.textContent).toMatch(/src/);
    expect(frameOf(container)).toBeNull();
  });

  it('tells the author when the src is not a Google Sheets link', () => {
    // The failure this replaces is silent: a wrong host frames something, and
    // a refused one frames nothing, both with the suite green and the page
    // looking merely empty.
    const { container } = render(<SheetEmbed src="https://example.com/plan.xlsx" title={TITLE} />);

    expect(container.textContent).toContain('<SheetEmbed>');
    // The message is the whole product of an AuthoringError, so it is pinned
    // rather than merely present: the shape it must name, the trap it must warn
    // about, and the echo of the value that makes the error actionable. All
    // three were droppable while green.
    expect(container.textContent).toMatch(/Compartir/);
    expect(container.textContent).toMatch(/Publicar en la web/);
    expect(container.textContent).toContain('https://example.com/plan.xlsx');
    expect(frameOf(container)).toBeNull();
  });

  describe('the frame permissions (AC5)', () => {
    // Every value here was measured in a real browser against the course's own
    // sheet on 2026-08-16, not inherited by omission. The probe is recorded in
    // docs/security-notes.md.
    it('runs the frame in an opaque origin', () => {
      const { container } = render(<SheetEmbed src={SHARE} title={TITLE} />);
      // Asserted before the negatives below, and not defaulted to '': a frame
      // with NO sandbox attribute grants everything they claim to deny, and
      // `?? ''` let all three of them pass in exactly that case.
      expect(frameOf(container)?.hasAttribute('sandbox')).toBe(true);
      const sandbox = frameOf(container)?.getAttribute('sandbox') ?? '';

      // `allow-same-origin` would hand the frame its Google origin back, and
      // the sheet renders and scrolls without it — so it is not granted.
      expect(sandbox).not.toContain('allow-same-origin');
      // Nothing in a read-only embed needs to navigate the page around it.
      expect(sandbox).not.toContain('allow-top-navigation');
      expect(sandbox).not.toContain('allow-forms');
    });

    it('lets the sheet run its own scripts, which is what renders the grid', () => {
      const { container } = render(<SheetEmbed src={SHARE} title={TITLE} />);

      expect(frameOf(container)?.getAttribute('sandbox')).toContain('allow-scripts');
    });

    it('lets a link in a cell open, and open unsandboxed', () => {
      // The course plan carries 14 `target="_blank"` links to the class decks.
      // Measured: without `allow-popups` the click is swallowed with only a
      // console error the reader never sees; with it but WITHOUT
      // `allow-popups-to-escape-sandbox` the deck opens and Google Slides then
      // fails with "Se produjo un error", because the new tab inherits this
      // sandbox. The pair is load-bearing — neither half works alone.
      const { container } = render(<SheetEmbed src={SHARE} title={TITLE} />);
      const sandbox = frameOf(container)?.getAttribute('sandbox') ?? '';

      expect(sandbox).toContain('allow-popups');
      expect(sandbox).toContain('allow-popups-to-escape-sandbox');
    });

    it('does not tell Google which page the reader came from', () => {
      const { container } = render(<SheetEmbed src={SHARE} title={TITLE} />);

      expect(frameOf(container)?.getAttribute('referrerpolicy')).toBe('no-referrer');
    });
  });

  // The frame around the iframe — the slide cap, the placeholder under it,
  // `not-prose` — is EmbedFrame's and pinned in EmbedFrame.test.tsx. What is
  // left here is what this component chooses: its height and its words.
  describe('its frame', () => {
    const heightOf = (container: HTMLElement) =>
      (container.firstElementChild as HTMLElement | null)?.style.height;

    it('takes the height the author asked for', () => {
      const { container } = render(<SheetEmbed src={SHARE} title={TITLE} height={600} />);

      expect(heightOf(container)).toBe('600px');
    });

    it('has a height of its own when the author gives none', () => {
      // An iframe has no content-driven height: unset, it is 150px of nothing.
      const { container } = render(<SheetEmbed src={SHARE} title={TITLE} />);

      expect(heightOf(container)).toBe('480px');
    });

    it('says what is loading', () => {
      render(<SheetEmbed src={SHARE} title={TITLE} />);

      expect(screen.getByText('Cargando la planilla…')).toBeInTheDocument();
    });
  });
});
