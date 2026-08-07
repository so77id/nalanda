import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';

import { SectionBreak } from './SectionBreak';

describe('SectionBreak', () => {
  it('renders a subtle divider in book mode', () => {
    render(<SectionBreak />);
    expect(screen.getByRole('separator')).toBeInTheDocument();
  });

  it('renders nothing in presentation mode', () => {
    const { container } = render(
      <ModeProvider mode="presentation">
        <SectionBreak />
      </ModeProvider>,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
