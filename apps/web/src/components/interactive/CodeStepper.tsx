import { EditorView, Decoration, lineNumbers, type DecorationSet } from '@codemirror/view';
import { StateField, StateEffect } from '@codemirror/state';
import CodeMirror from '@uiw/react-codemirror';
import { useEffect, useMemo, useRef } from 'react';

import { isRuntimeId, type RuntimeId } from '../../lib/runtimeIds';
import { useResolvedTheme } from '../../lib/useResolvedTheme';
import { useGrammar } from './useGrammar';

export interface CodeStepperProps {
  /** The listing shown, exactly as the author wrote it. */
  code: string;
  /** 1-based line numbers to highlight. Empty means no highlight this step. */
  highlightLines: number[];
  /**
   * 1-based line numbers to render dimmed — painted with reduced opacity so
   * "these lines don't participate in this scenario" reads at a glance.
   * Independent of `highlightLines`; a line can be either, neither, or (in
   * theory) both — dim wins the paint in that case.
   */
  dimmedLines?: number[];
  /**
   * Which language grammar CodeMirror uses to syntax-highlight the listing.
   * Any known runtime id loads that language's grammar (`loadGrammar(id)` — the
   * editor-half of the runtime split from #122); anything else (or omitted)
   * shows the listing plain. Java is the default because `<StepShow>` is a
   * Java-teaching widget today, and the first consumer that isn't Java can
   * override.
   */
  language?: string;
  /**
   * Called whenever the pointer enters or leaves a code line. Delivers the
   * 1-based line number under the cursor, or `null` when the pointer leaves
   * the editor. Used by <ComplexityCounter> to sync a side-rail with the
   * editor without turning this component into a stateful widget itself.
   */
  onLineHover?: (line: number | null) => void;
  /**
   * The number the gutter gives the first line — the line of its file a
   * listing cut out of one starts at (ADR-0091). Default 1. Only the gutter
   * changes: `highlightLines` and `dimmedLines` still count the listing's own
   * lines from 1.
   */
  firstLine?: number;
  /**
   * 1-based lines marked with a band down their left edge: the part of a whole
   * file a slide quotes, when the file is shown entire (`<CodeFileViewer>`).
   */
  bandLines?: number[];
}

/**
 * A read-only code listing with per-line highlighting, driven by its props.
 *
 * Uses CodeMirror in read-only mode with `loadGrammar(id)` for syntax colour —
 * the same grammar every other `java` fence on the site gets through
 * `<MdxPre>` → `<LazyCodeEditor>`, so the listing beside a `<MemoryVisual>`
 * reads the same as the listing inside a `<CodeEditor>` or a
 * `<PredictOutput>` on the same page. Costs its own CodeMirror-adjacent
 * chunk; `<StepShow>` therefore ships behind `lazyStepShow.tsx` so pages
 * without a diagram pay none of it (architecture-test guarded, same shape as
 * `<CodeEditor>` / `<Exercise>` / `<PredictOutput>` / `<Mermaid>`).
 *
 * The active-line highlight is a per-line CodeMirror `Decoration.line` that
 * paints `.nal-step-line-active` (a subtle `--color-keep-soft` background); a
 * `data-active="true"` attribute rides along, and the wrapper carries
 * `data-highlight-lines` for the suite (jsdom mocks CodeMirror, so the paint
 * itself is the browser check — same shape `<RecursionTree>` earned in #78).
 */
export function CodeStepper({
  code,
  highlightLines,
  dimmedLines,
  language,
  onLineHover,
  firstLine = 1,
  bandLines,
}: CodeStepperProps) {
  const theme = useResolvedTheme();
  const grammarLang: RuntimeId = isRuntimeId(language ?? '') ? (language as RuntimeId) : 'java';
  const grammar = useGrammar(grammarLang);
  const viewRef = useRef<EditorView | null>(null);

  const decorationExtension = useMemo(() => makeHighlightExtension(), []);
  const themeExtension = useMemo(
    () =>
      EditorView.theme({
        '.nal-step-line-active': {
          backgroundColor: 'var(--color-keep-soft)',
        },
        '.nal-step-line-band': {
          boxShadow: 'inset 3px 0 0 var(--color-accent)',
        },
        '.nal-step-line-dimmed': {
          opacity: '0.35',
          filter: 'grayscale(0.6)',
        },
      }),
    [],
  );
  // Hover-line tracker. `mousemove` fires per pointer move; we translate
  // clientX/Y to a document position via `posAtCoords`, then to a 1-based
  // line number. Latest-wins; a mouseleave clears the state. Kept as a
  // ref-plus-dispatch pattern so we don't tear down and rebuild the
  // extension on every re-render.
  const hoverExtension = useMemo(() => {
    if (onLineHover === undefined) return [];
    return [
      EditorView.domEventHandlers({
        mousemove(event, view) {
          const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
          if (pos === null) return false;
          const lineNum = view.state.doc.lineAt(pos).number;
          onLineHover(lineNum);
          return false;
        },
        mouseleave() {
          onLineHover(null);
          return false;
        },
      }),
    ];
  }, [onLineHover]);

  // Push the current highlight into the editor whenever the step changes. The
  // extension itself is stable; the effect below dispatches a `setActiveLines`
  // state effect that the StateField reacts to. A prop-driven decoration
  // pattern — same shape CodeMirror's own docs recommend for external state
  // (StateEffect + StateField).
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setActiveLines.of(highlightLines) });
  }, [highlightLines]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setDimmedLines.of(dimmedLines ?? []) });
  }, [dimmedLines]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({ effects: setBandLines.of(bandLines ?? []) });
  }, [bandLines]);

  // The gutter counts from the listing's place in its file. Built as its own
  // extension (and the default gutter turned off) only when it differs, so a
  // listing that starts at 1 keeps exactly the setup it always had.
  const gutterExtension = useMemo(
    () =>
      firstLine === 1 ? [] : [lineNumbers({ formatNumber: (n) => String(n + firstLine - 1) })],
    [firstLine],
  );

  return (
    <div
      data-highlight-lines={highlightLines.join(',')}
      data-dimmed-lines={(dimmedLines ?? []).join(',')}
      data-first-line={firstLine}
      data-band-lines={(bandLines ?? []).join(',')}
      className="bg-surface"
    >
      <CodeMirror
        value={code}
        editable={false}
        readOnly
        theme={theme}
        extensions={[
          ...(grammar ? [grammar] : []),
          themeExtension,
          decorationExtension,
          ...gutterExtension,
          ...hoverExtension,
        ]}
        basicSetup={{
          lineNumbers: firstLine === 1,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        onCreateEditor={(view) => {
          viewRef.current = view;
          // Apply the initial highlight and dim on mount — the effects above
          // only run AFTER the first render (they depend on viewRef being
          // populated).
          view.dispatch({ effects: setActiveLines.of(highlightLines) });
          view.dispatch({ effects: setDimmedLines.of(dimmedLines ?? []) });
          view.dispatch({ effects: setBandLines.of(bandLines ?? []) });
        }}
      />
    </div>
  );
}

// ── CodeMirror plumbing ──────────────────────────────────────────────────────

/**
 * StateEffect + StateField pair. The effect carries the new highlighted line
 * list; the field stores it and rebuilds a `DecorationSet` from the current
 * document. Rebuilt-not-mapped on purpose: the document is constant, and
 * mapping a decoration across an unchanged doc buys nothing over computing it
 * fresh.
 */
const setActiveLines = StateEffect.define<number[]>();
const setDimmedLines = StateEffect.define<number[]>();
const setBandLines = StateEffect.define<number[]>();

/**
 * Two independent StateFields — one for the active-line decorations, one for
 * the dimmed-line decorations — combined into the editor's decoration stream
 * so both paints can coexist. Split so a change in one pool never clears the
 * other; the effects fire independently from separate `useEffect`s.
 */
function makeHighlightExtension() {
  const activeField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (deco, tr) => {
      for (const effect of tr.effects) {
        if (effect.is(setActiveLines)) {
          return buildLineDecorations(tr.state.doc, effect.value, 'nal-step-line-active', 'active');
        }
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const dimmedField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (deco, tr) => {
      for (const effect of tr.effects) {
        if (effect.is(setDimmedLines)) {
          return buildLineDecorations(tr.state.doc, effect.value, 'nal-step-line-dimmed', 'dimmed');
        }
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  const bandField = StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (deco, tr) => {
      for (const effect of tr.effects) {
        if (effect.is(setBandLines)) {
          return buildLineDecorations(tr.state.doc, effect.value, 'nal-step-line-band', 'band');
        }
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
  return [activeField, dimmedField, bandField];
}

function buildLineDecorations(
  doc: { lines: number; line: (n: number) => { from: number } },
  lines: number[],
  className: string,
  dataFlag: 'active' | 'dimmed' | 'band',
): DecorationSet {
  if (lines.length === 0) return Decoration.none;
  const decos = [];
  for (const n of lines) {
    if (n < 1 || n > doc.lines) continue;
    const line = doc.line(n);
    decos.push(
      Decoration.line({
        attributes: { class: className, [`data-${dataFlag}`]: 'true' },
      }).range(line.from),
    );
  }
  return Decoration.set(decos, /* sort */ true);
}
