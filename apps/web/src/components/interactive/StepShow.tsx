import { Pause, Play, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { Children, isValidElement, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { useMode } from '../../presentation';
import { AuthoringError } from '../AuthoringError';
import { resolveCode } from '../../lib/contentCode';
import { CodeFileViewer } from './CodeFileViewer';
import type { ViewerFile } from './CodeFileViewer';
import { CodeListing } from './CodeListing';
import { CodeStepper } from './CodeStepper';
import { excerptOf, fileNameOf, toExcerptLines } from './codeExcerpt';
import type { Excerpt } from './codeExcerpt';
import { Step } from './Step';
import { ControlButton } from './stepperShell';
import type { StepProps } from './Step';
import { useViewportBreakout } from '../useViewportBreakout';

export interface StepShowProps {
  /**
   * The listing shown on the code side, constant across steps, written in the
   * document. Or, instead, `codeSrc`: a file kept beside the document.
   */
  code?: string;
  /**
   * The file the listing quotes, a path relative to the document
   * (`./26-grafos-tda-modelado.code/AdjMatrixGraph.java`, ADR-0091), cut to
   * `codeRange` ("12-16"; the whole file without it). The listing then
   * numbers its lines as the file does, its header names the range and opens
   * the whole file, and every `<Step>` names its `lines` in the FILE's
   * numbering. `programSrc`/`programRange` and `helperSrc`/`helperRange` do
   * the same for the other two listings.
   */
  codeSrc?: string;
  codeRange?: string;
  programSrc?: string;
  programRange?: string;
  helperSrc?: string;
  helperRange?: string;
  /**
   * The language the listing is coloured as: a runtime id loads that grammar
   * (`loadGrammar`), anything else falls back to Java (`CodeStepper.tsx`).
   */
  language?: string;
  /** Optional heading, rendered above the panels. */
  title?: string;
  /**
   * Start playing on mount. Default `false` — pedagogical widgets should not
   * autoplay unless the author explicitly asks. Matches `<SortStepper>`
   * behaviour (rule Peli 1/2). When true, playback still pauses when the
   * widget scrolls out of view.
   */
  autoplay?: boolean;
  /**
   * Playback speed. `slow` ≈ 1200ms/step, `normal` ≈ 700ms, `fast` ≈ 300ms.
   * Default `normal`. The reader can override in the UI.
   */
  speed?: 'slow' | 'normal' | 'fast';
  /**
   * On a slide, the drawing sits beside the listing instead of under it, and
   * the widget takes three quarters of the viewport. For a listing too long
   * to stack over its drawing — a whole class walked in one widget (#322) —
   * whose drawing is small. The book keeps the stack: there the widget gets
   * ~700px, and two columns shrink the drawing to unreadable (#116).
   */
  beside?: boolean;
  /**
   * The program that calls the listing, shown over it as a listing of its
   * own, headed «programa», with `code` under it headed `codeName`. Each
   * `<Step>` lights its own lines in both: `programLines` here, `lines` in
   * `code`. For a walk whose lesson is a call and what it does inside — the
   * calls `addEdge(0, 1)`, `addEdge(0, 2)`… over `addEdge` itself (#363) —
   * the way `<SequenceStepper program>` sets a program beside its method
   * (#322). Without it the widget shows `code` alone — unheaded unless it
   * has a name (`codeName`, or the file `codeSrc` quotes) or a step has
   * `under`.
   */
  program?: string;
  /**
   * With `program`, a method between the program and `code`: the one the
   * program calls and that calls `code` in turn — `readEdges` between the
   * program that reads a graph and `addEdge` (#363). Shown under the program,
   * headed `helperName`; each `<Step>` lights `helperLines` in it.
   */
  helper?: string;
  /** The heading of `helper`. */
  helperName?: string;
  /**
   * With `beside`, how the slide's width splits between the code and the
   * drawing, as "code/drawing" percentages: one of `BESIDE_COLUMNS`' keys,
   * default "55/45". A walk whose listings are short beside a drawing of two
   * pictures — a graph over its matrix — asks for "50/50" or "40/60"; one
   * whose program is wide asks for "60/40" (#363). Anything else is refused.
   */
  ratio?: BesideRatio;
  /**
   * The file `code` stands for — `AdjMatrixGraph.java` — shown as a badge over
   * it (#363). With `program`, it heads the method's listing (default
   * «método»); alone, it heads the one listing, which otherwise has none.
   */
  codeName?: string;
  /** The file the `program` listing stands for, as its badge. Default «programa». */
  programName?: string;
  /** `<Step>` elements. Order is step order; anything else is ignored. */
  children?: ReactNode;
}

/**
 * The beside grid's columns for each ratio an author may ask for — a closed
 * set, so every class is static and the build sees it (frontend-code-style.md
 * §Styling); MDX props are not type-checked, so an unknown one is refused at
 * render rather than falling back in silence.
 */
const BESIDE_COLUMNS = {
  '55/45': 'grid-cols-[minmax(0,1fr)_minmax(0,0.8fr)]',
  '50/50': 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)]',
  '60/40': 'grid-cols-[minmax(0,3fr)_minmax(0,2fr)]',
  '40/60': 'grid-cols-[minmax(0,2fr)_minmax(0,3fr)]',
} as const;

export type BesideRatio = keyof typeof BESIDE_COLUMNS;

const SPEED_MS: Record<'slow' | 'normal' | 'fast', number> = {
  slow: 1200,
  normal: 700,
  fast: 300,
};

/**
 * Code on one side, arbitrary JSX on the other, both synced to a single step
 * index — the primitive `<MemoryVisual>` sits inside, and every other
 * step-based widget (the Fibonacci trio, `<MergeStepper>`, `<PartitionStepper>`)
 * builds on top.
 *
 * State is scoped to this instance: two `<StepShow>`s on one page step
 * independently. Controls: skip-back / skip-forward / play-pause / reset,
 * plus a speed selector — same shape as `<SortStepper>` so the reader learns
 * one control layout that works across the site. ArrowLeft / ArrowRight also
 * walk the index from the focused group.
 *
 * Two accessibility invariants are load-bearing and were paid for once
 * (in #116, on the widget this one supersedes): the group is focusable, and
 * skip / play controls expose `aria-disabled` rather than `disabled`, so the
 * keyboard reader is not stranded when the button that stranded them is the
 * one that just disabled itself.
 *
 * Playback pauses when the widget scrolls out of view — a book-mode reader
 * often has many step widgets on one page, and every one that keeps firing
 * setTimeouts contributes to freezing the tab.
 *
 * Introduced in #209 as the reversal of ADR-0028: a memory picture used to be
 * drawn from an execution trace (a Java compile + JVM per diagram); it now
 * consumes author-written state through `<MemoryVisual>`, at a fraction of the
 * bundle. Play controls added in #268 so `<MergeStepper>` and
 * `<PartitionStepper>` — and the Fibonacci trio — get the same playback UX
 * as `<SortStepper>` without duplicating the machinery.
 */
export function StepShow({
  code,
  language,
  title,
  autoplay = false,
  speed = 'normal',
  beside = false,
  program,
  helper,
  helperName,
  ratio = '55/45',
  codeName,
  programName,
  codeSrc,
  codeRange,
  programSrc,
  programRange,
  helperSrc,
  helperRange,
  children,
}: StepShowProps) {
  const [viewerAt, setViewerAt] = useState<number | null>(null);
  const steps = Children.toArray(children).filter(
    (child): child is ReactElement<StepProps> => isValidElement(child) && child.type === Step,
  );

  const [index, setIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(autoplay);
  const [liveSpeed, setLiveSpeed] = useState<'slow' | 'normal' | 'fast'>(speed);
  useEffect(() => setLiveSpeed(speed), [speed]);

  // In presentation the widget breaks out of the Slide's prose max-width
  // and takes 50 % of the viewport. It stacks code over panel rather than
  // sitting them side-by-side (unlike `<SortStepper>`, which needs the extra
  // width for its tree), so the width only has to hold the code.
  //
  // Measured (#277, 2026-09-08, re-measured #294): 0.5 x 1440 gives the
  // panel 718 px of clientWidth, of which a 33 px line-number gutter leaves
  // 685 for text at 12.0 px per character — 57 rendered columns, not the
  // ~60 this comment used to claim. The longest fence chapter 17 ships is 58
  // and #294 ships one at 58 that clips by 19 px. That is the case
  // that breaks if the fraction drops further — a longer line clips at the
  // right edge and nothing in the build or the suite sees it. Chapters 08 and
  // 14, which also mount this widget, were measured at both values: widget
  // 1080 -> 720 px, everything else byte-identical (heights, code font-size,
  // zero wrapped lines, no scroll), and at 0.5 the widget aligns with the
  // prose column instead of jutting 140 px left of it.
  //
  // Rejected: leaving 0.75 and letting the stacked layout keep an empty band,
  // and making `fraction` a prop set per call site — three documents want the
  // same answer, so a prop would be three copies of one decision.
  //
  // Book mode leaves it alone. The measurement dance is shared with
  // `<SortStepper>` (`useViewportBreakout`).
  const mode = useMode();
  const isPresentation = mode === 'presentation';
  // Beside only on a slide, where the breakout gives both columns room; the
  // two columns need half again the stacked width (a 57-column listing and a
  // drawing beside it), so the widget asks for three quarters.
  const isBeside = beside && isPresentation;

  // Pause playback when the widget is not intersecting the viewport. Book
  // mode may host many step widgets on one page; without this, every one
  // that has been played and left mid-run keeps firing setTimeouts and their
  // combined tick rate can lock the tab.
  const outerRef = useRef<HTMLDivElement | null>(null);
  useViewportBreakout(outerRef, {
    enabled: isPresentation,
    fraction: isBeside ? 0.75 : 0.5,
  });
  const [isVisible, setIsVisible] = useState(true);
  useEffect(() => {
    const el = outerRef.current;
    if (!el || typeof IntersectionObserver !== 'function') return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) setIsVisible(entry.isIntersecting);
      },
      { threshold: 0.2 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Every step's frame is laid in one cell so the widget keeps its final size
  // from the first step (#363) — but a book page mounts every walk at once,
  // and all frames of all walks doubled the page's DOM and its first-load
  // freeze. So a walk far from the viewport keeps only the current frame and
  // the last one, which is the biggest in 31 of the 33 frame stacks #363
  // ships (23 walks, 10 of them with an `under` column); once it comes within
  // a screen of the viewport it lays every frame, and any growth that brings
  // happens off-screen. Measured in #363's review (2026-11-12), production
  // build, /d/grafos-tda-modelado in the book at 1440x900: every frame laid,
  // 57k elements and a 1.7 s longest task (7.5 s at 4x CPU); only the current
  // frame, 28k and 0.9 s; this, 32k and 0.95 s (4.0 s at 4x). Across the 66
  // walks of the site, three grow when they lay every frame — two older ones
  // by 98 and 28 px, which a jump straight onto them shows for one frame. On a slide
  // the walk is on screen from the start, and only that slide is mounted.
  const [nearView, setNearView] = useState(() => typeof IntersectionObserver !== 'function');
  useEffect(() => {
    if (nearView) return undefined;
    const el = outerRef.current;
    if (!el) return undefined;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setNearView(true);
      },
      { rootMargin: '100% 0px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nearView]);
  const reserveAll = isPresentation || nearView;

  const count = steps.length;
  const clamped = Math.min(index, Math.max(count - 1, 0));

  useEffect(() => {
    if (!isPlaying) return;
    if (!isVisible) return;
    if (count === 0) return;
    if (clamped >= count - 1) {
      setIsPlaying(false);
      return;
    }
    const delay = SPEED_MS[liveSpeed];
    const timeout = window.setTimeout(() => setIndex((s) => s + 1), delay);
    return () => window.clearTimeout(timeout);
  }, [isPlaying, isVisible, clamped, liveSpeed, count]);

  const advance = useCallback(() => {
    setIndex((s) => Math.min(s + 1, count - 1));
  }, [count]);
  const retreat = useCallback(() => {
    setIndex((s) => Math.max(s - 1, 0));
  }, []);
  const reset = useCallback(() => {
    setIndex(0);
    setIsPlaying(false);
  }, []);
  const closeViewer = useCallback(() => setViewerAt(null), []);
  const togglePlay = useCallback(() => {
    if (clamped >= count - 1) {
      setIndex(0);
      setIsPlaying(true);
    } else {
      setIsPlaying((p) => !p);
    }
  }, [clamped, count]);

  const both = (
    [
      ['code', code, codeSrc],
      ['program', program, programSrc],
      ['helper', helper, helperSrc],
    ] as const
  ).find(([, inline, src]) => inline !== undefined && src !== undefined);
  if (both !== undefined) {
    return (
      <AuthoringError component="StepShow">
        recibió <code>{both[0]}</code> y <code>{both[0]}Src</code> a la vez: el listado va escrito
        en el documento o citado de un archivo, no las dos cosas.
      </AuthoringError>
    );
  }
  if (!Object.hasOwn(BESIDE_COLUMNS, ratio)) {
    return (
      <AuthoringError component="StepShow">
        no conoce la proporción <code>ratio=&quot;{ratio}&quot;</code>: usa una de{' '}
        {Object.keys(BESIDE_COLUMNS).join(', ')}.
      </AuthoringError>
    );
  }

  const codeSpec = specOf(code, codeSrc, codeRange, codeName);
  const programSpec = specOf(program, programSrc, programRange, programName);
  const helperSpec = specOf(helper, helperSrc, helperRange, helperName);

  if (codeSpec === undefined) {
    return (
      <AuthoringError component="StepShow">
        falta la prop <code>code</code>: pásale el listado como una cadena, o el archivo que cita
        con <code>codeSrc</code>.
      </AuthoringError>
    );
  }
  const missing = [codeSpec, programSpec, helperSpec].find(
    (spec) => spec !== undefined && 'missing' in spec,
  );
  if (missing !== undefined && 'missing' in missing) {
    return (
      <AuthoringError component="StepShow">
        no encontró el archivo <code>{missing.missing}</code>: la ruta va relativa al documento, y
        el archivo tiene que estar bajo <code>content/</code>.
      </AuthoringError>
    );
  }

  if (steps.length === 0) {
    return (
      <AuthoringError component="StepShow">
        no encontró ningún <code>&lt;Step&gt;</code> hijo directo: escribe uno o más{' '}
        <code>&lt;Step lines={'{[1, 2]}'}&gt;…&lt;/Step&gt;</code> dentro para declarar los pasos.
        Si los envolviste en un fragmento <code>&lt;&gt;…&lt;/&gt;</code>, sácalos: los{' '}
        <code>&lt;Step&gt;</code> tienen que ser hijos directos.
      </AuthoringError>
    );
  }

  // Past the guards: every spec that exists resolved.
  const codeL = codeSpec as Spec;
  const programL = programSpec as Spec | undefined;
  const helperL = helperSpec as Spec | undefined;

  // The walk's listings, top to bottom, each with what lights it in a step.
  const listings: Listing[] = [
    programL && { role: 'program', spec: programL, fallback: 'programa', linesOf: programLinesOf },
    helperL && { role: 'helper', spec: helperL, fallback: 'auxiliar', linesOf: helperLinesOf },
    { role: 'code', spec: codeL, fallback: 'método', linesOf: codeLinesOf },
  ].filter((l): l is Listing => l !== undefined);

  // A step lights lines in its FILE's numbering; one outside the quoted range
  // would light nothing, or a neighbour after a range moves (ADR-0091's one
  // maintenance job). Refused, naming the step.
  for (const { spec, linesOf } of listings) {
    const excerpt = spec.excerpt;
    if (excerpt === undefined) continue;
    for (const [i, step] of steps.entries()) {
      const stray = linesOf(step).find((n) => n < excerpt.first || n > excerpt.last);
      if (stray !== undefined) {
        return (
          <AuthoringError component="StepShow">
            el paso {i + 1} enciende la línea {stray} de <code>{spec.name}</code>, que queda fuera
            de las líneas citadas ({excerpt.first}–{excerpt.last}): los pasos nombran las líneas del
            archivo.
          </AuthoringError>
        );
      }
    }
  }

  const current = steps[clamped]!;
  const currentLines = codeLinesOf(current);
  const currentProgramLines = programLinesOf(current);
  const currentHelperLines = helperLinesOf(current);
  const hasUnder = steps.some((step) => step.props.under !== undefined);
  // The files behind the listings, whole, for the viewer: each with the lines
  // its listing quotes and the lines this step lights, in the file's numbering.
  // A listing opens its tab by position, so one file quoted twice gets two.
  const fileBacked = listings.flatMap((listing) => {
    const { source, excerpt } = listing.spec;
    return source === undefined || excerpt === undefined ? [] : [{ listing, source, excerpt }];
  });
  const files: ViewerFile[] = fileBacked.map(({ listing, source, excerpt }) => ({
    name: listing.spec.name ?? '',
    source,
    first: excerpt.first,
    last: excerpt.last,
    lines: [...listing.linesOf(current)],
  }));
  const first = clamped === 0;
  const last = clamped === count - 1;

  return (
    <div
      ref={outerRef}
      // `role="group"` + focusable, so the arrows work from anywhere inside —
      // and keep working at both ends, where the button that had focus is the
      // one that just became unavailable. Earned in #116 by the widget this
      // one supersedes.
      tabIndex={0}
      role="group"
      aria-label="Ejecución paso a paso: usa las flechas izquierda y derecha para recorrer los pasos"
      className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-focus"
      onKeyDown={(event) => {
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          advance();
        } else if (event.key === 'ArrowLeft') {
          event.preventDefault();
          retreat();
        }
      }}
    >
      <header className="flex items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs tracking-wide text-accent uppercase">
          código
        </span>
        {title === undefined ? null : <h4 className="m-0 text-sm font-medium text-ink">{title}</h4>}
      </header>

      {/*
        Stacked, not side by side. Two columns measured wrong inside a document:
        the widget gets ~700px, so each column got ~350 and the drawing scaled
        to ~two-thirds — 11px labels landed near 7px, unreadable on a projector.
        A media query cannot fix it; what is narrow is the container, not the
        viewport. Full width each, both legible. Earned in the widget this
        one supersedes (#116).

        `beside` is the one exception, and only on a slide: there the widget
        breaks out to three quarters of the viewport, which leaves the code
        column a little narrower than the stacked widget and the drawing as
        wide as most need (measured in teach-a-data-structure.md §6bis). #322
        asked for it when a whole class — twenty-eight lines — stacked over its
        drawing put the slide at 0.577.
      */}
      <div
        data-layout={isBeside ? 'beside' : 'stacked'}
        className={
          isBeside ? `grid ${BESIDE_COLUMNS[ratio]} gap-px bg-rule` : 'flex flex-col gap-px bg-rule'
        }
      >
        {listings.length === 1 && codeL.name === undefined && !hasUnder ? (
          <CodeStepper code={codeL.text} highlightLines={currentLines} language={language} />
        ) : (
          <div className="flex flex-col gap-px bg-rule">
            {listings.map((listing, i) => {
              const { role, spec, fallback, linesOf } = listing;
              const lit = linesOf(current);
              const fileIndex = fileBacked.findIndex((f) => f.listing === listing);
              return (
                <CodeListing
                  key={role}
                  name={spec.name ?? fallback}
                  code={spec.text}
                  excerpt={spec.excerpt}
                  lines={spec.excerpt === undefined ? lit : toExcerptLines(lit, spec.excerpt)}
                  language={language}
                  grow={!hasUnder && i === listings.length - 1}
                  onOpen={fileIndex === -1 ? undefined : () => setViewerAt(fileIndex)}
                />
              );
            })}
            {hasUnder ? (
              <div
                data-testid="stepshow-under"
                className="flex flex-1 flex-col justify-center bg-surface p-3"
              >
                <FrameStack
                  frames={steps.map((step) => step.props.under)}
                  current={clamped}
                  all={reserveAll}
                />
              </div>
            ) : null}
          </div>
        )}
        <div
          className={
            isBeside
              ? 'flex flex-col justify-center bg-surface p-3'
              : 'max-h-96 overflow-auto bg-surface p-3'
          }
        >
          <FrameStack
            frames={steps.map((step) => step.props.children)}
            current={clamped}
            all={reserveAll}
          />
        </div>
      </div>

      {/*
        Controls row — the SAME four buttons, in the same order and with the
        same words, as `<SequenceStepper>`: they share `stepperShell`'s
        `ControlButton`, so a reader who learned the chrome on one of the two
        does not relearn it on the other (#294).

        This comment claimed the parity held for `<MergeStepper>` and
        `<PartitionStepper>` too, and it does not — measured, both still read
        «Paso anterior» / «Paso siguiente» / Reproducir / Reiniciar, and
        `<SortStepper>` reads «Atrás» / «Paso» / Reproducir / «Reset». So
        four steppers ship three vocabularies, and this change moved one of
        them AWAY from the other two rather than towards a settled norm. The
        target chrome is recorded in `design-system.md`; converging the other
        three is not this WP's work. This one used to keep a private copy that drew
        the icon alone, which made it the only stepper whose controls had no
        words on them.

        `aria-disabled` rather than `disabled`, at both ends (a `disabled`
        button loses focus, so walking to the last step with the keyboard
        threw focus to the body and the reader could no longer walk back — the
        control that stranded them being the one they had just used).
        Announced as unavailable, still focusable, inert on click. Earned in
        #116, and now an invariant of the shared button.
      */}
      <footer className="flex flex-wrap items-center gap-2 border-t border-rule bg-sunk px-3 py-2">
        <ControlButton onClick={reset} disabled={first} label="Reiniciar">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <ControlButton onClick={retreat} disabled={first} label="Atrás">
          <SkipBack className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <ControlButton onClick={togglePlay} label={isPlaying ? 'Pausar' : 'Reproducir'}>
          {isPlaying ? (
            <Pause className="h-3.5 w-3.5" aria-hidden />
          ) : (
            <Play className="h-3.5 w-3.5" aria-hidden />
          )}
        </ControlButton>
        <ControlButton onClick={advance} disabled={last} label="Adelante">
          <SkipForward className="h-3.5 w-3.5" aria-hidden />
        </ControlButton>
        <label className="ml-1 inline-flex items-center gap-1 rounded border border-rule bg-surface px-2 py-1 text-xs text-ink">
          <span className="font-mono text-3xs text-ink-faint uppercase tracking-wide">
            velocidad
          </span>
          <select
            value={liveSpeed}
            onChange={(e) => setLiveSpeed(e.target.value as 'slow' | 'normal' | 'fast')}
            className="bg-transparent outline-none text-xs text-ink"
            aria-label="Velocidad de reproducción"
          >
            <option value="slow">lenta</option>
            <option value="normal">normal</option>
            <option value="fast">rápida</option>
          </select>
        </label>

        <span className="ml-auto font-mono text-3xs text-ink-faint">
          paso {clamped + 1} de {count}
        </span>

        {/*
          The counter alone would announce that something changed without
          saying what — for a reader who cannot see the drawing beside the
          code, what changed IS the lesson. Spanish because the page is
          served `lang="es"` (root CLAUDE.md §Language).
        */}
        <span role="status" aria-live="polite" className="sr-only">
          {programL === undefined
            ? `Paso ${clamped + 1} de ${count}, ${describeLines(currentLines)}.`
            : `Paso ${clamped + 1} de ${count}, ${programL?.name ?? 'programa'}: ${describeLines(currentProgramLines)}; ${
                helperL === undefined
                  ? ''
                  : `${helperL.name ?? 'auxiliar'}: ${describeLines(currentHelperLines)}; `
              }${codeL.name ?? 'método'}: ${describeLines(currentLines)}.`}
        </span>
      </footer>
      {viewerAt === null || files.length === 0 ? null : (
        <CodeFileViewer
          title={title}
          files={files}
          start={viewerAt}
          onClose={closeViewer}
          onPrev={retreat}
          onNext={advance}
          status={`paso ${clamped + 1} de ${count}`}
        />
      )}
    </div>
  );
}

/** A listing of the walk: its text, its file's name, and where it sits in the file. */
interface Spec {
  name: string | undefined;
  text: string;
  excerpt?: Excerpt;
  source?: string;
}

/** A listing in its place in the walk: which one it is, and what a step lights in it. */
interface Listing {
  role: 'program' | 'helper' | 'code';
  spec: Spec;
  /** Its heading when its file has no name. */
  fallback: string;
  linesOf: (step: ReactElement<StepProps>) => number[];
}

const codeLinesOf = (step: ReactElement<StepProps>) => step.props.lines ?? [];
const programLinesOf = (step: ReactElement<StepProps>) => step.props.programLines ?? [];
const helperLinesOf = (step: ReactElement<StepProps>) => step.props.helperLines ?? [];

/**
 * The listing an author named — written in the document, or quoted from a
 * file beside it — or undefined when they named none, or `{ missing }` when
 * the file they named is not under `content/`.
 */
function specOf(
  inline: string | undefined,
  src: string | undefined,
  range: string | undefined,
  name: string | undefined,
): Spec | { missing: string } | undefined {
  if (src !== undefined) {
    const source = resolveCode(src);
    if (source === null) return { missing: src };
    const excerpt = excerptOf(source, range);
    return { name: name ?? fileNameOf(src), text: excerpt.text, excerpt, source };
  }
  return inline === undefined ? undefined : { name, text: inline };
}

/**
 * Spanish rendering of the highlighted line set: "línea 6", "líneas 7 y 8",
 * "líneas 1, 4 y 9", "sin línea destacada". Kept as a helper so the test can
 * pin the phrasing rather than the choice of separator.
 */
function describeLines(lines: number[]): string {
  if (lines.length === 0) return 'sin línea destacada';
  const sorted = [...lines].sort((a, b) => a - b);
  if (sorted.length === 1) return `línea ${sorted[0]}`;
  const head = sorted.slice(0, -1).join(', ');
  const tail = sorted[sorted.length - 1];
  return `líneas ${head} y ${tail}`;
}

export { Step } from './Step';
export type { StepProps } from './Step';

/**
 * Every step's frame, stacked in one grid cell, with only the current one
 * shown. The cell is as big as the biggest frame from the first step on, so
 * the widget — and the slide that scales to fit it — keeps one size while the
 * walk runs, and what a step adds appears in the room already kept for it
 * (#363: «que tengan el tamaño final desde el comienzo»). The hidden frames
 * keep their layout (`invisible`) and leave the accessibility tree — the
 * idiom of `NarrationStrip`'s reserve. Without `all` only the current frame
 * and the last one are laid: the walk is far from the viewport (`StepShow`).
 */
function FrameStack({
  frames,
  current,
  all,
}: {
  frames: ReactNode[];
  current: number;
  all: boolean;
}) {
  const sizer = frames.length - 1;
  return (
    <div className="grid" data-testid="stepshow-frames">
      {frames.map((frame, i) => {
        const shown = i === current;
        if (!shown && !all && i !== sizer) return null;
        return (
          <div
            key={i}
            className={
              shown
                ? 'flex flex-col justify-center [grid-area:1/1]'
                : 'invisible flex flex-col justify-center [grid-area:1/1]'
            }
            aria-hidden={shown ? undefined : true}
            data-stepshow-frame={shown ? 'current' : 'reserved'}
          >
            {frame}
          </div>
        );
      })}
    </div>
  );
}
