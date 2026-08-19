import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import mermaid from 'mermaid';

/**
 * L4 — every `<Mermaid>` diagram a published document authors actually parses.
 *
 * `<Mermaid>` paints in a real browser only: jsdom cannot run the layout
 * pipeline (ADR-0040 §Consequences), and `contentRenders.test.tsx` therefore
 * stubs the library — which means a diagram whose SYNTAX is broken keeps
 * every suite green and ships as an authoring banner on the page. The parser
 * is the one half of the library jsdom can run, so it is gated here against
 * the real one: a malformed diagram fails the suite, the paint itself remains
 * the browser check's job.
 *
 * Only the template-literal form is read — `source={`…`}` is the documented
 * authoring surface (ADR-0040 §Decision-4). A source authored any other way
 * still renders, but the parser gate cannot see it; that form does not exist
 * in the tree today.
 */
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

function diagramSources(): { file: string; source: string }[] {
  const found: { file: string; source: string }[] = [];
  for (const key of Object.keys(import.meta.glob('@content/courses/**/*.mdx'))) {
    const text = readFileSync(join(APP_ROOT, key), 'utf8');
    for (const match of text.matchAll(/<Mermaid\b[\s\S]*?source=\{`([\s\S]*?)`\}/g)) {
      const source = match[1] ?? '';
      if (source.trim() !== '') found.push({ file: key, source });
    }
  }
  return found;
}

describe('architecture: every authored Mermaid diagram parses', () => {
  it('finds diagrams to check (guards against a vacuous scan)', () => {
    expect(
      diagramSources().length,
      'no <Mermaid source={…}> found in content/ — the parser gate covers nothing. If the authoring surface moved, repoint this reader.',
    ).toBeGreaterThan(0);
  });

  it.each(diagramSources())('%s parses', async ({ file, source }) => {
    // mermaid.parse rejects on malformed source — the same parser render()
    // runs before the layout pipeline. No SVG paint involved, so jsdom is
    // enough here.
    await expect(
      mermaid.parse(source),
      `${file}: the diagram's syntax was rejected by mermaid`,
    ).resolves.toBeTruthy();
  });
});
