import { BrowserRouter } from 'react-router-dom';

import { AppRoutes } from './AppRoutes';
import { routerBasename } from './basename';

export function App() {
  return (
    <BrowserRouter basename={routerBasename(import.meta.env.BASE_URL)}>
      <AppRoutes />
    </BrowserRouter>
  );
}
