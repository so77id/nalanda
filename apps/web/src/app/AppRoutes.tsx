import { MDXProvider } from '@mdx-js/react';
import { Suspense } from 'react';
import { Navigate, Outlet, Route, Routes } from 'react-router-dom';

import { CatalogOverviewPage, ComponentPage, FamilyPage, GovernancePage } from '../catalog';
import { DocumentPage, courseIndex, walkIndex } from '../content';
import { PresentationPage } from '../presentation';
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
        <Route path="/d/:id" element={<DocumentPage notFound={<NotFound />} />} />
        <Route path="/d/:id/present" element={<PresentationPage notFound={<NotFound />} />} />
        {/* One boundary for the whole catalog rather than one per page: the
            entries arrive as a promise now (#122), and every page under here
            reads it. `null` while it lands — the chunk is small and local, and a
            spinner for one frame reads as a fault rather than as progress. */}
        <Route
          path="/catalog"
          element={
            <Suspense fallback={null}>
              <Outlet />
            </Suspense>
          }
        >
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
