import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { MemoryDiagram } from './MemoryDiagram';

/** What the MDX pipeline hands the component for an annotated fence. */
function fence(meta: string, code: string): ReactNode {
  return (
    <pre>
      <code className="language-java" data-meta={meta}>
        {code}
      </code>
    </pre>
  );
}

const GOOD = `public class Demo {
    public static void main(String[] args) {
        int a = 1;   // foto a
    }
}
`;

// Execution is NOT exercised here: every runtime is faked in jsdom, so what a
// run returns would be the fake's answer rather than the tracer's
// (apps/web/CLAUDE.md §the suite cannot execute code). The browser check at S7
// covers that. What is testable here is what the component does before and
// around a run.

describe('MemoryDiagram', () => {
  it('shows the snippet before anything has been run', () => {
    render(<MemoryDiagram title="Alias">{fence('trace', GOOD)}</MemoryDiagram>);

    expect(screen.getByText(/public class Demo/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Ejecutar y dibujar/ })).toBeInTheDocument();
  });

  it('hides the markers from the reader', () => {
    // Scaffolding the lesson does not include: a student writing this program
    // would not write `// foto a`.
    render(<MemoryDiagram>{fence('trace', GOOD)}</MemoryDiagram>);

    expect(screen.queryByText(/\/\/ foto/)).not.toBeInTheDocument();
    expect(screen.getByText(/int a = 1;/)).toBeInTheDocument();
  });

  it('renders the prose written beside the fence', () => {
    render(
      <MemoryDiagram>
        <p>Mira lo que pasa con la referencia.</p>
        {fence('trace', GOOD)}
      </MemoryDiagram>,
    );

    expect(screen.getByText('Mira lo que pasa con la referencia.')).toBeInTheDocument();
  });

  it('tells the author when the fence is missing, instead of rendering nothing', () => {
    render(
      <MemoryDiagram>
        <p>Sin cerca.</p>
      </MemoryDiagram>,
    );

    expect(screen.getByText(/sin bloque/i)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Ejecutar/ })).not.toBeInTheDocument();
  });

  it('tells the author when the snippet has no markers at all', () => {
    render(<MemoryDiagram>{fence('trace', 'int a = 1;')}</MemoryDiagram>);

    expect(screen.getByText(/ninguna línea marcada/i)).toBeInTheDocument();
  });

  it('lists what is wrong with a malformed marker', () => {
    render(<MemoryDiagram>{fence('trace', 'int a = 1; // foto 2b')}</MemoryDiagram>);

    expect(screen.getByText(/«2b»/)).toBeInTheDocument();
  });

  it('refuses a snippet that declares the tracer itself', () => {
    render(
      <MemoryDiagram>
        {fence('trace', ['class NalandaTrace { }', 'int a = 1; // foto a'].join('\n'))}
      </MemoryDiagram>,
    );

    expect(screen.getByText(/NalandaTrace.*reservado/i)).toBeInTheDocument();
  });
});
