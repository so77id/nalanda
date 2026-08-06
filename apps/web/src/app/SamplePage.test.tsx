import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SamplePage } from './SamplePage';

describe('SamplePage', () => {
  it('renders the compiled sample MDX document', () => {
    render(<SamplePage />);
    expect(screen.getByRole('heading', { name: 'Hola MDX' })).toBeInTheDocument();
    expect(screen.getByText(/pipeline works/i)).toBeInTheDocument();
  });
});
