import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { MathTex } from './Math';

describe('MathTex', () => {
  it('renders inline math through KaTeX (lazy)', async () => {
    // Same load pattern as `renderInlineTitle`: the KaTeX chunk is
    // dynamic, so the initial render shows the raw-source fallback and
    // the KaTeX HTML replaces it once the chunk lands.
    const { container } = render(<MathTex>{`T(N) = T(N-1) + c`}</MathTex>);
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull();
    });
    // Inline mode wraps in a <span>, not the KaTeX display div.
    expect(container.querySelector('.katex-display')).toBeNull();
  });

  it('renders block math with a display-mode container', async () => {
    const { container } = render(<MathTex block>{`\\Theta(N)`}</MathTex>);
    await waitFor(() => {
      expect(container.querySelector('.katex-display')).not.toBeNull();
    });
  });
});
