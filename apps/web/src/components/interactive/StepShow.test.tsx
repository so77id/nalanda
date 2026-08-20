import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { Step, StepShow } from './StepShow';

// Same reason CodeEditor / Exercise / PredictOutput mock CodeMirror: the
// editing surface is not the contract under test here, and CodeMirror does
// not render in jsdom. `<CodeStepper>` (which StepShow mounts internally)
// imports it, so the mock lives one level up here. The wrapper still carries
// `data-highlight-lines` as a comma-separated 1-based list — the actual
// per-line paint is confirmed in the browser check (ADR-0043 §Consequences).
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => (
    <textarea readOnly value={value} data-testid="code-listing" />
  ),
}));

const CODE = `class Punto {
    int x, y;
}

public class Demo {
    public static void main(String[] args) {
        Punto a = new Punto();
        Punto b = a;
    }
}`;

function highlightedLines(container: HTMLElement): number[] {
  // `<CodeStepper>` surfaces its highlight as a comma-separated 1-based list
  // on its wrapper element, so tests can read it regardless of whether
  // CodeMirror renders in jsdom. The per-line SVG/CSS paint is checked in
  // a real browser (same shape RecursionTree earned in #78).
  const el = container.querySelector('[data-highlight-lines]');
  const raw = el?.getAttribute('data-highlight-lines') ?? '';
  if (raw === '') return [];
  return raw
    .split(',')
    .map((s) => Number(s))
    .sort((a, b) => a - b);
}

describe('StepShow', () => {
  it('renders the code, the first step, and highlights that step’s lines', () => {
    const { container } = render(
      <StepShow code={CODE} language="java">
        <Step lines={[7]}>
          <p>alfa</p>
        </Step>
        <Step lines={[7, 8]}>
          <p>beta</p>
        </Step>
      </StepShow>,
    );

    expect(screen.getByText('alfa')).toBeTruthy();
    expect(screen.queryByText('beta')).toBeNull();
    expect(highlightedLines(container)).toEqual([7]);
    // The counter is a claim about position — the reader has to know which of N.
    expect(screen.getByText('paso 1 de 2')).toBeTruthy();
  });

  it('advances with Next, retreats with Previous, and jumps back with Reset', () => {
    const { container } = render(
      <StepShow code={CODE} language="java">
        <Step lines={[6]}>
          <span>a</span>
        </Step>
        <Step lines={[7]}>
          <span>b</span>
        </Step>
        <Step lines={[8]}>
          <span>c</span>
        </Step>
      </StepShow>,
    );

    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(screen.getByText('b')).toBeTruthy();
    expect(highlightedLines(container)).toEqual([7]);

    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(screen.getByText('c')).toBeTruthy();
    expect(highlightedLines(container)).toEqual([8]);

    fireEvent.click(screen.getByRole('button', { name: /anterior/i }));
    expect(screen.getByText('b')).toBeTruthy();
    expect(highlightedLines(container)).toEqual([7]);

    fireEvent.click(screen.getByRole('button', { name: /reiniciar/i }));
    expect(screen.getByText('a')).toBeTruthy();
    expect(highlightedLines(container)).toEqual([6]);
  });

  it('marks prev disabled at the start and next disabled at the end, both focusable', () => {
    // `aria-disabled` rather than `disabled`, so the button that stranded the
    // reader stays focusable and can be walked back from. Losing focus at the
    // end and being unable to walk back was the defect earned in #116 by the
    // widget this one supersedes.
    render(
      <StepShow code={CODE} language="java">
        <Step lines={[1]}>
          <span>a</span>
        </Step>
        <Step lines={[2]}>
          <span>b</span>
        </Step>
      </StepShow>,
    );

    const prev = screen.getByRole('button', { name: /anterior/i });
    const next = screen.getByRole('button', { name: /siguiente/i });

    expect(prev.getAttribute('aria-disabled')).toBe('true');
    expect(prev.hasAttribute('disabled')).toBe(false);

    fireEvent.click(next);
    fireEvent.click(next); // clamped

    expect(next.getAttribute('aria-disabled')).toBe('true');
    expect(next.hasAttribute('disabled')).toBe(false);
    expect(screen.getByText('b')).toBeTruthy();
  });

  it('walks with the left/right arrow keys from the focused group', () => {
    const { container } = render(
      <StepShow code={CODE} language="java">
        <Step lines={[1]}>
          <span>a</span>
        </Step>
        <Step lines={[2]}>
          <span>b</span>
        </Step>
      </StepShow>,
    );

    const group = screen.getByRole('group');
    fireEvent.keyDown(group, { key: 'ArrowRight' });
    expect(highlightedLines(container)).toEqual([2]);

    fireEvent.keyDown(group, { key: 'ArrowLeft' });
    expect(highlightedLines(container)).toEqual([1]);
  });

  it('passes the raw source to the listing, blank lines and all', () => {
    // A predecessor widget earned the "blank lines count" lesson (a fence's
    // trailing newline used to produce a phantom numbered line). Here we
    // check the value passed to CodeMirror is untouched — the CodeStepper is
    // not doing any collapse of its own; the reader sees exactly what the
    // author wrote. Line numbers themselves come from CodeMirror's
    // `lineNumbers` basicSetup and are verified in the browser check.
    render(
      <StepShow code={'a\n\nb'} language="java">
        <Step lines={[3]}>
          <span>x</span>
        </Step>
      </StepShow>,
    );

    expect((screen.getByTestId('code-listing') as HTMLTextAreaElement).value).toBe('a\n\nb');
  });

  it('refuses an empty child list with an AuthoringError', () => {
    render(
      <StepShow code={CODE} language="java">
        {null}
      </StepShow>,
    );

    // The banner lives outside the widget in an <AuthoringError data-*> box;
    // this file scopes the query to the app rather than trying to name it.
    const banner = document.querySelector('[data-authoring-error]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/<Step>/i);
  });

  it('refuses missing code with an AuthoringError', () => {
    render(
      // eslint-disable-next-line @typescript-eslint/ban-ts-comment
      // @ts-expect-error — the widget owes the author this error, so drive it.
      <StepShow language="java">
        <Step lines={[1]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    const banner = document.querySelector('[data-authoring-error]');
    expect(banner).not.toBeNull();
    expect(banner!.textContent).toMatch(/code/i);
  });

  it('renders the title in its header when one is given', () => {
    render(
      <StepShow code={CODE} language="java" title="El intercambio">
        <Step lines={[1]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    // The header carries the "código" chip; asserting the title lives near it.
    const header = screen.getByText('El intercambio');
    expect(header.tagName.toLowerCase()).toBe('h4');
  });

  it('honours a step that highlights nothing (empty lines array)', () => {
    // A step whose lesson is "look at what appears" rather than "look at that
    // line" is legal — highlight is off entirely for that step. Otherwise the
    // author has to pick an arbitrary line, which is what the marker used to do
    // in the trace era and was noise.
    const { container } = render(
      <StepShow code={CODE} language="java">
        <Step lines={[]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    expect(highlightedLines(container)).toEqual([]);
  });

  it('has a live region that names the step count and current lines', () => {
    render(
      <StepShow code={CODE} language="java">
        <Step lines={[6]}>
          <span>a</span>
        </Step>
        <Step lines={[7, 8]}>
          <span>b</span>
        </Step>
      </StepShow>,
    );

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/Paso 1 de 2/);
    expect(live?.textContent).toMatch(/línea 6/);

    fireEvent.click(screen.getByRole('button', { name: /siguiente/i }));
    expect(live?.textContent).toMatch(/Paso 2 de 2/);
    expect(live?.textContent).toMatch(/líneas 7 y 8/);
  });

  it('ignores non-Step children so an author cannot accidentally count prose', () => {
    // A stray paragraph between <Step>s does not become "paso 2 of 3"; the
    // pattern is Steps only, and the widget says so by refusing to treat prose
    // as a step. This is what makes the counter honest.
    render(
      <StepShow code={CODE} language="java">
        <Step lines={[1]}>
          <span>alpha</span>
        </Step>
        <p>this is prose the author dropped in by accident</p>
        <Step lines={[2]}>
          <span>beta</span>
        </Step>
      </StepShow>,
    );
    expect(screen.getByText('paso 1 de 2')).toBeTruthy();
  });

  it('scopes prev/next to this widget so two StepShows on one page do not fight', () => {
    // Two on a page is the shape the swap / aliasing pair produces in doc 2.
    // Owning state at the StepShow level, not in module scope, is what makes
    // each move independently.
    const { container } = render(
      <div>
        <StepShow code={CODE} language="java">
          <Step lines={[1]}>
            <span>A1</span>
          </Step>
          <Step lines={[2]}>
            <span>A2</span>
          </Step>
        </StepShow>
        <StepShow code={CODE} language="java">
          <Step lines={[3]}>
            <span>B1</span>
          </Step>
          <Step lines={[4]}>
            <span>B2</span>
          </Step>
        </StepShow>
      </div>,
    );

    const nexts = screen.getAllByRole('button', { name: /siguiente/i });
    fireEvent.click(nexts[0]!);

    // A moved, B did not.
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.getByText('B1')).toBeTruthy();
    const groups = container.querySelectorAll('[role="group"]');
    expect(within(groups[0] as HTMLElement).getByText('paso 2 de 2')).toBeTruthy();
    expect(within(groups[1] as HTMLElement).getByText('paso 1 de 2')).toBeTruthy();
  });
});
