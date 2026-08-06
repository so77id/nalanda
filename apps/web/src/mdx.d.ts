declare module '*.mdx' {
  import type { ComponentType } from 'react';

  /** YAML frontmatter exported by remark-mdx-frontmatter; validated by the content registry. */
  export const frontmatter: Record<string, unknown>;

  const MDXContent: ComponentType<Record<string, unknown>>;
  export default MDXContent;
}
