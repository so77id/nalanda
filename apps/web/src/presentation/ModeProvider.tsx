import type { ReactNode } from 'react';

import { ModeContext } from './mode';
import type { Mode } from './mode';

interface Props {
  mode: Mode;
  children: ReactNode;
}

/** Set by the route (/d/:id → book, /d/:id/present → presentation), never by props drilling. */
export function ModeProvider({ mode, children }: Props) {
  return <ModeContext.Provider value={mode}>{children}</ModeContext.Provider>;
}
