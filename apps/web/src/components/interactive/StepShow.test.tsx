import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { ModeProvider } from '../../presentation';
import { useViewportBreakout } from '../useViewportBreakout';
import { Step, StepShow } from './StepShow';
import { besideColumns } from './stepShowLayout';

// The breakout writes width/marginLeft after MEASURING an ancestor transform,
// which jsdom cannot produce — so the hook is stubbed and what the test pins
// is the number handed to it. Reviewed in #277: the fraction went 0.75 -> 0.5
// and nothing in the suite could see it, in a component three published
// documents mount (chapters 08, 14 and 17). The paint itself stays a browser
// check; this is the gate the next tweak of the number has to pass. It pins
// the NUMBER, not the wiring: the case renders in book mode, so the recorded
// call is `{ enabled: false, fraction: 0.5 }` and unwiring the breakout from
// presentation would still pass here.
vi.mock('../useViewportBreakout', () => ({ useViewportBreakout: vi.fn() }));

// Same reason CodeEditor / Exercise / PredictOutput mock CodeMirror: the
// editing surface is not the contract under test here, and CodeMirror does
// not render in jsdom. `<CodeStepper>` (which StepShow mounts internally)
// imports it, so the mock lives one level up here. The wrapper still carries
// `data-highlight-lines` as a comma-separated 1-based list — the actual
// per-line paint is confirmed in the browser check (ADR-0049 §Consequences).
// The files a document keeps beside it (ADR-0091) arrive through a Vite glob
// the suite does not need to exercise: two made-up files stand in for them.
vi.mock('../../lib/contentCode', () => ({
  resolveCode: (src: string) =>
    ({
      'asset:x.code/Graph.java': 'a\nb\nc\nd\ne\nf\n',
      'asset:x.code/Main.java': 'm1\nm2\n',
    })[src] ?? null,
}));

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
  it('asks for half the viewport in presentation, not three quarters', () => {
    render(
      <StepShow code={CODE}>
        <Step lines={[1]}>uno</Step>
      </StepShow>,
    );

    expect(vi.mocked(useViewportBreakout)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ fraction: 0.5 }),
    );
  });

  it('sets the drawing beside the listing on a slide when asked, three quarters wide', () => {
    vi.mocked(useViewportBreakout).mockClear();
    const { container } = render(
      <ModeProvider mode="presentation">
        <StepShow code={CODE} beside>
          <Step lines={[1]}>uno</Step>
        </StepShow>
      </ModeProvider>,
    );

    expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('beside');
    expect(vi.mocked(useViewportBreakout)).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ enabled: true, fraction: 0.75 }),
    );
  });

  it('keeps the drawing under the listing in the book, beside or not', () => {
    const { container } = render(
      <StepShow code={CODE} beside>
        <Step lines={[1]}>uno</Step>
      </StepShow>,
    );

    expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('stacked');
  });

  it('keeps the drawing under the listing on a slide unless asked', () => {
    const { container } = render(
      <ModeProvider mode="presentation">
        <StepShow code={CODE}>
          <Step lines={[1]}>uno</Step>
        </StepShow>
      </ModeProvider>,
    );

    expect(container.querySelector('[data-layout]')?.getAttribute('data-layout')).toBe('stacked');
  });

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

    fireEvent.click(screen.getByRole('button', { name: /adelante/i }));
    expect(screen.getByText('b')).toBeTruthy();
    expect(highlightedLines(container)).toEqual([7]);

    fireEvent.click(screen.getByRole('button', { name: /adelante/i }));
    expect(screen.getByText('c')).toBeTruthy();
    expect(highlightedLines(container)).toEqual([8]);

    fireEvent.click(screen.getByRole('button', { name: /atrás/i }));
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

    const prev = screen.getByRole('button', { name: /atrás/i });
    const next = screen.getByRole('button', { name: /adelante/i });

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

    fireEvent.click(screen.getByRole('button', { name: /adelante/i }));
    expect(live?.textContent).toMatch(/Paso 2 de 2/);
    expect(live?.textContent).toMatch(/líneas 7 y 8/);
  });

  it('sets a named program over the named listing, each lit with its own lines', () => {
    render(
      <StepShow code={CODE} program={'f(1);\nf(2);'} codeName="f" language="java">
        <Step lines={[7]} programLines={[1]}>
          <span>a</span>
        </Step>
        <Step lines={[8]} programLines={[2]}>
          <span>b</span>
        </Step>
      </StepShow>,
    );

    const listings = screen.getAllByTestId('stepshow-listing');
    expect(listings.map((l) => l.getAttribute('data-listing'))).toEqual(['programa', 'f']);
    const lit = (i: number) => highlightedLines(listings[i]!);
    expect([lit(0), lit(1)]).toEqual([[1], [7]]);

    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/programa: línea 1; f: línea 7/);

    fireEvent.click(screen.getByRole('button', { name: /adelante/i }));
    expect([lit(0), lit(1)]).toEqual([[2], [8]]);
  });

  it('reads a beside ratio as the two columns, and falls back on a malformed one', () => {
    expect(besideColumns('40/60')).toBe('minmax(0,40fr) minmax(0,60fr)');
    expect(besideColumns(undefined)).toBeUndefined();
    expect(besideColumns('40')).toBeUndefined();
    expect(besideColumns('0/100')).toBeUndefined();
  });

  it('sets a helper between the program and the listing, lit on its own', () => {
    render(
      <StepShow
        code={CODE}
        program={'run();'}
        helper={'void run() {\n    f();\n}'}
        helperName="run"
        codeName="f"
        language="java"
      >
        <Step lines={[7]} programLines={[1]} helperLines={[2]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    const listings = screen.getAllByTestId('stepshow-listing');
    expect(listings.map((l) => l.getAttribute('data-listing'))).toEqual(['programa', 'run', 'f']);
    expect(listings.map((l) => highlightedLines(l))).toEqual([[1], [2], [7]]);
    const live = document.querySelector('[aria-live="polite"]');
    expect(live?.textContent).toMatch(/programa: línea 1; run: línea 2; f: línea 7/);
  });

  it('heads a lone listing with its file when codeName is given', () => {
    render(
      <StepShow code={CODE} codeName="Demo.java" language="java">
        <Step lines={[7]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    const listings = screen.getAllByTestId('stepshow-listing');
    expect(listings.map((l) => l.getAttribute('data-listing'))).toEqual(['Demo.java']);
    expect(highlightedLines(listings[0]!)).toEqual([7]);
  });

  it('heads the program with its file when programName is given', () => {
    render(
      <StepShow
        code={CODE}
        program={'f();'}
        programName="Main.java"
        codeName="F.java"
        language="java"
      >
        <Step lines={[7]} programLines={[1]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    expect(
      screen.getAllByTestId('stepshow-listing').map((l) => l.getAttribute('data-listing')),
    ).toEqual(['Main.java', 'F.java']);
    expect(document.querySelector('[aria-live="polite"]')?.textContent).toMatch(
      /Main\.java: línea 1; F\.java: línea 7/,
    );
  });

  it('quotes a range of a file: real numbers, the range, and folds for what it leaves out', () => {
    const { container } = render(
      <StepShow codeSrc="asset:x.code/Graph.java" codeRange="3-4" language="java">
        <Step lines={[4]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    const listing = screen.getByTestId('stepshow-listing');
    expect(listing.dataset['listing']).toBe('Graph.java');
    expect(screen.getByTestId('listing-range').textContent).toBe('líneas 3–4 de 6');
    expect(screen.getAllByTestId('listing-fold').map((f) => f.textContent)).toEqual([
      '⋯ 2 líneas arriba',
      '⋯ 2 líneas abajo',
    ]);
    // The step names file line 4; the editor lights its own second line, and
    // its gutter counts from 3.
    expect(highlightedLines(container)).toEqual([2]);
    expect(container.querySelector('[data-first-line]')?.getAttribute('data-first-line')).toBe('3');
    expect((screen.getByTestId('code-listing') as HTMLTextAreaElement).value).toBe('c\nd');
  });

  it('opens the whole files of the walk, one tab each, and closes on Escape', () => {
    render(
      <StepShow
        programSrc="asset:x.code/Main.java"
        codeSrc="asset:x.code/Graph.java"
        codeRange="3-4"
        language="java"
      >
        <Step lines={[4]} programLines={[2]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    fireEvent.click(screen.getAllByRole('button', { name: /ver archivo/i })[1]!);
    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog)
        .getAllByRole('tab')
        .map((t) => t.textContent),
    ).toEqual(['Main.java', 'Graph.java']);
    const file = within(dialog).getByTestId('viewer-file');
    expect(file.dataset['file']).toBe('Graph.java');
    // The whole file, the quoted range banded, the step's file line lit.
    expect(file.querySelector('[data-band-lines]')?.getAttribute('data-band-lines')).toBe('3,4');
    expect(highlightedLines(file)).toEqual([4]);

    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('refuses a file that is not under content/ with an AuthoringError', () => {
    render(
      <StepShow codeSrc="asset:x.code/Nope.java" language="java">
        <Step lines={[1]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    expect(document.querySelector('[data-authoring-error]')?.textContent).toMatch(/Nope\.java/);
  });

  it('puts a step’s `under` in the code column, under the listings', () => {
    render(
      <StepShow code={CODE} program={'f();'} language="java">
        <Step lines={[7]} programLines={[1]} under={<span>a = true</span>}>
          <span>dibujo</span>
        </Step>
      </StepShow>,
    );

    expect(screen.getByTestId('stepshow-under').textContent).toBe('a = true');
  });

  it('shows one unnamed listing when no program is given', () => {
    render(
      <StepShow code={CODE} language="java">
        <Step lines={[7]}>
          <span>a</span>
        </Step>
      </StepShow>,
    );

    expect(screen.queryAllByTestId('stepshow-listing')).toHaveLength(0);
    expect(screen.getAllByTestId('code-listing')).toHaveLength(1);
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

    const nexts = screen.getAllByRole('button', { name: /adelante/i });
    fireEvent.click(nexts[0]!);

    // A moved, B did not.
    expect(screen.getByText('A2')).toBeTruthy();
    expect(screen.getByText('B1')).toBeTruthy();
    const groups = container.querySelectorAll('[role="group"]');
    expect(within(groups[0] as HTMLElement).getByText('paso 2 de 2')).toBeTruthy();
    expect(within(groups[1] as HTMLElement).getByText('paso 1 de 2')).toBeTruthy();
  });
});
