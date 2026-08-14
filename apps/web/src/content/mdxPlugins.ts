import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { PluggableList } from 'unified';

import { remarkCodeMeta } from './codeMeta.ts';
import { remarkWikiLinks } from './wikiLinks.ts';

/**
 * The remark plugins every course document is compiled with.
 *
 * Extracted from `vite.config.ts` so a test can compile MDX through the *same*
 * list the build uses. It lived inline, and the only thing pinning it was a test
 * that read the config file as text and searched for plugin names — which
 * catches a deletion but proves nothing about what the pipeline produces.
 *
 * Order matters: frontmatter is stripped and exported before anything else can
 * mistake it for content, then come the two *syntax* extensions — they change
 * what the parser recognises at all — while the two below them walk the tree
 * that parsing produced.
 *
 * This list is only half the pipeline; `rehypePlugins.ts` holds the other half,
 * and both are handed to `@mdx-js/rollup` together.
 */
export const remarkPlugins: PluggableList = [
  remarkFrontmatter,
  [remarkMdxFrontmatter, { name: 'frontmatter' }],
  // MDX parses CommonMark, which has no tables. Without this, a markdown table
  // is one paragraph of literal `|` characters — as four tables of reference
  // material in the published Java document were (#83).
  remarkGfm,
  // `$$…$$` becomes a math node rather than literal dollars — inline on one
  // line, display when the delimiters sit on their own lines like a code fence.
  // Parsing only: what turns a math node into something readable is
  // `rehypeKatex`, one file over. Either without the other renders nothing.
  //
  // `singleDollarTextMath: false` is the whole point of the option and was
  // decided, not defaulted. With single dollars enabled — the usual LaTeX
  // convention — a paragraph of ordinary prose can silently become mathematics:
  // "Cuesta $200 al mes, el otro $350" reads as a formula delimited by those two
  // dollars, and renders as one. Measured, not feared. The opening class has
  // exactly that sentence on its cloud-cost slide.
  //
  // The trade is real but asymmetric. Requiring `$$` means a formula copied
  // from elsewhere with single dollars does not render — but the author was
  // writing mathematics, sees plain text, and fixes it. The default breaks
  // documents whose author never opted into mathematics at all.
  [remarkMath, { singleDollarTextMath: false }],
  remarkWikiLinks,
  remarkCodeMeta,
];
