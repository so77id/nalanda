import { withMeta } from '../../lib/componentMeta';
import { useMode } from '../../presentation';

/**
 * Slide boundary without a heading (ADR-0010 contract). Book: a subtle
 * divider. Presentation: nothing — the boundary is consumed by the parser.
 */
export function SectionBreak() {
  const mode = useMode();
  if (mode === 'presentation') return null;
  return <hr className="my-8 border-slate-800" />;
}

withMeta(SectionBreak, { slideBoundary: 'section-break' });
