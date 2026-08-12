import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { ModeProvider } from '../../presentation';
import { SideBySide } from './SideBySide';

describe('SideBySide', () => {
  it('sets the code smaller on a slide than in the book', () => {
    const scale = (mode: 'book' | 'presentation'): string | undefined => {
      const { container } = render(
        <ModeProvider mode={mode}>
          <SideBySide left="C++" right="Java">
            <pre>uno</pre>
            <pre>dos</pre>
          </SideBySide>
        </ModeProvider>,
      );
      return [...container.querySelectorAll('div')]
        .flatMap((el) => [...el.classList])
        .find((name) => name.startsWith('text-['));
    };

    // Measured at 1440px: a slide gives each column 440px and sets code at 16px,
    // where `System.out.println("Bienvenidos a EDA");` needs 462px — the closing
    // `);` fell off the slide that exists to teach that exact line. The book, at
    // 12.8px, fits in 376 of 376.
    expect(scale('book')).toBe('text-[0.8em]');
    expect(scale('presentation')).toBe('text-[0.72em]');
  });

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
