import { Suspense, lazy } from 'react';
import type { ComponentType, ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { Toc } from './Toc';
import { prevNext } from './courseIndex';
import { courseIndex, registry } from './liveContent';

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

function titleOf(id: string): string {
  return registry.get(id)?.meta.title ?? id;
}

function SequenceNav({ id }: { id: string }) {
  const { prev, next } = prevNext(courseIndex, id);
  if (!prev && !next) return null;
  return (
    <nav aria-label="Document sequence" className="mt-12 flex justify-between gap-4 text-sm">
      {prev ? (
        <Link to={`/d/${prev}`} className="text-sky-400 hover:underline">
          ← {titleOf(prev)}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={`/d/${next}`} className="text-sky-400 hover:underline">
          {titleOf(next)} →
        </Link>
      ) : (
        <span />
      )}
    </nav>
  );
}

interface Props {
  /** Rendered when the id is unknown — injected by the shell so the feature never imports app/. */
  notFound: ReactNode;
}

/** Renders the document whose frontmatter id matches the /d/:id route param. */
export function DocumentPage({ notFound }: Props) {
  const { id = '' } = useParams();
  const entry = registry.get(id);
  const Doc = entry ? componentFor(id, entry.load) : null;

  if (!Doc) return <>{notFound}</>;
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-64 shrink-0 border-r border-slate-800 p-4">
        <Toc index={courseIndex} />
      </aside>
      <main className="min-w-0 flex-1 px-8 py-10">
        <article className="prose prose-invert prose-slate mx-auto max-w-3xl">
          <Suspense fallback={null}>
            <Doc />
          </Suspense>
          <SequenceNav id={id} />
        </article>
      </main>
    </div>
  );
}
