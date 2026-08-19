import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { Mermaid } from './Mermaid';

// jsdom implements none of the SVG layout APIs mermaid's dagre/d3 pipeline
// needs — the library refuses to render against it (ADR-0040 §Consequences).
// The library is replaced with a stub so the effect can run: what is pinned
// here is the contract the component declares — the source it hands the
// library, the svg it injects, the attributes it exposes, the theme it passes
// — and the paint itself is confirmed in a real browser in both themes
// (apps/web/CLAUDE.md §the suite cannot execute code, lay out a page…).
vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async () => ({ svg: '<svg data-testid="fake-mermaid" />' })),
  },
}));

import mermaid from 'mermaid';

const DIAGRAM = `classDiagram
    class Vehiculo {
        +describir()
    }
    class Auto
    Vehiculo <|-- Auto`;

// Same fake shape as useResolvedTheme.test.ts, duplicated on purpose: a test
// double is not a seam (testing-strategy.md §Conventions).
function prefersDark(dark: boolean) {
  window.matchMedia = ((query: string) =>
    ({
      media: query,
      matches: query.includes('prefers-color-scheme: dark') && dark,
      addEventListener: () => {},
      removeEventListener: () => {},
    }) as unknown as MediaQueryList) as typeof window.matchMedia;
}

afterEach(() => {
  vi.clearAllMocks();
  Reflect.deleteProperty(window, 'matchMedia');
  delete document.documentElement.dataset.theme;
});

describe('Mermaid', () => {
  it('shows an authoring error when the source is missing', () => {
    render(<Mermaid />);

    expect(screen.getByText(/falta la prop/)).toBeInTheDocument();
    expect(screen.queryByRole('figure')).not.toBeInTheDocument();
    // Nothing was handed to the library, and the library was not even loaded.
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('treats a blank source the same as a missing one', () => {
    render(<Mermaid source={'  \n\t'} />);

    expect(screen.getByText(/falta la prop/)).toBeInTheDocument();
    expect(mermaid.render).not.toHaveBeenCalled();
  });

  it('hands the source to the library and injects the svg it returns', async () => {
    const { container } = render(<Mermaid source={DIAGRAM} />);

    // The figure carries the semantic input the paint is derived from, so the
    // suite can pin the INPUT while the browser confirms the paint.
    const holder = container.querySelector('[data-mermaid-source]')!;
    expect(holder).toHaveAttribute('data-mermaid-source', DIAGRAM);

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    // The exact source the author wrote reaches the library — a diagram that
    // silently rendered something else would defeat the section it teaches.
    expect(mermaid.render).toHaveBeenCalledWith(expect.stringMatching(/^mermaid-/), DIAGRAM);
    await waitFor(() =>
      expect(container.querySelector('[data-testid="fake-mermaid"]')).not.toBeNull(),
    );
  });

  it('labels the figure with the title prop, or a generic label without one', () => {
    const titled = render(<Mermaid source={DIAGRAM} title="Dos jerarquías" />);
    expect(titled.getByRole('figure')).toHaveAccessibleName('Dos jerarquías');

    titled.unmount();
    const untitled = render(<Mermaid source={DIAGRAM} />);
    expect(untitled.getByRole('figure')).toHaveAccessibleName('diagrama');
  });

  it('initializes the library with the theme actually in force', async () => {
    prefersDark(true);
    render(<Mermaid source={DIAGRAM} />);

    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledTimes(1));
    // The CSS and any themed JS component must agree (useResolvedTheme.ts); a
    // pinned literal would paint one theme while the stylesheet paints the other.
    expect(mermaid.initialize).toHaveBeenCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('reports the library failure as an authoring error, and the figure stays mounted for recovery', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error on line 1'));

    render(<Mermaid source={DIAGRAM} />);

    await waitFor(() =>
      expect(screen.getByText(/Mermaid rechazó el diagrama/)).toBeInTheDocument(),
    );
    expect(screen.getByText(/Parse error on line 1/)).toBeInTheDocument();
    // The figure (and its container) stays mounted: a corrected source or a
    // theme change must be able to paint into it — the error branch cannot be
    // a dead end (review finding COR-3).
    expect(screen.getByRole('figure')).toBeInTheDocument();
  });

  it('recovers after a failed render when the attempt starts again', async () => {
    vi.mocked(mermaid.render).mockRejectedValueOnce(new Error('Parse error on line 1'));

    render(<Mermaid source={DIAGRAM} />);
    await waitFor(() =>
      expect(screen.getByText(/Mermaid rechazó el diagrama/)).toBeInTheDocument(),
    );

    // A new attempt: flip the theme — one of the effect's deps — so a fresh
    // attempt starts without touching the source. The previous error must go
    // away and the stub svg must land in the container.
    document.documentElement.dataset.theme = 'dark';

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(screen.queryByText(/Mermaid rechazó el diagrama/)).not.toBeInTheDocument(),
    );
    const figure = screen.getByRole('figure');
    await waitFor(() =>
      expect(figure.querySelector('[data-testid="fake-mermaid"]')).not.toBeNull(),
    );
  });

  it('re-renders when the theme changes after mount', async () => {
    render(<Mermaid source={DIAGRAM} />);

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(1));
    const firstCall = vi.mocked(mermaid.render).mock.calls[0]!;
    expect(firstCall[0]).toMatch(/^mermaid-/);

    // The attribute half of useResolvedTheme: stamping the root fires the
    // MutationObserver the hook subscribes with, so the effect re-runs with
    // the new theme. (The id staying identical across re-renders is React's
    // own useId contract, not something this component adds — the contract
    // here is that the theme flip triggers a fresh render.)
    document.documentElement.dataset.theme = 'dark';

    await waitFor(() => expect(mermaid.render).toHaveBeenCalledTimes(2));
    const secondCall = vi.mocked(mermaid.render).mock.calls[1]!;
    expect(secondCall[0]).toMatch(/^mermaid-/);
    // The re-render asks the library for the theme actually in force.
    expect(mermaid.initialize).toHaveBeenLastCalledWith(expect.objectContaining({ theme: 'dark' }));
  });

  it('pins securityLevel strict — the only guard on the injected svg', async () => {
    // The component injects the library's SVG via innerHTML, so 'strict' is
    // the whole defense (label escaping + the final DOMPurify pass, ADR-0040
    // and docs/security-notes.md). Same shape as the KaTeX trust:false pin.
    render(<Mermaid source={DIAGRAM} />);

    await waitFor(() => expect(mermaid.initialize).toHaveBeenCalledTimes(1));
    expect(mermaid.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ securityLevel: 'strict' }),
    );
  });
});
