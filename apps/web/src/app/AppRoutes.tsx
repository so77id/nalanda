import { MDXProvider } from '@mdx-js/react';
import { Navigate, Route, Routes } from 'react-router-dom';

import { CatalogOverviewPage, ComponentPage, FamilyPage } from '../catalog';
import { DocumentPage, courseIndex, walkIndex } from '../content';
import { PresentationPage } from '../presentation';
import { NotFound } from './NotFound';
import { mdxComponents } from './mdxComponents';

// Landing convention (issue #63): "/" goes to the first stop of the recorrido —
// by convention the course welcome document.
const firstDocId = walkIndex(courseIndex)[0];

/** Route table, router-free so tests can mount it inside a MemoryRouter. */
export function AppRoutes() {
  return (
    <MDXProvider components={mdxComponents}>
      <Routes>
        <Route
          path="/"
          element={firstDocId ? <Navigate to={`/d/${firstDocId}`} replace /> : <NotFound />}
        />
        <Route path="/d/:id" element={<DocumentPage notFound={<NotFound />} />} />
        <Route path="/d/:id/present" element={<PresentationPage notFound={<NotFound />} />} />
        <Route path="/catalog" element={<CatalogOverviewPage />} />
        <Route path="/catalog/c/:name" element={<ComponentPage notFound={<NotFound />} />} />
        <Route path="/catalog/:family" element={<FamilyPage notFound={<NotFound />} />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </MDXProvider>
  );
}
