import { render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { CodeEditor } from '../interactive/CodeEditor';
import { ModeProvider } from '../../presentation';
import { useEmbedded } from '../embedded';

// CodeMirror's editing surface is not the contract here; the basicSetup it is
// handed IS, because the gutter is what the #76 fix lives on.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value, basicSetup }: { value: string; basicSetup?: { lineNumbers?: boolean } }) => (
    <textarea
      readOnly
      value={value}
      data-testid="code"
      data-line-numbers={String(basicSetup?.lineNumbers)}
    />
  ),
}));
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

  it('defaults to horizontal — two columns on desktop', () => {
    const { container } = render(
      <SideBySide>
        <pre>uno</pre>
        <pre>dos</pre>
      </SideBySide>,
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveAttribute('data-direction', 'horizontal');
    expect(grid?.className).toContain('md:grid-cols-2');
    expect(grid?.className).not.toContain('grid-cols-1');
  });

  it('stacks unconditionally when direction="vertical"', () => {
    const { container } = render(
      <SideBySide direction="vertical">
        <pre>arriba</pre>
        <pre>abajo</pre>
      </SideBySide>,
    );
    const grid = container.querySelector('.grid');
    expect(grid).toHaveAttribute('data-direction', 'vertical');
    expect(grid?.className).toContain('grid-cols-1');
    expect(grid?.className).not.toContain('md:grid-cols-2');
  });
});

/** Reports what a column tells whatever lands inside it. */
function Probe() {
  return <span data-testid="probe">{String(useEmbedded())}</span>;
}

describe('SideBySide as a frame', () => {
  it('tells its columns that they already have a frame and a label', () => {
    // A fence in a language the platform highlights becomes a component, and a
    // component brings its own header and border. `[&_pre]` cannot reach inside
    // one, so the column would show two stacked headers and two rounded borders
    // — which is exactly what shipped before this was measured in a browser.
    render(
      <ModeProvider mode="book">
        <SideBySide left="C++" right="Java">
          <Probe />
          <Probe />
        </SideBySide>
      </ModeProvider>,
    );

    const said = screen.getAllByTestId('probe').map((el) => el.textContent);
    expect(said).toEqual(['true', 'true']);
  });

  it('says nothing of the sort outside a column', () => {
    render(<Probe />);
    expect(screen.getByTestId('probe')).toHaveTextContent('false');
  });
});

describe('SideBySide with real listings inside it', () => {
  // The joint. The two ends were pinned - the column announces the frame, the
  // editor reacts to it - but nothing put a real editor inside a real column,
  // and the 21px clipping regression of #76 lives exactly there.
  it('gives a column one frame, no repeated label, and no gutter', async () => {
    const { container } = render(
      <ModeProvider mode="book">
        <SideBySide left="C++" right="Java">
          <CodeEditor language="cpp" variant="snippet" defaultValue="int main() {}" />
          <CodeEditor language="java" variant="snippet" defaultValue="class A {}" />
        </SideBySide>
      </ModeProvider>,
    );
    await waitFor(() => expect(screen.getAllByTestId('code')).toHaveLength(2));

    const columns = [...container.querySelectorAll('.grid > *')];
    expect(columns).toHaveLength(2);
    for (const column of columns) {
      // The column keeps its own border; the shell inside it must not draw a
      // second one, which is the doubled frame the browser showed.
      const shell = column.querySelector('.not-prose');
      expect(shell, 'no editor shell inside the column').not.toBeNull();
      expect(shell?.className).not.toContain('border');
      expect(shell?.className).not.toContain('rounded');
      expect(shell?.className).not.toContain('my-6');
      // The gutter takes 20px, and the longest Java line then overflows by 21 (#76).
      expect(column.querySelector('[data-testid="code"]')?.getAttribute('data-line-numbers')).toBe(
        'false',
      );
    }
    // NOT asserted here: that the filename is absent. This file does not mock
    // the runtime, so the descriptor never resolves and 'main.cpp' could not
    // appear whatever the code did — a vacuous check. The filename rule is
    // pinned where the descriptor exists, in CodeEditor.test.tsx.
  });
});
