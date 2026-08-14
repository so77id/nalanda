import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkMdxFrontmatter from 'remark-mdx-frontmatter';
import type { PluggableList } from 'unified';

import { remarkCodeMeta } from './codeMeta.ts';
import { remarkContentImages } from './contentImages.ts';
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
  // `$$…$$` becomes a math node rather than literal dollars. Parsing only:
  // what renders it is `rehypeKatex`, one file over — either without the other
  // renders nothing, which is why both are pinned at both levels.
  //
  // `singleDollarTextMath: false` prevents prose about prices from parsing as a
  // formula ("Cuesta $200 al mes, el otro $350"). Why that beats documenting a
  // `\$` escape, and what a single-dollar formula does instead: ADR-0027 §2.
  [remarkMath, { singleDollarTextMath: false }],
  remarkWikiLinks,
  // Reads the document's path off the vfile, so it must run over a tree that
  // still knows which file it came from — every remark plugin does, but it is
  // the only one here that depends on it.
  remarkContentImages,
  remarkCodeMeta,
];
