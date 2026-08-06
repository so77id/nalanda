import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { MdxLink } from './MdxLink';

function renderLink(href: string, text: string) {
  render(
    <MemoryRouter>
      <MdxLink href={href}>{text}</MdxLink>
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('MdxLink', () => {
  it('resolves a wiki: href against the registry into an internal link', () => {
    renderLink('wiki:bienvenida', 'el documento');
    const link = screen.getByRole('link', { name: 'el documento' });
    expect(link).toHaveAttribute('href', '/d/bienvenida');
  });

  it('renders an unresolved wiki: href as a visibly broken link and warns', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderLink('wiki:nope', 'roto');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('roto')).toHaveClass('decoration-wavy');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[[nope]]'));
  });

  it('passes ordinary safe hrefs through as plain anchors', () => {
    renderLink('https://example.com', 'externo');
    const link = screen.getByRole('link', { name: 'externo' });
    expect(link).toHaveAttribute('href', 'https://example.com');
    expect(link).toHaveAttribute('rel', 'noopener noreferrer');
  });

  it('allows relative and fragment hrefs without an external rel', () => {
    renderLink('#seccion', 'ancla');
    const link = screen.getByRole('link', { name: 'ancla' });
    expect(link).toHaveAttribute('href', '#seccion');
    expect(link).not.toHaveAttribute('rel');
  });

  it('refuses unsafe URL schemes, rendering them visibly broken', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    renderLink('javascript:alert(1)', 'peligroso');

    expect(screen.queryByRole('link')).not.toBeInTheDocument();
    expect(screen.getByText('peligroso')).toHaveClass('decoration-wavy');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unsafe href'));
  });
});
