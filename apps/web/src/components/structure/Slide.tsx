import { useMDXComponents } from '@mdx-js/react';
import type { ElementType, ReactNode } from 'react';

import { withMeta } from '../../lib/componentMeta';
import { useMode } from '../../presentation';

interface Props {
  title?: string;
  children?: ReactNode;
}

/**
 * Explicit slide boundary (ADR-0010 contract). Book: h2 (the MDX-mapped one,
 * so anchors apply) + flowing children. Presentation: children only — the
 * boundary itself is consumed by the slide parser, and the title becomes
 * viewer chrome.
 */
export function Slide({ title, children }: Props) {
  const mode = useMode();
  const components = useMDXComponents();

  if (mode === 'presentation') return <>{children}</>;
  const H2 = (components['h2'] ?? 'h2') as ElementType;
  return (
    <>
      {title ? <H2>{title}</H2> : null}
      {children}
    </>
  );
}

withMeta(Slide, { slideBoundary: 'slide' });
