import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { PdfEmbed } from './PdfEmbed';

const ID = '1v3B7n1hAHUUXt1iUlAYTGvXVTXrmYlRT';
const SHARE = `https://drive.google.com/file/d/${ID}/view?usp=sharing`;
const TITLE = 'Pauta del Control 1';

const frameOf = (container: HTMLElement) => container.querySelector('iframe');

describe('PdfEmbed', () => {
  it('frames the file at the viewer url Drive will actually serve', () => {
    const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

    expect(frameOf(container)?.getAttribute('src')).toBe(
      `https://drive.google.com/file/d/${ID}/preview`,
    );
  });

  it('names the frame so a screen reader can identify it', () => {
    render(<PdfEmbed src={SHARE} title={TITLE} />);

    expect(screen.getByTitle(TITLE).tagName).toBe('IFRAME');
  });

  it('tells the author when the title is missing', () => {
    const { container } = render(<PdfEmbed src={SHARE} />);

    expect(container.textContent).toContain('<PdfEmbed>');
    expect(container.textContent).toMatch(/title/);
    expect(frameOf(container)).toBeNull();
  });

  it('tells the author when the title is empty', () => {
    const { container } = render(<PdfEmbed src={SHARE} title="" />);

    expect(container.textContent).toContain('<PdfEmbed>');
    expect(container.textContent).toMatch(/title/);
    expect(frameOf(container)).toBeNull();
  });

  it('tells the author when there is no src', () => {
    const { container } = render(<PdfEmbed title={TITLE} />);

    expect(container.textContent).toContain('<PdfEmbed>');
    expect(container.textContent).toMatch(/src/);
    expect(frameOf(container)).toBeNull();
  });

  it('tells the author when the src is not a Drive file link', () => {
    // The likeliest mistake is a PDF url from anywhere else — which this
    // component would frame with `allow-same-origin` if it accepted it.
    const { container } = render(<PdfEmbed src="https://example.com/pauta.pdf" title={TITLE} />);

    expect(container.textContent).toContain('<PdfEmbed>');
    expect(container.textContent).toMatch(/Compartir/);
    expect(container.textContent).toMatch(/drive\.google\.com/);
    expect(container.textContent).toContain('https://example.com/pauta.pdf');
    expect(frameOf(container)).toBeNull();
  });

  describe('the frame permissions', () => {
    // Measured 2026-09-22 in Chromium and WebKit against Control 1's pauta;
    // the record is in ADR-0076 and docs/security-notes.md.
    const sandboxOf = (container: HTMLElement) => {
      // Asserted, not defaulted: a frame with NO sandbox attribute grants
      // everything the negatives below claim to deny.
      expect(frameOf(container)?.hasAttribute('sandbox')).toBe(true);
      return frameOf(container)?.getAttribute('sandbox') ?? '';
    };

    it('grants exactly the four tokens Drive’s viewer was measured to need', () => {
      const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

      // - allow-scripts: the viewer is a script; nothing paints without it.
      // - allow-same-origin: without it the viewer's own requests are cancelled
      //   and the spinner never resolves. Safe here only because the frame is
      //   drive.google.com, never this site's origin — which drivePreviewUrl's
      //   anchored host guarantees.
      // - allow-popups: the viewer's pop-out button; without it the click does
      //   nothing.
      // - allow-popups-to-escape-sandbox: without it the popped-out tab
      //   inherits this sandbox and its download button downloads nothing.
      expect(sandboxOf(container).split(' ').sort()).toEqual([
        'allow-popups',
        'allow-popups-to-escape-sandbox',
        'allow-same-origin',
        'allow-scripts',
      ]);
    });

    it('does not tell Google which page the reader came from', () => {
      const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

      expect(frameOf(container)?.getAttribute('referrerpolicy')).toBe('no-referrer');
    });
  });

  describe('how tall it is', () => {
    const heightOf = (container: HTMLElement) =>
      (container.firstElementChild as HTMLElement | null)?.style.height;

    it('takes the height the author asked for, in the book', () => {
      const { container } = render(<PdfEmbed src={SHARE} title={TITLE} height={600} />);

      expect(heightOf(container)).toBe('600px');
    });

    it('has a height of its own when the author gives none', () => {
      const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

      expect(heightOf(container)).toBe('800px');
    });

    it('caps itself against the stage on a slide', () => {
      const { container } = render(
        <ModeProvider mode="presentation">
          <PdfEmbed src={SHARE} title={TITLE} />
        </ModeProvider>,
      );

      expect(heightOf(container)).toBe('min(800px, 64vh)');
    });
  });

  it('says something is coming while the frame is still transparent', () => {
    const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

    const hint = screen.getByText(/Cargando el documento/);
    expect(hint.getAttribute('aria-hidden')).toBe('true');
    expect(hint.compareDocumentPosition(frameOf(container) as Node)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  it('marks itself out of the reading measure', () => {
    const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

    expect(container.firstElementChild?.className).toContain('not-prose');
  });
});
