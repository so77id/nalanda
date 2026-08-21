import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';

import { ModeProvider } from '../../presentation';
import { VideoEmbed, youtubeVideoId } from './VideoEmbed';

function renderIn(mode: 'book' | 'presentation', node: React.ReactNode) {
  return render(
    <MemoryRouter>
      <ModeProvider mode={mode}>{node}</ModeProvider>
    </MemoryRouter>,
  );
}

describe('youtubeVideoId', () => {
  it('extracts the id from a canonical watch URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/watch?v=S1PVPluvV9I')).toBe('S1PVPluvV9I');
  });

  it('extracts the id from a youtu.be short link', () => {
    expect(youtubeVideoId('https://youtu.be/S1PVPluvV9I')).toBe('S1PVPluvV9I');
  });

  it('extracts the id from an /embed/ URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/embed/S1PVPluvV9I')).toBe('S1PVPluvV9I');
  });

  it('extracts the id from a /shorts/ URL', () => {
    expect(youtubeVideoId('https://www.youtube.com/shorts/S1PVPluvV9I')).toBe('S1PVPluvV9I');
  });

  it('accepts m.youtube.com', () => {
    expect(youtubeVideoId('https://m.youtube.com/watch?v=S1PVPluvV9I')).toBe('S1PVPluvV9I');
  });

  it('returns null for a non-YouTube URL', () => {
    expect(youtubeVideoId('https://vimeo.com/12345')).toBeNull();
  });

  it('returns null for garbage input', () => {
    expect(youtubeVideoId('not a url')).toBeNull();
  });
});

describe('VideoEmbed', () => {
  it('shows an authoring error when src is missing', () => {
    renderIn('book', <VideoEmbed title="algo" />);
    expect(screen.getByText(/necesita un src/i)).toBeInTheDocument();
  });

  it('shows an authoring error when title is missing', () => {
    renderIn('book', <VideoEmbed src="https://youtu.be/S1PVPluvV9I" />);
    expect(screen.getByText(/necesita un title/i)).toBeInTheDocument();
  });

  it('shows an authoring error for a non-YouTube URL', () => {
    renderIn('book', <VideoEmbed src="https://vimeo.com/12345" title="test" />);
    expect(screen.getByText(/enlace de YouTube/i)).toBeInTheDocument();
  });

  it('renders an iframe pointing at the youtube /embed URL for the extracted id', () => {
    renderIn(
      'book',
      <VideoEmbed src="https://www.youtube.com/watch?v=S1PVPluvV9I" title="Video de prueba" />,
    );
    const frame = screen.getByTitle('Video de prueba');
    expect(frame).toHaveAttribute('src', 'https://www.youtube.com/embed/S1PVPluvV9I');
    expect(frame.tagName).toBe('IFRAME');
  });

  it('does NOT sandbox the frame (YouTube player needs its own storage / cookies)', () => {
    renderIn('book', <VideoEmbed src="https://youtu.be/S1PVPluvV9I" title="prueba" />);
    const frame = screen.getByTitle('prueba');
    // See VideoEmbed.tsx: an iframe pointing at youtube.com is already in
    // its own origin, and adding `sandbox` breaks the player with a
    // "configuration error 153" (measured 2026-08-21 against the QuantumFracture
    // Turing-analogy video). Contrast with SheetEmbed, which we deliberately
    // do sandbox.
    expect(frame.hasAttribute('sandbox')).toBe(false);
  });

  it('declares the `allow` features the YouTube player asks for', () => {
    renderIn('book', <VideoEmbed src="https://youtu.be/S1PVPluvV9I" title="prueba" />);
    const frame = screen.getByTitle('prueba');
    const allow = frame.getAttribute('allow') ?? '';
    // Matches YouTube's own oEmbed HTML — anything missing here has been
    // measured to break at least one video's player.
    expect(allow).toContain('autoplay');
    expect(allow).toContain('encrypted-media');
    expect(allow).toContain('picture-in-picture');
  });

  it('caps its height against the slide budget in presentation mode', () => {
    const { container } = renderIn(
      'presentation',
      <VideoEmbed src="https://youtu.be/S1PVPluvV9I" title="prueba" height={800} />,
    );
    const wrapper = container.querySelector('div.not-prose') as HTMLElement | null;
    expect(wrapper?.style.height).toContain('min(800px');
  });
});
