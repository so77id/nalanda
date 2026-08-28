import { render, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Math } from './Math';

describe('Math', () => {
  it('renders inline math through KaTeX (lazy)', async () => {
    // Same load pattern as `renderInlineTitle`: the KaTeX chunk is
    // dynamic, so the initial render shows the raw-source fallback and
    // the KaTeX HTML replaces it once the chunk lands.
    const { container } = render(<Math>{`T(N) = T(N-1) + c`}</Math>);
    await waitFor(() => {
      expect(container.querySelector('.katex')).not.toBeNull();
    });
    // Inline mode wraps in a <span>, not the KaTeX display div.
    expect(container.querySelector('.katex-display')).toBeNull();
  });

  it('renders block math with a display-mode container', async () => {
    const { container } = render(<Math block>{`\\Theta(N)`}</Math>);
    await waitFor(() => {
      expect(container.querySelector('.katex-display')).not.toBeNull();
    });
  });
});
