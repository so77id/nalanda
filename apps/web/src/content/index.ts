// Public seam of the content feature (import direction rule, frontend-code-style.md).
// Exports only what the shell consumes today — grow it when a real consumer appears.
export { DocumentPage } from './DocumentPage';
export { walkIndex } from './courseIndex';
export { courseIndex, registry } from './liveContent';
export { contentMdxComponents } from './mdxComponents';
// How a document is compiled — the content feature's public statement of it.
// `vite.config.ts` reaches the module directly (it lives outside `src/`); a real
// consumer inside `src/` appeared with #85, and it goes through the seam.
export { remarkPlugins } from './mdxPlugins';
export { lazyDocumentComponent } from './lazyDoc';
