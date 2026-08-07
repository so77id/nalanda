import { withMeta } from '../../lib/componentMeta';

/**
 * Slide boundary without a heading (ADR-0010). Skeleton: book rendering only —
 * the per-mode contract completes in S3 of issue #64.
 */
export function SectionBreak() {
  return <hr className="my-8 border-slate-800" />;
}

withMeta(SectionBreak, { slideBoundary: 'section-break' });
