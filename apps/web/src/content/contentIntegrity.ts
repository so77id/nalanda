import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

// Extension-qualified imports: this file is also compiled under tsconfig.node
// (nodenext) because vite.config.ts imports it.
import { parseCourseIndex, walkIndex } from './courseIndex.ts';
import { parseDocumentMeta, parseFrontmatterBlock } from './documentMeta.ts';

function walkDir(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walkDir(full) : [full];
  });
}

/**
 * Fails `vite build` (and dev-server startup) when content/ breaks the content
 * contract: invalid or duplicate frontmatter ids, invalid index.yaml, or index
 * entries pointing at unknown documents. Needed because the registry's runtime
 * checks live in module evaluation, which `vite build` never executes —
 * without this plugin a duplicate id ships and white-screens at load (AC2).
 */
const FRONTMATTER_SUFFIX = '?frontmatter';
const VIRTUAL_PREFIX = '\0frontmatter:';

export function contentIntegrity(contentDir: string): Plugin {
  return {
    name: 'nalanda:content-integrity',
    enforce: 'pre',
    // `*.mdx?frontmatter` resolves to a virtual module carrying ONLY the parsed
    // frontmatter, so the registry's eager metadata glob never imports the
    // compiled document — that static import would defeat code-splitting.
    async resolveId(source, importer) {
      if (!source.endsWith(FRONTMATTER_SUFFIX)) return null;
      const resolved = await this.resolve(source.slice(0, -FRONTMATTER_SUFFIX.length), importer, {
        skipSelf: true,
      });
      return resolved ? VIRTUAL_PREFIX + resolved.id : null;
    },
    load(id) {
      if (!id.startsWith(VIRTUAL_PREFIX)) return null;
      const file = id.slice(VIRTUAL_PREFIX.length);
      this.addWatchFile(file);
      const meta = parseDocumentMeta(file, parseFrontmatterBlock(readFileSync(file, 'utf8')));
      return `export default ${JSON.stringify(meta)};`;
    },
    buildStart() {
      const files = walkDir(contentDir);
      const idToFile = new Map<string, string>();
      for (const file of files.filter((f) => f.endsWith('.mdx'))) {
        const meta = parseDocumentMeta(file, parseFrontmatterBlock(readFileSync(file, 'utf8')));
        const existing = idToFile.get(meta.id);
        if (existing) {
          throw new Error(
            `Content registry: duplicate document id "${meta.id}" in ${existing} and ${file}`,
          );
        }
        idToFile.set(meta.id, file);
      }
      for (const file of files.filter((f) => f.endsWith('index.yaml'))) {
        const index = parseCourseIndex(readFileSync(file, 'utf8'), file);
        for (const id of walkIndex(index)) {
          if (!idToFile.has(id)) {
            throw new Error(`Course index (${file}): references unknown document id "${id}"`);
          }
        }
      }
    },
  };
}
