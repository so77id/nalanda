import { useId, useState } from 'react';
import type { ReactNode } from 'react';

import { withMeta } from '../../lib/componentMeta';
import { parseQuestionParts } from '../../lib/questions';
import { QuestionListing } from './QuestionListing';

export interface QuestionProps {
  /**
   * Stable identifier. It is the join key all the way to a grade: into the
   * generated sheet, back from the reader, into the grade record (ADR-0031).
   * Never derived — see `lib/questions.ts` for why both derivations fail.
   */
  id: string;
  /** The `h2` slug this belongs to; omitted when it belongs to the whole document. */
  anchor?: string;
  children?: ReactNode;
}

/**
 * One control question, as it appears at the end of a course document.
 *
 * The answer is revealed once the reader answers, never before — the same
 * pacing `<Exercise>` uses when it hides its cases until the first run. It is
 * pacing rather than secrecy: everything under `content/` is published, so the
 * page source holds the answer either way, and a question a student cannot
 * self-check is worth less as study material.
 *
 * Renders from the PARSED parts rather than passing its children through, which
 * is what keeps a fence from becoming a runnable editor.
 */
export const Question = withMeta(
  function Question({ id, children }: QuestionProps) {
    const { statementNode, code, alternatives, type } = parseQuestionParts(children);
    const multiple = type === 'multiple';
    const [picked, setPicked] = useState<number[]>([]);
    const [answered, setAnswered] = useState(false);
    const verdictId = useId();

    // The set is the unit for a multiple: right means exactly the correct
    // alternatives, no more and no fewer. Ticking every box is the failure this
    // guards against, and it fails here for the same reason it fails on paper.
    const right = multiple
      ? picked.length === alternatives.filter(({ correct }) => correct).length &&
        picked.every((index) => alternatives[index]?.correct === true)
      : picked.some((index) => alternatives[index]?.correct === true);

    function choose(index: number): void {
      if (answered) return;
      if (!multiple) {
        // One click is the whole answer, so it also commits.
        setPicked([index]);
        setAnswered(true);
        return;
      }
      setPicked((current) =>
        current.includes(index) ? current.filter((i) => i !== index) : [...current, index],
      );
    }

    return (
      <div className="my-4 rounded border border-rule bg-surface p-4" data-question-id={id}>
        {/* Only the multiple is badged. A chapter renders ten or fifteen
            questions at once, and labelling every single-answer one is what
            stops the exception standing out. The printed sheet labels both,
            because there the reader cannot scroll back to learn the rule. */}
        {multiple ? (
          <p className="m-0 mb-2">
            <span className="rounded bg-accent-soft px-1.5 py-0.5 font-mono text-3xs uppercase tracking-wide text-accent">
              varias respuestas
            </span>
          </p>
        ) : null}

        <p className="m-0 text-sm text-ink">{statementNode}</p>

        {code ? (
          <div className="mt-3">
            <QuestionListing language={code.language} source={code.source} />
          </div>
        ) : null}

        <ul className="m-0 mt-3 list-none space-y-1 p-0" role="group" aria-label="Alternativas">
          {alternatives.map((alternative, index) => {
            const chosenThis = picked.includes(index);
            const reveal = answered && (alternative.correct || chosenThis);
            // Picked-but-not-yet-committed needs its own look, or a reader
            // ticking three boxes on a multiple watches the page not change at
            // all — `aria-pressed` is the promise to a screen reader, not to
            // the eye.
            const tone = !reveal
              ? chosenThis
                ? 'border-accent bg-accent-soft text-ink'
                : 'border-rule text-ink'
              : alternative.correct
                ? 'border-keep bg-keep-soft text-keep'
                : 'border-flag bg-flag-soft text-flag';
            return (
              <li key={alternative.text} className="m-0">
                <button
                  type="button"
                  disabled={answered}
                  onClick={() => choose(index)}
                  aria-pressed={chosenThis}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${tone} disabled:cursor-default`}
                >
                  {alternative.node}
                </button>
              </li>
            );
          })}
        </ul>

        {/* A multiple commits as a set, so it needs somewhere to say "done".
            Disabled while empty: an empty commit is a misclick rather than an
            answer, and revealing on it costs the reader the question for
            nothing. */}
        {multiple && !answered ? (
          <button
            type="button"
            disabled={picked.length === 0}
            onClick={() => setAnswered(true)}
            aria-describedby={verdictId}
            className="mt-3 rounded border border-rule px-3 py-1 text-xs text-ink disabled:cursor-default disabled:text-ink-faint"
          >
            Comprobar
          </button>
        ) : null}

        {/* Announced, not merely coloured: colour is never the only signal (ADR-0026). */}
        <p
          id={verdictId}
          role="status"
          aria-live="polite"
          className={`m-0 mt-3 min-h-5 text-xs ${right ? 'text-keep' : 'text-flag'}`}
        >
          {!answered
            ? ''
            : right
              ? 'Correcto.'
              : multiple
                ? 'Incorrecto. Las respuestas correctas están marcadas.'
                : 'Incorrecto. La respuesta correcta está marcada.'}
        </p>
      </div>
    );
  },
  { questionRole: 'question' },
);
