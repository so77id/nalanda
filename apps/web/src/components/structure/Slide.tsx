import type { ReactNode } from 'react';

import { withMeta } from '../../lib/componentMeta';

interface Props {
  title?: string;
  children?: ReactNode;
}

/**
 * Explicit slide boundary (ADR-0010). Skeleton: book rendering only — the
 * per-mode contract completes in S3 of issue #64.
 */
export function Slide({ title, children }: Props) {
  return (
    <>
      {title ? <h2>{title}</h2> : null}
      {children}
    </>
  );
}

withMeta(Slide, { slideBoundary: 'slide' });
