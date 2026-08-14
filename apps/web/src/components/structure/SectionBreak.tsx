import { withMeta } from '../../lib/componentMeta';
import { useMode } from '../../presentation';

/**
 * Slide boundary without a heading (ADR-0010 contract). Book: a subtle
 * divider. Presentation: nothing — the boundary is consumed by the parser.
 *
 * `measure-full` because it divides the whole column, not the running text:
 * without it the reading measure narrows the rule to 39rem while the code
 * blocks it separates keep the full 768px (`styles/index.css`).
 */
export function SectionBreak() {
  const mode = useMode();
  if (mode === 'presentation') return null;
  return <hr className="measure-full my-8 border-rule" />;
}

withMeta(SectionBreak, { slideBoundary: 'section-break' });
