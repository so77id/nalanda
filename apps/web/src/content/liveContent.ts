import { parseCourseIndex } from './courseIndex';
import { buildRegistry } from './registry';

// Metadata comes from ?frontmatter virtual modules (served by the
// contentIntegrity plugin) so the eager glob never imports the compiled MDX —
// that static import would drag every document body into the entry chunk and
// defeat the lazy component glob below.
const metaModules = import.meta.glob('@content/courses/**/*.mdx', {
  eager: true,
  query: '?frontmatter',
  import: 'default',
});

/** The live registry over the real content/ tree. */
export const registry = buildRegistry(metaModules, import.meta.glob('@content/courses/**/*.mdx'));

const rawIndexes = import.meta.glob('@content/courses/*/index.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const found = Object.entries(rawIndexes);
if (found.length !== 1) {
  throw new Error(
    `Course index: expected exactly one content/courses/*/index.yaml (v0.1 is single-course), found ${found.length}`,
  );
}

/** The live index of the single v0.1 course. */
export const courseIndex = parseCourseIndex(found[0]![1] as string, found[0]![0]);
