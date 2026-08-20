import { EditorView, Decoration, type DecorationSet } from '@codemirror/view';
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
   * Which language grammar CodeMirror uses to syntax-highlight the listing.
   * Any known runtime id loads that language's grammar (`loadGrammar(id)` — the
   * editor-half of the runtime split from #122); anything else (or omitted)
   * shows the listing plain. Java is the default because `<StepShow>` is a
   * Java-teaching widget today, and the first consumer that isn't Java can
   * override.
   */
  language?: string;
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
export function CodeStepper({ code, highlightLines, language }: CodeStepperProps) {
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
      }),
    [],
  );

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

  return (
    <div data-highlight-lines={highlightLines.join(',')} className="bg-surface">
      <CodeMirror
        value={code}
        editable={false}
        readOnly
        theme={theme}
        extensions={[...(grammar ? [grammar] : []), themeExtension, decorationExtension]}
        basicSetup={{
          lineNumbers: true,
          foldGutter: false,
          highlightActiveLine: false,
          highlightActiveLineGutter: false,
        }}
        onCreateEditor={(view) => {
          viewRef.current = view;
          // Apply the initial highlight on mount — the effect above only runs
          // AFTER the first render (it depends on viewRef being populated).
          view.dispatch({ effects: setActiveLines.of(highlightLines) });
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

function makeHighlightExtension() {
  return StateField.define<DecorationSet>({
    create: () => Decoration.none,
    update: (deco, tr) => {
      for (const effect of tr.effects) {
        if (effect.is(setActiveLines)) {
          const lines = effect.value;
          if (lines.length === 0) return Decoration.none;
          const doc = tr.state.doc;
          const decos = [];
          for (const n of lines) {
            if (n < 1 || n > doc.lines) continue;
            const line = doc.line(n);
            decos.push(
              Decoration.line({
                attributes: { class: 'nal-step-line-active', 'data-active': 'true' },
              }).range(line.from),
            );
          }
          return Decoration.set(decos, /* sort */ true);
        }
      }
      return deco.map(tr.changes);
    },
    provide: (field) => EditorView.decorations.from(field),
  });
}
