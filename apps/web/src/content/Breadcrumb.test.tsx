import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Breadcrumb } from './Breadcrumb';
import type { Trail } from './courseIndex';

function renderTrail(trail: Trail) {
  render(<Breadcrumb trail={trail} />);
}

describe('Breadcrumb', () => {
  it('names the course, then each ancestor group, then the position', () => {
    renderTrail({
      course: 'Estructuras de Datos',
      ancestors: [{ label: 'Java para quien viene de C++', levelName: 'Unidad' }],
      position: { at: 1, of: 6 },
    });

    const nav = screen.getByRole('navigation', { name: /location/i });
    expect(nav).toHaveTextContent(
      /Estructuras de Datos.*Unidad.*Java para quien viene de C\+\+.*1 de 6/,
    );
  });

  it('renders every ancestor level, not only the deepest', () => {
    renderTrail({
      course: 'Curso',
      ancestors: [{ label: 'Unidad 1' }, { label: 'Anexos' }],
      position: { at: 2, of: 3 },
    });

    expect(screen.getByText('Unidad 1')).toBeInTheDocument();
    expect(screen.getByText('Anexos')).toBeInTheDocument();
  });

  it('shows the course alone for a document the index does not list', () => {
    renderTrail({ course: 'Estructuras de Datos', ancestors: [] });

    expect(screen.getByRole('navigation', { name: /location/i })).toHaveTextContent(
      'Estructuras de Datos',
    );
    expect(screen.queryByText(/\d+ de \d+/)).not.toBeInTheDocument();
  });

  it('renders nothing at all when the index knows neither course nor place', () => {
    // An untitled index plus an unlisted document: an empty bar with a rule
    // under it would be chrome that says nothing.
    renderTrail({ ancestors: [] });

    expect(screen.queryByRole('navigation', { name: /location/i })).not.toBeInTheDocument();
  });
});
