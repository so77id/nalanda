import { Presentation } from 'lucide-react';
import { Suspense, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Breadcrumb } from './Breadcrumb';
import { SectionNav } from './SectionNav';
import { Toc } from './Toc';
import { hasTrail, prevNext, trailFor } from './courseIndex';
import { useSections } from './useSections';
import { lazyDocumentComponent } from './lazyDoc';
import { courseIndex, registry } from './liveContent';

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
  const navigate = useNavigate();
  const entry = registry.get(id);
  const presentable = entry !== undefined && entry.meta.presentation !== 'none';
  const Doc = entry ? lazyDocumentComponent(entry) : null;
  const trail = trailFor(courseIndex, id);
  const article = useRef<HTMLElement>(null);
  const { sections, activeId } = useSections(article);

  // POC shortcut: p enters presentation from the book view (never while typing).
  useEffect(() => {
    if (!presentable) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'p' || event.metaKey || event.ctrlKey || event.altKey) return;
      const target = event.target as HTMLElement;
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
        return;
      void navigate(`/d/${id}/present`);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [id, navigate, presentable]);

  if (!Doc) return <>{notFound}</>;
  return (
    <div className="flex min-h-screen bg-slate-950 text-slate-100">
      <aside className="w-64 shrink-0 border-r border-slate-800 p-4">
        <Toc index={courseIndex} />
      </aside>
      <main className="min-w-0 flex-1 px-8 py-10">
        {hasTrail(trail) || presentable ? (
          <div className="mx-auto mb-8 flex max-w-3xl items-start justify-between gap-4 border-b border-slate-800 pb-3">
            {/* Always occupies the left, so Presentar keeps the right edge without a trail. */}
            <div className="min-w-0 flex-1">
              <Breadcrumb trail={trail} />
            </div>
            {presentable ? (
              <Link
                to={`/d/${id}/present`}
                className="flex shrink-0 items-center gap-1.5 rounded border border-slate-700 px-3 py-1 text-sm text-slate-300 hover:bg-slate-800 hover:text-slate-100"
              >
                <Presentation size={14} aria-hidden="true" />
                Presentar
              </Link>
            ) : null}
          </div>
        ) : null}
        <article ref={article} className="prose prose-invert prose-slate mx-auto max-w-3xl">
          <Suspense fallback={null}>
            <Doc />
          </Suspense>
          <SequenceNav id={id} />
        </article>
      </main>
      {/* The rail costs 224px and only appears where nothing else pays for it:
          256 (sidebar) + 64 (gutters) + 768 (reading column) + 224 (rail) =
          1312px. Tailwind's 2xl (1536px) is the first breakpoint above that —
          xl is 1280 and would land 32px short, squeezing the column. The
          reading column is never narrowed to bring the rail down (issue #84);
          below this width the sections live in the drawer. */}
      <aside className="hidden w-56 shrink-0 py-10 pr-8 2xl:block">
        <div className="sticky top-10">
          <SectionNav sections={sections} activeId={activeId} />
        </div>
      </aside>
    </div>
  );
}
