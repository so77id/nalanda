import { createContext } from 'react';

/** How a document is being rendered right now (D15 dual rendering). */
export type Mode = 'book' | 'presentation';

/** Shared by ModeProvider and useMode — not exported from the feature seam. */
export const ModeContext = createContext<Mode>('book');
