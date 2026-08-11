import { LazyCodeEditor, SectionBreak, Slide } from '../components';
import { contentMdxComponents } from '../content';

/**
 * The full MDX components map — shell-composed so features stay decoupled
 * (content maps its elements; catalog components register here). Documents
 * use structural components without imports (ADR-0003 / ADR-0010).
 */
export const mdxComponents = {
  ...contentMdxComponents,
  Slide,
  SectionBreak,
  // The lazy wrapper, not the editor itself: this map is evaluated eagerly, and
  // registering the real component would put CodeMirror in the entry chunk.
  CodeEditor: LazyCodeEditor,
};
