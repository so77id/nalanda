import { MDXProvider } from '@mdx-js/react';
import { Suspense, lazy, useMemo } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { MdxLink } from './MdxLink';
import { registry } from './registry';

const mdxComponents = { a: MdxLink };

// lazy() must be called once per document, not per render, or React remounts the tree.
const lazyCache = new Map<string, ComponentType>();

function componentFor(id: string, load: () => Promise<{ default: ComponentType }>): ComponentType {
  let cached = lazyCache.get(id);
  if (!cached) {
    cached = lazy(load);
    lazyCache.set(id, cached);
  }
  return cached;
}

interface Props {
  /** Rendered when the id is unknown — injected by the shell so the feature never imports app/. */
  notFound: ReactNode;
}

/** Renders the document whose frontmatter id matches the /d/:id route param. */
export function DocumentPage({ notFound }: Props) {
  const { id = '' } = useParams();
  const entry = registry.get(id);
  const Doc = useMemo(() => (entry ? componentFor(id, entry.load) : null), [id, entry]);

  if (!Doc) return <>{notFound}</>;
  return (
    <main>
      <MDXProvider components={mdxComponents}>
        <Suspense fallback={null}>
          <Doc />
        </Suspense>
      </MDXProvider>
    </main>
  );
}
