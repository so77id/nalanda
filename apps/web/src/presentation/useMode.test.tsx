import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from './ModeProvider';
import { useMode } from './useMode';

function ShowMode() {
  return <span>{useMode()}</span>;
}

describe('useMode', () => {
  it('defaults to book outside any provider', () => {
    render(<ShowMode />);
    expect(screen.getByText('book')).toBeInTheDocument();
  });

  it('returns the mode set by the nearest provider', () => {
    render(
      <ModeProvider mode="presentation">
        <ShowMode />
      </ModeProvider>,
    );
    expect(screen.getByText('presentation')).toBeInTheDocument();
  });
});
