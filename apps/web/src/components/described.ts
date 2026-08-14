import { createContext, useContext } from 'react';

/**
 * Whether a container already carries the description for everything inside it.
 *
 * `<Mosaic>` names the whole group once — "empresas que usan estructuras de
 * datos a diario" — and its cells go silent, because a screen reader announcing
 * nine brand names in a row tells the listener less than one sentence does.
 *
 * A context rather than a prop for the same reason as `embedded.ts`: a cell is
 * authored as its own element and the container cannot pass it anything. It is
 * also what keeps `<Figure>`'s rule absolute — an empty `alt` is an authoring
 * error everywhere, and the single exception lives in the container that has
 * already spoken.
 */
const DescribedContext = createContext(false);

export const DescribedProvider = DescribedContext.Provider;

/** True when the surrounding container already describes this content. */
export function useDescribed(): boolean {
  return useContext(DescribedContext);
}
