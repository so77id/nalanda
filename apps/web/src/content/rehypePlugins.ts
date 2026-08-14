import rehypeKatex from 'rehype-katex';
import type { PluggableList } from 'unified';

/**
 * The rehype plugins every course document is compiled with.
 *
 * Separate from the remark list because remark and rehype are different trees:
 * remark plugins see markdown, rehype plugins see the HTML it became. Math
 * needs one of each — `remarkMath` to parse `$$…$$` at all, `rehypeKatex` to
 * turn the node it produced into something a reader can see.
 *
 * Exported rather than written inline in `vite.config.ts` so `mdxPipeline.test.tsx`
 * can render through the *same* list the build uses. (`mdxWiring.test.ts` does not
 * need this — it resolves the config object and calls the real transform.)
 */
export const rehypePlugins: PluggableList = [
  /**
   * Runs in Node during the Vite transform, so no KaTeX JavaScript ever reaches
   * a browser. Cost and the rejected alternatives: ADR-0027 §1, §3, §5.
   *
   * `trust: false` is KaTeX's default and is stated here because it is the one
   * option whose flip is a direct injection: with `trust: true`, `\href`,
   * `\url` and the `\html*` family emit real attributes from author-controlled
   * LaTeX — verified, `\href{javascript:…}` becomes a live anchor. Enabling it,
   * or adding `macros` that reach those commands, needs a security review.
   * Pinned by a test rather than left to this comment.
   */
  [rehypeKatex, { trust: false }],
];
