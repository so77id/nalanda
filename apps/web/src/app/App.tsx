import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { DocumentPage, courseIndex, walkIndex } from '../content';
import { NotFound } from './NotFound';

// Landing convention (issue #63): "/" goes to the first stop of the recorrido —
// by convention the course welcome document.
const firstDocId = walkIndex(courseIndex)[0];

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={firstDocId ? <Navigate to={`/d/${firstDocId}`} replace /> : <NotFound />}
      />
      <Route path="/d/:id" element={<DocumentPage notFound={<NotFound />} />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  );
}
