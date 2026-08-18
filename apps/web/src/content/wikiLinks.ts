import type { Link, Root, Text } from 'mdast';
import { visit } from 'unist-util-visit';

// [[id]] or [[id|custom text]] — id and text may not contain brackets or pipes.
//
// The label also must not contain any markdown inline syntax that runs before
// this plugin — backticks are the trap. `remark-parse` tokenises `` `null` ``
// as an `inlineCode` node BEFORE the wiki-link transformer visits text nodes,
// so a label like `` Referencias, `null` e igualdad `` reaches this plugin
// split across text/inlineCode/text nodes and the `[[…]]` pattern is never
// matched in any single text node. The link ships as literal brackets on the
// page — invisible to every gate (`architecture.test.ts` only checks that the
// wiki id resolves in the registry, not that the plugin actually rewrote the
// source). Worked cases: #78 review — one instance in `arrays-y-funciones`,
// two in `java-tipos-y-flujo` (07:74, 07:698), all fixed by dropping the
// backticks from the label ("Referencias, null e igualdad" reads plain and
// links correctly). Widening the plugin to reconstruct labels across sibling
// nodes was considered and rejected: this note is the guard, and course
// authors write plain labels.
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
