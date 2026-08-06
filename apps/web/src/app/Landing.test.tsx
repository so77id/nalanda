import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Landing } from './Landing';

describe('Landing', () => {
  it('renders the platform name as the main heading', () => {
    render(<Landing />);
    expect(screen.getByRole('heading', { level: 1, name: 'Nalanda' })).toBeInTheDocument();
  });
});
