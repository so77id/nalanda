import { MDXProvider } from '@mdx-js/react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { CatalogOverviewPage, ComponentPage, FamilyPage, GovernancePage } from '../catalog';
import { DocumentPage, courseIndex, walkIndex } from '../content';
import { PresentableSectionsWrapper, PresentationPage } from '../presentation';
import { DocumentTitle } from './DocumentTitle';
import { NotFound } from './NotFound';
import { mdxComponents } from './mdxComponents';

// Landing convention (issue #63): "/" goes to the first stop of the recorrido —
// by convention the course welcome document.
const firstDocId = walkIndex(courseIndex)[0];

/** Route table, router-free so tests can mount it inside a MemoryRouter. */
export function AppRoutes() {
  return (
    <MDXProvider components={mdxComponents}>
      <DocumentTitle />
      <Routes>
        <Route
          path="/"
          element={firstDocId ? <Navigate to={`/d/${firstDocId}`} replace /> : <NotFound />}
        />
        <Route
          path="/d/:id"
          element={
            <DocumentPage
              notFound={<NotFound />}
              presentableSectionsWrapper={PresentableSectionsWrapper}
            />
          }
        />
        <Route path="/d/:id/present" element={<PresentationPage notFound={<NotFound />} />} />
        {/* A layout route with NO Suspense boundary of its own, deliberately.
            The entries arrive as a promise now (#122) and every page under here
            reads it with `use()`, so the obvious move is a boundary — this WP
            shipped one with `fallback={null}` and the review measured what it
            actually bought: /catalog went from 60ms to ~375ms to first paint,
            and roughly 310ms of that is React's fixed FALLBACK_THROTTLE_MS
            holding the reveal once a fallback has committed, not the download
            (the chunk lands at ~45ms). Worse, on a client-side navigation the
            fallback blanked the page the reader was still looking at. Without
            it React keeps the outgoing page up and reveals this one when the
            entries land, which is both faster and what a reader wants. Add a
            boundary here only with a fallback worth showing, and measure it. */}
        <Route path="/catalog" element={<Outlet />}>
          <Route index element={<CatalogOverviewPage />} />
          <Route path="governance" element={<GovernancePage />} />
          <Route path="c/:name" element={<ComponentPage notFound={<NotFound />} />} />
          <Route path=":family" element={<FamilyPage notFound={<NotFound />} />} />
        </Route>
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MDXProvider>
  );
}
