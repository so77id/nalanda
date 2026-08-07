import { useContext } from 'react';

import { ModeContext } from './mode';
import type { Mode } from './mode';

/** Current rendering mode; defaults to book outside any provider. */
export function useMode(): Mode {
  return useContext(ModeContext);
}
