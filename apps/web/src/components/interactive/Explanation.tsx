import type { ReactNode } from 'react';

import { withMeta } from '../../lib/componentMeta';

export interface ExplanationProps {
  children?: ReactNode;
}

/**
 * A pedagogical note attached to a `<Question>`.
 *
 * The reader sees it only AFTER answering — same pacing rule as the
 * verdict, so the explanation cannot spoil the guess. Authored inline
 * inside the question:
 *
 * ```mdx
 * <Question id="...">
 *
 * ¿Enunciado?
 *
 * - [x] Respuesta
 * - [ ] Otra
 *
 * <Explanation>
 * Por qué la marcada es la correcta.
 * </Explanation>
 *
 * </Question>
 * ```
 *
 * Not exported to `questions.json`: the printed control never shows it, and
 * the bank stays a set of stems + alternatives + correct-set (ADR-0032).
 * The exclusion happens at the source parser (`questionSource.ts`), which
 * skips the block — the widget picks it up separately from the rendered
 * subtree via `parseQuestionParts`. Two readers, one authored source.
 *
 * The component itself renders nothing when mounted directly: `<Question>`
 * pulls it apart from its own children and paints it below the verdict.
 */
export const Explanation = withMeta(
  function Explanation(_: ExplanationProps) {
    return null;
  },
  { questionRole: 'explanation' },
);
