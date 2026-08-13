import { createContext, useContext } from 'react';

/**
 * Whether what renders here is already inside a frame that labels it.
 *
 * `<SideBySide>` gives each column a border and a language label, and used to
 * flatten the bare `<pre>` inside it with `[&_pre]:border-0`. Once a fence is a
 * component that selector describes nothing, and the column ends up with two
 * stacked headers and two rounded borders (#85).
 *
 * A context rather than a prop because the content is authored as markdown: a
 * column receives whatever the fence became, and cannot pass it anything.
 * Same shape as `ModeProvider` — the container states the situation, and the
 * component decides what to do about it.
 */
const EmbeddedContext = createContext(false);

export const EmbeddedProvider = EmbeddedContext.Provider;

/** True when a container already provides the frame and the label. */
export function useEmbedded(): boolean {
  return useContext(EmbeddedContext);
}
