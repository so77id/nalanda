import type { Link, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

// [[id]] or [[id|custom text]] — id and text may not contain brackets or pipes.
const WIKI_LINK = /\[\[([^[\]|]+)(?:\|([^[\]|]+))?\]\]/g;

function wikiLink(id: string, label: string): Link {
  return { type: 'link', url: `wiki:${id}`, children: [{ type: 'text', value: label }] };
}

/**
 * Remark plugin: rewrites [[id]] / [[id|text]] into link nodes with a wiki: url.
 * Purely syntactic — resolution against the registry happens at render time
 * (MdxLink), so the plugin needs no knowledge of the content tree.
 */
export function remarkWikiLinks() {
  return (tree: Root): void => {
    visit(tree, 'text', (node: Text, index, parent) => {
      if (!parent || index === undefined || parent.type === 'link') return;

      const value = node.value;
      const replacements: (Text | Link)[] = [];
      let last = 0;
      for (const match of value.matchAll(WIKI_LINK)) {
        const [raw, id, label] = match;
        if (id === undefined) continue;
        if (match.index > last) {
          replacements.push({ type: 'text', value: value.slice(last, match.index) });
        }
        replacements.push(wikiLink(id.trim(), (label ?? id).trim()));
        last = match.index + raw.length;
      }
      if (replacements.length === 0) return;
      if (last < value.length) {
        replacements.push({ type: 'text', value: value.slice(last) });
      }
      parent.children.splice(index, 1, ...replacements);
      return index + replacements.length;
    });
  };
}
