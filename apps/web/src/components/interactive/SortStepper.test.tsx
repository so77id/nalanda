import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { SortStepper } from './SortStepper';

// Bar geometry, focus rings and playback timing are the S5 browser check's
// job (per apps/web/CLAUDE.md §the suite cannot lay out a page). The suite
// pins the widget's CONTRACT here: which frames it emits (via data-*), how
// controls advance the frame, and how the merge/quick recipes wire into
// <DivideCombineTree> via the ADR-0064 hooks.

describe('SortStepper', () => {
  describe('authoring errors', () => {
    it('tells the author when algorithm is missing', () => {
      render(<SortStepper values={[3, 1, 2]} />);
      expect(screen.getByText(/algorithm/i)).toBeInTheDocument();
    });

    it('tells the author when algorithm is unknown', () => {
      render(<SortStepper algorithm="radix" values={[3, 1, 2]} />);
      expect(screen.getByText(/no es un algoritmo conocido/i)).toBeInTheDocument();
    });

    it('tells the author when values is missing or empty', () => {
      render(<SortStepper algorithm="bubble" values={[]} />);
      expect(screen.getByText(/values/i)).toBeInTheDocument();
    });

    it('refuses arrays larger than 12 elements', () => {
      render(<SortStepper algorithm="bubble" values={Array.from({ length: 13 }, (_, i) => i)} />);
      expect(screen.getByText(/6-10/i)).toBeInTheDocument();
    });
  });

  describe('rendering', () => {
    it('sets data-algorithm on the widget wrapper', () => {
      const { container } = render(<SortStepper algorithm="insertion" values={[3, 1, 2]} />);
      expect(container.querySelector('[data-widget="sort-stepper"]')).not.toBeNull();
      expect(container.querySelector('[data-algorithm="insertion"]')).not.toBeNull();
    });

    it('renders one bar per input element with data-index and data-value', () => {
      const { container } = render(<SortStepper algorithm="bubble" values={[3, 1, 2]} />);
      const bars = container.querySelectorAll('[data-index][data-value]');
      expect(bars.length).toBe(3);
      expect(bars[0]?.getAttribute('data-value')).toBe('3');
      expect(bars[2]?.getAttribute('data-value')).toBe('2');
    });

    it('exposes data-status on bars so a browser check can pin per-frame state', () => {
      const { container } = render(<SortStepper algorithm="insertion" values={[3, 1, 2]} />);
      const bars = container.querySelectorAll('[data-status]');
      expect(bars.length).toBeGreaterThan(0);
      // First frame of insertion: `active=[1]`, sortedPrefix=1 (the initial i=1 select).
      // So at least one bar is 'active' and one is 'sorted'.
      const statuses = Array.from(bars).map((b) => b.getAttribute('data-status'));
      expect(statuses).toContain('sorted');
    });

    it('shows the paso counter and description', () => {
      const { container } = render(<SortStepper algorithm="bubble" values={[3, 1, 2]} />);
      // The counter is split across nested spans ("paso", "1", " / 3"); check
      // the concatenated text.
      expect(container.textContent).toMatch(/paso\s*1\s*\/ /);
      // Progress bar is exposed via aria for browser checks.
      expect(container.querySelector('[role="progressbar"]')).not.toBeNull();
    });
  });

  describe('controls', () => {
    it('advances one frame on Paso and rewinds on Atrás', () => {
      const { container } = render(<SortStepper algorithm="bubble" values={[3, 1, 2]} />);
      const paso = screen.getByRole('button', { name: /Paso/ });
      const atras = screen.getByRole('button', { name: /Atrás/ });
      expect(container.textContent).toMatch(/paso\s*1\s*\/ /);
      fireEvent.click(paso);
      expect(container.textContent).toMatch(/paso\s*2\s*\/ /);
      fireEvent.click(paso);
      expect(container.textContent).toMatch(/paso\s*3\s*\/ /);
      fireEvent.click(atras);
      expect(container.textContent).toMatch(/paso\s*2\s*\/ /);
    });

    it('Reset returns to frame 1', () => {
      const { container } = render(<SortStepper algorithm="bubble" values={[3, 1, 2]} />);
      const paso = screen.getByRole('button', { name: /Paso/ });
      fireEvent.click(paso);
      fireEvent.click(paso);
      fireEvent.click(paso);
      const reset = screen.getByRole('button', { name: /Reset/ });
      fireEvent.click(reset);
      expect(container.textContent).toMatch(/paso\s*1\s*\/ /);
    });

    it('Atrás is disabled at the first frame', () => {
      render(<SortStepper algorithm="bubble" values={[3, 1, 2]} />);
      const atras = screen.getByRole('button', { name: /Atrás/ });
      expect(atras).toBeDisabled();
    });
  });

  describe('divide/combine tree integration (merge, quick)', () => {
    it('renders <DivideCombineTree> with recipe=mergesort when algorithm=merge', () => {
      const { container } = render(<SortStepper algorithm="merge" values={[3, 7, 1, 5]} />);
      expect(container.querySelector('[data-recipe="mergesort"]')).not.toBeNull();
    });

    it('renders <DivideCombineTree> with recipe=quicksort when algorithm=quick', () => {
      const { container } = render(<SortStepper algorithm="quick" values={[3, 7, 1, 5]} />);
      expect(container.querySelector('[data-recipe="quicksort"]')).not.toBeNull();
    });

    it('passes highlightNode to the tree as frames advance', () => {
      // First frame of merge is `enter` on the root call — the root chip
      // is highlighted.
      const { container } = render(<SortStepper algorithm="merge" values={[3, 7, 1, 5]} />);
      const highlighted = container.querySelector('[data-highlighted="true"]');
      expect(highlighted?.getAttribute('data-call')).toBe('mergesort([3,7,1,5])');
    });

    it('omits the tree for n² algorithms', () => {
      const { container } = render(<SortStepper algorithm="bubble" values={[3, 1, 2]} />);
      expect(container.querySelector('[data-recipe="mergesort"]')).toBeNull();
      expect(container.querySelector('[data-recipe="quicksort"]')).toBeNull();
    });

    it('respects showTree={false}', () => {
      const { container } = render(
        <SortStepper algorithm="merge" values={[3, 7, 1, 5]} showTree={false} />,
      );
      expect(container.querySelector('[data-recipe="mergesort"]')).toBeNull();
    });
  });

  describe('aux rail (merge)', () => {
    it('renders no aux rail on the initial frame (nothing merged yet)', () => {
      const { container } = render(<SortStepper algorithm="merge" values={[3, 7, 1, 5]} />);
      expect(container.querySelector('[data-aux-index]')).toBeNull();
    });

    it('renders the aux rail once the first merge-take frame arrives', () => {
      const { container } = render(<SortStepper algorithm="merge" values={[3, 7]} />);
      // Merge on [3,7]: enter, return-base-left, enter-right, return-base-right,
      // then the first merge-take on the parent. Advance until it appears.
      const paso = screen.getByRole('button', { name: /Paso/ });
      for (let i = 0; i < 20; i += 1) {
        if (container.querySelector('[data-aux-index]')) break;
        fireEvent.click(paso);
      }
      expect(container.querySelector('[data-aux-index]')).not.toBeNull();
    });
  });
});
