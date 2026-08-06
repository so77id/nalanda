import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';

import { DocumentPage, registry } from '../content';
import { NotFound } from './NotFound';

// Landing convention (issue #63): "/" goes to the first stop of the recorrido.
// Until the course index lands (S5), the first registry entry stands in for it.
const firstDoc = registry.entries[0];

export function AppRoutes() {
  return (
    <Routes>
      <Route
        path="/"
        element={firstDoc ? <Navigate to={`/d/${firstDoc.meta.id}`} replace /> : <NotFound />}
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
