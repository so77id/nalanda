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
    const broken = screen.getByText('roto');
    expect(broken).toHaveClass('broken-link');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('[[nope]]'));
  });

  it('passes ordinary hrefs through as plain anchors', () => {
    renderLink('https://example.com', 'externo');
    expect(screen.getByRole('link', { name: 'externo' })).toHaveAttribute(
      'href',
      'https://example.com',
    );
  });
});
