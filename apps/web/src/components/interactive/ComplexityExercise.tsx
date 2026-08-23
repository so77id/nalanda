import { type ReactNode, useState } from 'react';

import { AuthoringError } from '../AuthoringError';
import { CodeStepper } from './CodeStepper';
import { ComplexityCounter, type ComplexityCounterProps } from './ComplexityCounter';

/**
 * A complexity-analysis exercise: shows the code, invites the student to
 * work out T(n) / O() / M(n), and reveals the full development inside a
 * `<ComplexityCounter>` when the student clicks "Ver desarrollo".
 *
 * Same shape as the Java exercises of the earlier session — code + prompt +
 * button — but the "check" step is not automated correctness (there is no
 * ground truth against a symbolic derivation): the reveal exists so the
 * student can compare their pencil-and-paper answer against the annotated
 * counter row by row.
 *
 * Composition — one widget = one question, per the agreed rule for this
 * course:
 * - `<CodeStepper>` shows the listing with the same grammar every other
 *   Java fence gets on the site (no re-implementation of the editor).
 * - `<ComplexityCounter>` is the reveal: the SAME widget used elsewhere in
 *   the document, so the format the student saw during the lesson is the
 *   format that grades their thinking.
 *
 * The rendering deliberately does not use `<SideBySide direction="vertical">`
 * internally — the exercise reads better as a linear prompt → reveal flow
 * than as two labelled columns stacked, and hiding the reveal cleanly is
 * simpler with a plain conditional than with `<SideBySide>`'s exactly-two
 * children rule. The `direction` prop on `<SideBySide>` (S11) is still
 * useful for authors placing two blocks (Figure, MathPlot, …) at full
 * width in a slide.
 */
export interface ComplexityExerciseProps extends ComplexityCounterProps {
  /**
   * The question posed to the student. Three canned prompts render as full
   * Spanish sentences; anything else is treated as a custom prompt and
   * shown verbatim.
   *
   *   "T(n)" → "Calcula T(n) en OE y clasifica en Θ."
   *   "O()"  → "Da la clase asintótica del algoritmo (O grande)."
   *   "M(n)" → "Calcula M(n) en celdas y clasifica en Θ."
   */
  prompt?: 'T(n)' | 'O()' | 'M(n)' | string;
  /** Optional preamble shown above the code (short context sentence). */
  hint?: string;
  /**
   * Optional custom reveal. When present, the reveal panel renders THIS
   * ReactNode instead of a `<ComplexityCounter>`. Use when the exercise
   * has no annotated code — for example an abstract crossover problem
   * that compares two Θ classes with symbolic derivation. The `data` /
   * `mode` / `cases` props are ignored when `reveal` is provided.
   */
  reveal?: ReactNode;
}

export function ComplexityExercise({
  prompt = 'T(n)',
  hint,
  reveal,
  code,
  language = 'java',
  algorithm,
  ...counterProps
}: ComplexityExerciseProps) {
  const [revealed, setRevealed] = useState(false);
  const [userAnswer, setUserAnswer] = useState('');

  if (code === undefined || code.trim() === '') {
    return (
      <AuthoringError component="ComplexityExercise">
        falta la prop <code>code</code>: el listado sobre el que el alumno debe calcular
        la complejidad.
      </AuthoringError>
    );
  }

  const promptText = renderPrompt(prompt);

  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <header className="flex flex-wrap items-center gap-2 bg-sunk px-3 py-1.5">
        <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
          ejercicio
        </span>
        {algorithm !== undefined && (
          <span className="font-mono text-sm text-ink">{algorithm}</span>
        )}
      </header>

      <div className="border-b border-rule px-3 py-2 text-sm text-ink">
        <strong className="text-ink">Enunciado.</strong> {promptText}
      </div>

      {hint !== undefined && (
        <p className="border-b border-rule bg-sunk/30 px-3 py-2 text-xs text-ink-soft">
          {hint}
        </p>
      )}

      <CodeStepper code={code} language={language} highlightLines={[]} />

      <div className="border-t border-rule px-3 py-2">
        <label className="mb-1 block text-3xs uppercase tracking-wide text-ink-faint">
          Tu respuesta (opcional)
        </label>
        <textarea
          value={userAnswer}
          onChange={(event) => setUserAnswer(event.target.value)}
          rows={2}
          placeholder="Ej: T(n) = 4n + 4 → Θ(n)"
          className="w-full rounded border border-rule bg-surface p-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent focus:outline-none"
          aria-label="Tu respuesta al ejercicio"
        />
      </div>

      <div className="flex items-center gap-2 border-t border-rule bg-sunk/30 px-3 py-2">
        <button
          type="button"
          onClick={() => setRevealed((prev) => !prev)}
          aria-expanded={revealed}
          className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:opacity-90"
        >
          {revealed ? 'Ocultar desarrollo' : 'Ver desarrollo'}
        </button>
        {!revealed && (
          <span className="text-xs text-ink-faint">
            Piensa tu respuesta primero — el desarrollo se abre al apretar el botón.
          </span>
        )}
      </div>

      {revealed && (
        <div className="border-t border-rule">
          {reveal !== undefined ? (
            <div className="px-3 py-3 text-sm text-ink">{reveal}</div>
          ) : (
            <ComplexityCounter
              code={code}
              language={language}
              algorithm={algorithm}
              {...counterProps}
            />
          )}
        </div>
      )}
    </div>
  );
}

function renderPrompt(prompt: string): string {
  switch (prompt) {
    case 'T(n)':
      return 'Calcula T(n) en OE y clasifica en Θ.';
    case 'O()':
      return 'Da la clase asintótica del algoritmo (O grande).';
    case 'M(n)':
      return 'Calcula M(n) en celdas y clasifica en Θ.';
    default:
      return prompt;
  }
}
