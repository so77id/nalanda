import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';

import { families } from '../catalog';
import { registry } from '../content';
import { routeTitle } from './routeTitle';

/**
 * Keeps `document.title` in step with the route.
 *
 * Rendered once by the shell rather than by each page: the shell is the only
 * place allowed to import from every feature, and a title is a property of the
 * document, not of whatever happens to be inside it. It renders nothing.
 */
export function DocumentTitle() {
  const { pathname } = useLocation();

  useEffect(() => {
    document.title = routeTitle(
      pathname,
      (id) => registry.get(id)?.meta.title,
      (id) => families.find((family) => family.id === id)?.name,
    );
  }, [pathname]);

  return null;
}
