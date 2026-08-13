import { evaluate } from '@mdx-js/mdx';
import { render } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MemoryRouter } from 'react-router-dom';
import * as runtime from 'react/jsx-runtime';
import { describe, expect, it, vi } from 'vitest';

import { remarkPlugins } from '../content';

import { mdxComponents } from './mdxComponents';

// The editor is not what is under test here — which renderer a fence reaches is.
vi.mock('@uiw/react-codemirror', () => ({
  default: ({ value }: { value: string }) => <textarea readOnly value={value} data-testid="code" />,
}));

// L4-ish: this binds the content feature to the shell. The `pre` mapping lives
// in the shell's map (a feature may not import `components/`), so only a test
// that uses THAT map can say what a document's fences actually become.
async function renderThroughTheShellMap(source: string): Promise<HTMLElement> {
  const { default: Content } = await evaluate(source, { ...runtime, remarkPlugins });
  return render(
    <MemoryRouter>
      <Content components={mdxComponents} />
    </MemoryRouter>,
  ).container;
}

// vitest runs with apps/web as its cwd.
const DOCUMENT = readFileSync(
  join(process.cwd(), '../../content/courses/sample-course/06-java-desde-cpp.mdx'),
  'utf8',
);

/** Every fence in the document, as `[info-string, body]`. */
function fencesOf(markdown: string): { info: string; body: string }[] {
  const found: { info: string; body: string }[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = /^```(.*)$/.exec(lines[i] ?? '');
    if (!open) continue;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length && !/^```\s*$/.test(lines[j] ?? ''); j++) body.push(lines[j] ?? '');
    found.push({ info: (open[1] ?? '').trim(), body: body.join('\n') });
    i = j;
  }
  return found;
}

describe('the fences of the shipped Java document', () => {
  const fences = fencesOf(DOCUMENT);
  const untagged = fences.filter((f) => f.info === '');

  it('found fences at all (guards against a vacuous check)', () => {
    expect(fences.length).toBeGreaterThan(5);
  });

  it('the document really does carry language-less fences', () => {
    // Two ASCII diagrams. If this ever changes, the cases below are measuring
    // nothing and should be re-pointed rather than deleted.
    expect(untagged).toHaveLength(2);
    expect(untagged.every((f) => f.body.includes('→'))).toBe(true);
  });

  it('leaves an ASCII diagram as a plain pre, loading no editor', async () => {
    const container = await renderThroughTheShellMap('```\n' + untagged[0]!.body + '\n```\n');

    const pre = container.querySelector('pre');
    expect(pre, 'the diagram stopped being a pre').not.toBeNull();
    expect(pre?.textContent).toContain('[g++]');
    expect(container.querySelector('[data-testid="code"]')).toBeNull();
  });

  it('turns a Java fence from the same document into the editor', async () => {
    const java = fences.find((f) => f.info === 'java');
    expect(java, 'no plain java fence in the document').toBeDefined();

    const container = await renderThroughTheShellMap('```java\n' + java!.body + '\n```\n');

    // Awaited: the editor is lazy, the diagram above is not.
    await vi.waitFor(() => expect(container.querySelector('.cm-editor, textarea')).not.toBeNull());
    expect(container.querySelector('pre')).toBeNull();
  });

  it('leaves a fence in a language the platform cannot run alone', async () => {
    const container = await renderThroughTheShellMap('```bash\nnpm run build\n```\n');

    expect(container.querySelector('pre')?.textContent).toContain('npm run build');
  });
});

// The sharp edge of the whole WP. `fencesByMeta` / `withoutFences` identify an
// exercise's fences by the literal `code` intrinsic type, so mapping `code`
// instead of `pre` would leave every <Exercise> unable to find its own body — it
// renders the amber authoring banner where the exercise should be. Nothing else
// in the suite compiles a document through the shell map, so nothing else can
// see this.
describe('the pre-not-code rule that keeps Exercise working', () => {
  const exercises = DOCUMENT.split('<Exercise').length - 1;

  it('the document really ships exercises (guards against a vacuous check)', () => {
    expect(exercises).toBeGreaterThan(0);
  });

  it('maps the wrapper, never the fence itself', () => {
    const map: Record<string, unknown> = mdxComponents;
    expect(map['pre'], 'the fence mapping disappeared').toBeDefined();
    expect(map['code'], 'mapping `code` breaks every Exercise').toBeUndefined();
  });

  it('lets an exercise find its starter and hide its cases, through the shell map', async () => {
    const source = [
      '<Exercise title="¿Es par?">',
      '',
      'Escribe `esPar`.',
      '',
      '```java starter',
      'class Solution {}',
      '```',
      '',
      '```java test',
      'check(Solution.esPar(4), true);',
      '```',
      '',
      '</Exercise>',
      '',
    ].join('\n');

    const container = await renderThroughTheShellMap(source);

    await vi.waitFor(() => expect(container.textContent).toContain('Escribe'));
    // The amber banner is what a broken fence lookup produces.
    expect(container.textContent, 'the exercise rendered as an authoring error').not.toContain(
      'espera',
    );
    // And the cases stay hidden until the student runs (ADR-0019).
    expect(container.textContent).not.toContain('check(Solution.esPar(4)');
  });
});
