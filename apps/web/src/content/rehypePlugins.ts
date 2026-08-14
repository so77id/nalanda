import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';

/**
 * The rehype plugins every course document is compiled with.
 *
 * A sibling of `mdxPlugins.ts` and extracted for the same reason: a test
 * compiles MDX through the *same* list the build uses, instead of reading
 * `vite.config.ts` as text and searching for a name. That distinction is not
 * theoretical — `mdxWiring.test.ts` exists because a text-matching guard stayed
 * green while the build silently stopped applying GFM (#83).
 *
 * Separate from the remark list because remark and rehype are different trees:
 * remark plugins see markdown, rehype plugins see the HTML it became. Math
 * needs one of each — `remarkMath` to parse `$…$` at all, `rehypeKatex` to turn
 * the node it produced into something a reader can see.
 */
export const rehypePlugins: PluggableList = [
  /**
   * Renders every math node at BUILD time, in Node, during the Vite transform.
   *
   * That is the whole cost story of #118 and the reason this is cheap where the
   * code editor is not: KaTeX is a build input and none of its JavaScript is
   * ever sent to a browser. A page with mathematics pays 3.6 kB gzip of CSS
   * plus the woff2 faces its own glyphs reference (~42 kB for a typical
   * formula), against ~162 kB gzip of CodeMirror for the first highlighted
   * fence on a page (ADR-0018).
   *
   * `throwOnError` stays at its default `false`: a malformed formula renders in
   * KaTeX's error colour and the document still builds. Failing the build was
   * considered and rejected — the content gate already refuses documents for
   * structural faults, and a typo inside a formula is authoring feedback, not a
   * broken document. It matches how a broken wiki-link behaves, which renders
   * visibly wrong on purpose (ADR-0002).
   */
  rehypeKatex,
];
