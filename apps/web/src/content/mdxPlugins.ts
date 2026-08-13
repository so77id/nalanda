import remarkFrontmatter from 'remark-frontmatter';
import remarkGfm from 'remark-gfm';
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
 * mistake it for content, and `remarkGfm` comes next because it is a *syntax*
 * extension — it changes what the parser recognises at all — while the two
 * below it walk the tree that parsing produced.
 */
export const remarkPlugins: PluggableList = [
  remarkFrontmatter,
  [remarkMdxFrontmatter, { name: 'frontmatter' }],
  // MDX parses CommonMark, which has no tables. Without this, a markdown table
  // is one paragraph of literal `|` characters — as four tables of reference
  // material in the published Java document were (#83).
  remarkGfm,
  remarkWikiLinks,
  remarkCodeMeta,
];
