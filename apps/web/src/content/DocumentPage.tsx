import { Menu, Presentation } from 'lucide-react';
import { Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Breadcrumb } from './Breadcrumb';
import { Drawer } from './Drawer';
import { SectionNav } from './SectionNav';
import { Toc } from './Toc';
import { prevNext, trailFor } from './courseIndex';
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
    <nav
      aria-label="Documento anterior y siguiente"
      className="measure-full mt-12 flex justify-between gap-4 text-sm"
    >
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
  const [drawerOpen, setDrawerOpen] = useState(false);
  // Stable identity: the Drawer sets up its focus trap once per open, and an
  // inline arrow here would rebuild it on every render of this page.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // Navigating inside the drawer must not leave it covering the document.
  useEffect(() => setDrawerOpen(false), [id]);

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
      {/* Below md the column costs more than the whole reading width is worth:
          at 390px it left the article 70px, about six characters per line. */}
      <aside className="hidden w-64 shrink-0 border-r border-slate-800 p-4 md:block">
        <Toc index={courseIndex} activeId={id} />
      </aside>
      {/* The drawer carries BOTH navigations, and which one is worth opening it
          for depends on the width — see the toggle below. The course index is
          only in here below md, where the sidebar is gone; above md it would be
          a second copy of a column already on screen. Sections are always here:
          the rail does not appear until 2xl. Same hook, same list — one spine,
          two placements (ADR-0021). */}
      <Drawer open={drawerOpen} onClose={closeDrawer} label="Navegación">
        <div className="space-y-6">
          <SectionNav sections={sections} activeId={activeId} onNavigate={closeDrawer} />
          <div className="md:hidden">
            <Toc index={courseIndex} activeId={id} />
          </div>
        </div>
      </Drawer>
      <main className="min-w-0 flex-1 px-4 py-10 md:px-8">
        {/* Always rendered: below md this row is the only home of the drawer
            toggle, so a document with nothing to put in the breadcrumb must not
            take the course navigation down with it. */}
        <div className="mx-auto mb-8 flex max-w-3xl items-start justify-between gap-4 border-b border-slate-800 pb-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            {/* Below md the drawer is the only course index there is, so the
                toggle is always there. Between md and 2xl the sidebar is back
                but the rail has not arrived, so the toggle stays for the
                sections alone — and disappears again for a document that has
                none, rather than opening an empty panel (apuntes-del-curso
                ships with zero h2). At 2xl the rail takes over. */}
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir la navegación"
              className={`shrink-0 rounded border border-slate-700 p-1.5 text-slate-300 hover:bg-slate-800 hover:text-slate-100 ${
                sections.length > 0 ? '2xl:hidden' : 'md:hidden'
              }`}
            >
              <Menu size={16} aria-hidden="true" />
            </button>
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
        <article
          ref={article}
          className="prose prose-invert prose-slate measured-prose mx-auto max-w-3xl"
        >
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
