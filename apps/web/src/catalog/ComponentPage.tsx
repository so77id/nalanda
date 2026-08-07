import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { ComponentArticle } from './ComponentArticle';
import { catalog } from './registry';

interface Props {
  /** Rendered when the component name is unknown — injected by the shell. */
  notFound: ReactNode;
}

/** /catalog/c/:name — a component's catalog page. */
export function ComponentPage({ notFound }: Props) {
  const { name = '' } = useParams();
  const entry = catalog.byName(name);

  if (!entry) return <>{notFound}</>;
  return <ComponentArticle entry={entry} />;
}
