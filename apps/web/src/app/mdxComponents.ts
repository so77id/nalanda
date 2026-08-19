import {
  Figure,
  LazyCodeEditor,
  LazyExercise,
  LazyMemoryDiagram,
  LazyMermaid,
  LazyPredictOutput,
  MdxPre,
  Mosaic,
  Question,
  Questions,
  RecursionTree,
  SectionBreak,
  SheetEmbed,
  SideBySide,
  Slide,
  Split,
} from '../components';
import { contentMdxComponents } from '../content';

/**
 * The full MDX components map — shell-composed so features stay decoupled
 * (content maps its elements; catalog components register here). Documents
 * use structural components without imports (ADR-0003 / ADR-0010).
 */
export const mdxComponents = {
  ...contentMdxComponents,
  // Every fence in a language the platform runs becomes the read-only editor.
  // Registered HERE and not in `content/`: the mapping needs the editor, and
  // `content → components` is not an allowed edge — composing the map in the
  // shell is the seam that already exists for exactly this (ADR-0003/0010).
  pre: MdxPre,
  Slide,
  SectionBreak,
  SideBySide,
  Split,
  Mosaic,
  Figure,
  // Not lazy: it is one iframe. Measured on the shipped build, registering it
  // eagerly costs the entry chunk 1,463 bytes of component code, and it pulls in
  // no package the first paint did not already need. (That figure used to be
  // quoted as +5.6kB raw, the rest being its catalog prose, which travelled
  // eagerly for every component, lazy or not. #122 moved the entries behind a
  // dynamic import, so the prose no longer ships here — only the component code
  // does.)
  //
  // Do NOT read that as "the sheet is free until someone scrolls to it": the
  // frame carries `loading="lazy"`, and lazy on an iframe was measured to defer
  // nothing until roughly 4000px below the fold in Chromium. On both pages that
  // ship one today the frame is above that, so Google's ~570kB first-visit
  // weight lands with the page. The attribute stays because it costs nothing
  // and pays off the day a frame sits at the foot of a long document.
  SheetEmbed,
  // The lazy wrapper, not the editor itself: this map is evaluated eagerly, and
  // registering the real component would put CodeMirror in the entry chunk.
  CodeEditor: LazyCodeEditor,
  Exercise: LazyExercise,
  MemoryDiagram: LazyMemoryDiagram,
  PredictOutput: LazyPredictOutput,
  // Same lazy rule, for the same entry-chunk reason (ADR-0040): the mermaid
  // library weighs ~600kB gzipped and must only load on pages that mount a
  // diagram.
  Mermaid: LazyMermaid,
  // Not lazy: a question renders text and buttons. The editor it may embed is
  // itself lazy, so a document with no code question pulls no CodeMirror.
  Questions,
  Question,
  // Not lazy: draws a small SVG-free tree with lucide chevrons and inline
  // styles for the per-argument hue (theme-aware via useResolvedTheme, no raw
  // Tailwind colour class — design-system.md §Adding a token would be the
  // alternative and buys nothing scoped to one component). No CodeMirror, no
  // runtime seam: the eager-graph walk in architecture.test.ts stays happy.
  RecursionTree,
};
