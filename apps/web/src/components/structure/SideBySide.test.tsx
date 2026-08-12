import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SideBySide } from './SideBySide';

describe('SideBySide', () => {
  it('renders both blocks with their labels', () => {
    render(
      <SideBySide left="C++" right="Java">
        <pre>std::cout</pre>
        <pre>System.out</pre>
      </SideBySide>,
    );

    expect(screen.getByText('C++')).toBeInTheDocument();
    expect(screen.getByText('Java')).toBeInTheDocument();
    expect(screen.getByText('std::cout')).toBeInTheDocument();
    expect(screen.getByText('System.out')).toBeInTheDocument();
  });

  it('keeps the authored order — first block on the left', () => {
    const { container } = render(
      <SideBySide left="C++" right="Java">
        <pre>primero</pre>
        <pre>segundo</pre>
      </SideBySide>,
    );

    const text = container.textContent ?? '';
    expect(text.indexOf('primero')).toBeLessThan(text.indexOf('segundo'));
  });

  it('renders without labels', () => {
    render(
      <SideBySide>
        <pre>uno</pre>
        <pre>dos</pre>
      </SideBySide>,
    );
    expect(screen.getByText('uno')).toBeInTheDocument();
    expect(screen.getByText('dos')).toBeInTheDocument();
  });

  it('ignores the whitespace MDX puts between blocks', () => {
    render(
      <SideBySide left="C++" right="Java">
        {'\n'}
        <pre>uno</pre>
        {'\n'}
        <pre>dos</pre>
        {'\n'}
      </SideBySide>,
    );
    expect(screen.getByText('uno')).toBeInTheDocument();
    expect(screen.queryByText(/espera exactamente dos bloques/)).not.toBeInTheDocument();
  });

  it('tells the author when there are not exactly two blocks', () => {
    render(
      <SideBySide left="C++" right="Java">
        <pre>solo uno</pre>
      </SideBySide>,
    );
    expect(screen.getByText(/espera exactamente dos bloques; recibió 1/)).toBeInTheDocument();
  });
});
