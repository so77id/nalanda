/**
 * The url scheme `remarkContentImages` emits for an image that lives under
 * `content/`, keyed on its path from the content root
 * (`asset:courses/sample-course/curva.svg`). Same shape as `wiki:` links, for
 * the same reason: the remark plugin stays syntactic and resolution happens at
 * render time.
 *
 * **Alone in its own module on purpose.** The plugin needs the constant and the
 * renderer needs the asset map, but the map is built with `import.meta.glob`,
 * which only exists inside Vite's transform — and `vite.config.ts` imports the
 * plugin, so Node evaluates that graph. Sharing one module makes
 * `vite --config` die with `(intermediate value).glob is not a function`, before
 * a single test runs. Same class as the entry-chunk rule in
 * `add-a-content-component.md`: importing a module for one constant drags
 * everything else it touches into a place that cannot run it.
 */
export const ASSET_PREFIX = 'asset:';
