import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

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
      //   and the spinner never resolves. Safe only while the frame is never
      //   this site's origin: drivePreviewUrl pins where it starts, and only
      //   Drive's own viewer can navigate it after that.
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

  // The frame around the iframe — the slide cap, the placeholder under it,
  // `not-prose` — is EmbedFrame's and pinned in EmbedFrame.test.tsx. What is
  // left here is what this component chooses: its height and its words.
  describe('its frame', () => {
    const heightOf = (container: HTMLElement) =>
      (container.firstElementChild as HTMLElement | null)?.style.height;

    it('takes the height the author asked for', () => {
      const { container } = render(<PdfEmbed src={SHARE} title={TITLE} height={600} />);

      expect(heightOf(container)).toBe('600px');
    });

    it('has a height of its own when the author gives none', () => {
      // An iframe has no content-driven height: unset, it is 150px of nothing.
      const { container } = render(<PdfEmbed src={SHARE} title={TITLE} />);

      expect(heightOf(container)).toBe('800px');
    });

    it('says what is loading', () => {
      render(<PdfEmbed src={SHARE} title={TITLE} />);

      expect(screen.getByText('Cargando el documento…')).toBeInTheDocument();
    });
  });
});
