import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MdxPre } from './MdxPre';

// What MdxPre decides is WHICH renderer a fence reaches and with what — the
// editor's own behaviour is its suite's business, and reaching for it here would
// drag CodeMirror and a runtime into a test about a seam. So the wrapper is
// replaced by something that simply reports the props it was handed.
vi.mock('./interactive/lazyCodeEditor', () => ({
  LazyCodeEditor: (props: Record<string, unknown>) => (
    <div
      data-testid="editor"
      data-language={String(props['language'])}
      data-variant={String(props['variant'])}
      data-source={String(props['defaultValue'])}
    />
  ),
}));

/** What the MDX pipeline hands `pre` — shape verified against the real pipeline. */
function fence(language: string | undefined, source: string) {
  return (
    <MdxPre>
      <code className={language === undefined ? undefined : `language-${language}`}>{source}</code>
    </MdxPre>
  );
}

describe('MdxPre', () => {
  it('sends a fence in a language the platform runs to the editor', () => {
    render(fence('java', 'class A {}\n'));

    const editor = screen.getByTestId('editor');
    expect(editor.dataset['language']).toBe('java');
    expect(editor.dataset['source']).toBe('class A {}');
  });

  it('asks for the reading chrome: numbered and copyable, never runnable', () => {
    // `snippet` is the variant that was designed for this and wired to nothing
    // (variants.ts): line numbers and a copy button, no editing, no runtime.
    render(fence('cpp', 'int main() {}\n'));

    expect(screen.getByTestId('editor').dataset['variant']).toBe('snippet');
  });

  it('keeps the blank lines of the listing, dropping only the fence break', () => {
    render(fence('python', 'a = 1\n\nb = 2\n'));

    expect(screen.getByTestId('editor').dataset['source']).toBe('a = 1\n\nb = 2');
  });

  it('leaves a fence with no language as plain markup', () => {
    // The two ASCII diagrams in 06-java-desde-cpp.mdx are exactly this.
    const { container } = render(fence(undefined, 'programa.cpp -> [g++] -> programa\n'));

    expect(container.querySelector('pre')).not.toBeNull();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  });

  it('leaves a fence in a language the platform cannot run as plain markup', () => {
    const { container } = render(fence('bash', 'npm run build\n'));

    expect(container.querySelector('pre')).not.toBeNull();
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  });

  it('keeps a pre that holds something other than a fence', () => {
    const { container } = render(
      <MdxPre>
        <span>no soy una cerca</span>
      </MdxPre>,
    );

    expect(container.querySelector('pre')?.textContent).toBe('no soy una cerca');
    expect(screen.queryByTestId('editor')).not.toBeInTheDocument();
  });
});
