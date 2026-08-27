import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { renderInlineTitle } from './inlineTitle';

describe('renderInlineTitle', () => {
  it('passes through a plain string with no delimiters', () => {
    const { container } = render(<>{renderInlineTitle('Un título sin nada especial')}</>);
    expect(container.textContent).toBe('Un título sin nada especial');
    // No <span>, no <code>, no katex output.
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.querySelector('code')).toBeNull();
  });

  it('renders $$...$$ segments through KaTeX', async () => {
    // KaTeX is lazy-loaded through Suspense so it never ships in the entry
    // chunk (architecture.test.ts). The initial render shows the raw LaTeX
    // fallback; once the chunk lands, the KaTeX HTML replaces it.
    const { container } = render(<>{renderInlineTitle('Factorial: $$T(N) = T(N-1) + c$$')}</>);
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull();
    });
    // The leading text is preserved.
    expect(container.textContent).toContain('Factorial:');
  });

  it('renders backticked segments as inline code', () => {
    const { container } = render(<>{renderInlineTitle('Verificación con `<Benchmark>`')}</>);
    const code = container.querySelector('code');
    expect(code).not.toBeNull();
    expect(code!.textContent).toBe('<Benchmark>');
    expect(container.textContent).toBe('Verificación con <Benchmark>');
  });

  it('mixes text, math, and code in a single title', async () => {
    const { container } = render(<>{renderInlineTitle('Ver `foo()` en $$O(n)$$ ahora')}</>);
    // Inline code renders synchronously.
    const code = container.querySelector('code');
    expect(code!.textContent).toBe('foo()');
    // Math waits for the KaTeX chunk.
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    expect(container.textContent).toContain('Ver');
    expect(container.textContent).toContain('ahora');
  });

  it('handles complex LaTeX with \\Theta and \\Rightarrow', async () => {
    const { container } = render(
      <>{renderInlineTitle('El costo: $$T(N) = T(N-1) + O(1) \\Rightarrow \\Theta(N)$$')}</>,
    );
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    // MathML output is legible for the assertion: KaTeX emits both HTML
    // and MathML so screen readers get the semantic text.
    expect(container.querySelector('math')).not.toBeNull();
  });

  it('handles a title that STARTS with math', async () => {
    const { container } = render(<>{renderInlineTitle('$$\\Theta(2^N)$$ intrínseco')}</>);
    await waitFor(() => expect(container.querySelector('.katex')).not.toBeNull());
    expect(container.textContent).toContain('intrínseco');
  });

  it('treats an unbalanced $$ as literal text (author error stays visible)', () => {
    const { container } = render(<>{renderInlineTitle('Costo $$O(N)')}</>);
    // The unmatched `$$` remains in the text; nothing rendered through
    // KaTeX because the delimiter never closed.
    expect(container.querySelector('.katex')).toBeNull();
    expect(container.textContent).toBe('Costo $$O(N)');
  });

  it('does not swallow the rest of the title on a stray backtick', () => {
    const { container } = render(<>{renderInlineTitle('Un solo ` y ya')}</>);
    // No <code> because there is no matched closing backtick.
    expect(container.querySelector('code')).toBeNull();
    expect(container.textContent).toBe('Un solo ` y ya');
  });

  it('renders empty string as empty', () => {
    const { container } = render(<>{renderInlineTitle('')}</>);
    expect(container.textContent).toBe('');
  });
});
