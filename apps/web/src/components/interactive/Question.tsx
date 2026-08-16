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
    const { statementNode, code, alternatives } = parseQuestionParts(children);
    const [chosen, setChosen] = useState<number | null>(null);
    const verdictId = useId();
    const answered = chosen !== null;
    const right = answered && alternatives[chosen]?.correct === true;

    return (
      <div className="my-4 rounded border border-rule bg-surface p-4" data-question-id={id}>
        <p className="m-0 text-sm text-ink">{statementNode}</p>

        {code ? (
          <div className="mt-3">
            <QuestionListing language={code.language} source={code.source} />
          </div>
        ) : null}

        <ul className="m-0 mt-3 list-none space-y-1 p-0" role="group" aria-label="Alternativas">
          {alternatives.map((alternative, index) => {
            const chosenThis = chosen === index;
            const reveal = answered && (alternative.correct || chosenThis);
            const tone = !reveal
              ? 'border-rule text-ink'
              : alternative.correct
                ? 'border-keep bg-keep-soft text-keep'
                : 'border-flag bg-flag-soft text-flag';
            return (
              <li key={alternative.text} className="m-0">
                <button
                  type="button"
                  disabled={answered}
                  onClick={() => setChosen(index)}
                  aria-pressed={chosenThis}
                  className={`w-full rounded border px-3 py-2 text-left text-sm ${tone} disabled:cursor-default`}
                >
                  {alternative.node}
                </button>
              </li>
            );
          })}
        </ul>

        {/* Announced, not merely coloured: colour is never the only signal (ADR-0026). */}
        <p
          id={verdictId}
          role="status"
          aria-live="polite"
          className={`m-0 mt-3 min-h-5 text-xs ${right ? 'text-keep' : 'text-flag'}`}
        >
          {!answered ? '' : right ? 'Correcto.' : 'Incorrecto. La respuesta correcta está marcada.'}
        </p>
      </div>
    );
  },
  { questionRole: 'question' },
);
