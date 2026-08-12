import type { Code, Root } from 'mdast';
import { visit } from 'unist-util-visit';

/**
 * Remark plugin: preserves a fence's info-string meta as a `data-meta` attribute.
 *
 * A fence opened as ```` ```java starter ```` parses with `lang: 'java'` and
 * `meta: 'starter'`, and the default mdast→hast conversion keeps the language
 * (as `language-java`) while dropping the meta entirely. A component that needs
 * to tell one fence from another — an exercise's starter code from its test
 * cases — would have nothing left to read.
 *
 * Fences without meta are left alone, so nothing already written changes shape.
 */
export function remarkCodeMeta() {
  return (tree: Root): void => {
    visit(tree, 'code', (node: Code) => {
      const meta = node.meta?.trim();
      if (!meta) return;
      const data = (node.data ??= {});
      // mdast-util-to-hast applies hProperties to the <code> element itself,
      // inside the <pre> it wraps it in.
      data.hProperties = { ...data.hProperties, 'data-meta': meta };
    });
  };
}
