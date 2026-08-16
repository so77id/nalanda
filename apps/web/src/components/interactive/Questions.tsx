import type { ReactNode } from 'react';

import { withMeta } from '../../lib/componentMeta';

export interface QuestionsProps {
  children?: ReactNode;
}

/**
 * The block of control questions at the end of a course document.
 *
 * Written at the end and anchored to a section, footnote-style: writing prose
 * and writing questions are different mental modes, and mixing them in the body
 * makes the `.mdx` unreadable as material. Each `<Question>` names the section
 * it belongs to, so "from section X to section Y" resolves without the
 * questions living up there.
 *
 * **Its heading is a bare `h2` with no id, and that is deliberate.** A section
 * is an `h2` the platform gave a slug to (ADR-0021), and the rail collects
 * those. If this heading became one, a document declaring `questions:
 * per-section` would owe a question about its own questions section — a rule
 * eating its own tail. Styled like a heading, invisible to the section spine.
 */
export const Questions = withMeta(
  function Questions({ children }: QuestionsProps) {
    return (
      <section className="mt-10 border-t border-rule pt-6">
        <h2 className="m-0 text-lg font-semibold text-ink">Preguntas</h2>
        {children}
      </section>
    );
  },
  { questionRole: 'group' },
);
