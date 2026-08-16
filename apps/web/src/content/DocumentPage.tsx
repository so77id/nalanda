import { Menu, Presentation } from 'lucide-react';
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';

import { KnownSectionsProvider } from '../lib/knownSections';
import { Link, useNavigate, useParams } from 'react-router-dom';

import { Breadcrumb } from './Breadcrumb';
import { ThemeToggle } from './ThemeToggle';
import { Drawer } from './Drawer';
import { SectionNav } from './SectionNav';
import { Toc } from './Toc';
import { prevNext, trailFor } from './courseIndex';
import type { IndexEntry } from './courseIndex';
import { useSections } from './useSections';
import { lazyDocumentComponent } from './lazyDoc';
import { courseIndex, registry } from './liveContent';

function titleOf(id: string): string {
  return registry.get(id)?.meta.title ?? id;
}

/** How a crumb is named — the same resolution the tree uses, registry title included. */
function docLabel(entry: IndexEntry): string {
  return entry.label ?? (entry.docId ? titleOf(entry.docId) : '');
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
        <Link to={`/d/${prev}`} className="text-accent hover:underline">
          ← {titleOf(prev)}
        </Link>
      ) : (
        <span />
      )}
      {next ? (
        <Link to={`/d/${next}`} className="text-accent hover:underline">
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
  const trail = trailFor(courseIndex, id, docLabel);
  const article = useRef<HTMLElement>(null);
  const { sections, activeId } = useSections(article);
  // Memoised on the ids alone: a fresh Set every render would re-render every
  // question on the page each time the reader scrolls past a heading, because
  // `activeId` changes far more often than the spine does.
  const sectionIds = useMemo(() => new Set(sections.map((section) => section.id)), [sections]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  // One handler for the two things that close the drawer (the drawer itself,
  // and following a section link inside it). Not a correctness requirement:
  // the Drawer holds its own callback in a ref, and its tests pass an inline
  // arrow on purpose to prove that.
  const closeDrawer = useCallback(() => setDrawerOpen(false), []);

  // The width policy, in one expression so the two halves cannot drift apart:
  // below md the drawer is the only index there is, so the toggle is always
  // there; between md and 2xl the sidebar is back and the toggle stays for the
  // sections alone — which is why the <Toc> inside the drawer is md:hidden, and
  // why a document with no sections hides the toggle instead of opening an
  // empty panel (04-apuntes.mdx ships with zero h2). At 2xl the rail takes over.
  const toggleHiddenAt = sections.length > 0 ? '2xl:hidden' : 'md:hidden';

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
    <div className="flex min-h-screen bg-ground text-ink">
      {/* Below md the column costs more than the whole reading width is worth:
          at 390px it left the article 70px, about six characters per line. */}
      <aside className="hidden w-64 shrink-0 border-r border-rule p-4 md:block">
        <Toc index={courseIndex} activeId={id} />
      </aside>
      {/* The drawer carries BOTH navigations; `toggleHiddenAt` above states the
          policy the md:hidden below is the other half of. Same hook, same list
          as the rail — one spine, two placements (ADR-0021). */}
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
        <div className="mx-auto mb-8 flex max-w-3xl items-start justify-between gap-4 border-b border-rule pb-3">
          <div className="flex min-w-0 flex-1 items-start gap-3">
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-label="Abrir la navegación"
              className={`shrink-0 rounded border border-rule p-2 text-ink-soft hover:bg-sunk hover:text-ink ${toggleHiddenAt}`}
            >
              <Menu size={16} aria-hidden="true" />
            </button>
            <Breadcrumb trail={trail} />
          </div>
          <div className="flex shrink-0 items-center gap-2">
            {presentable ? (
              <Link
                to={`/d/${id}/present`}
                className="flex shrink-0 items-center gap-1.5 rounded border border-rule px-3 py-1 text-sm text-ink-soft hover:bg-sunk hover:text-ink"
              >
                <Presentation size={14} aria-hidden="true" />
                Presentar
              </Link>
            ) : null}
            <ThemeToggle />
          </div>
        </div>
        <article ref={article} className="prose measured-prose mx-auto max-w-3xl">
          {/* The same spine the rail and the drawer draw from, handed down so a
              question can check the section it claims to belong to (#139). One
              measurement, three consumers — a second reading of the DOM could
              disagree with the navigation about what a section is. */}
          <KnownSectionsProvider value={sectionIds}>
            <Suspense fallback={null}>
              <Doc />
            </Suspense>
          </KnownSectionsProvider>
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
