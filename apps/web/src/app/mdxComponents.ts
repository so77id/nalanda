import {
  Figure,
  LazyCodeEditor,
  LazyExercise,
  LazyMemoryDiagram,
  MdxPre,
  Mosaic,
  Question,
  Questions,
  SectionBreak,
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
  // The lazy wrapper, not the editor itself: this map is evaluated eagerly, and
  // registering the real component would put CodeMirror in the entry chunk.
  CodeEditor: LazyCodeEditor,
  Exercise: LazyExercise,
  MemoryDiagram: LazyMemoryDiagram,
  // Not lazy: a question renders text and buttons. The editor it may embed is
  // itself lazy, so a document with no code question pulls no CodeMirror.
  Questions,
  Question,
};
