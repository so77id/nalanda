import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import type { CatalogEntry } from '../lib/catalogEntry';

import { ComponentArticle } from './ComponentArticle';

const entry: CatalogEntry = {
  name: 'Demo',
  family: 'structure',
  description: 'A demo component for the template test.',
  whenToUse: 'Only inside this test.',
  props: [
    { name: 'title', type: 'string', description: 'Heading shown in book mode.' },
    { name: 'open', type: 'boolean', default: 'false', description: 'Starts expanded.' },
  ],
  examples: [
    { title: 'Basic', code: '<Demo title="hola" />', render: () => <em>live one</em> },
    { title: 'Open', code: '<Demo open />', render: () => <em>live two</em> },
  ],
};

function renderArticle() {
  render(
    <MemoryRouter>
      <ComponentArticle entry={entry} />
    </MemoryRouter>,
  );
}

describe('ComponentArticle', () => {
  it('renders name, description and when-to-use', () => {
    renderArticle();
    expect(screen.getByRole('heading', { name: 'Demo' })).toBeInTheDocument();
    expect(screen.getByText('A demo component for the template test.')).toBeInTheDocument();
    expect(screen.getByText('Only inside this test.')).toBeInTheDocument();
  });

  it('renders the props table with defaults', () => {
    renderArticle();
    const table = screen.getByRole('table');
    expect(table).toHaveTextContent('title');
    expect(table).toHaveTextContent('string');
    expect(table).toHaveTextContent('Heading shown in book mode.');
    expect(table).toHaveTextContent('false');
  });

  it('says the Spanish in the examples is the course speaking, not a leftover', () => {
    // The catalog writes English; the examples embed course content and render
    // widgets whose own chrome is Spanish (root CLAUDE.md). Without a word from
    // the page, that mix reads as the half-translated state #87 removed.
    renderArticle();
    expect(
      screen.getByText(/course content.*Spanish|Spanish.*course content/i),
    ).toBeInTheDocument();
  });

  it('renders every example with its live output and source snippet', () => {
    renderArticle();
    expect(screen.getByRole('heading', { name: 'Basic' })).toBeInTheDocument();
    expect(screen.getByText('live one')).toBeInTheDocument();
    expect(screen.getByText('<Demo title="hola" />')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Open' })).toBeInTheDocument();
    expect(screen.getByText('live two')).toBeInTheDocument();
  });
});
