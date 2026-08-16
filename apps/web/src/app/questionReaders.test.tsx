import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { render } from '@testing-library/react';
import type { ComponentType, ReactNode } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { beforeAll, describe, expect, it } from 'vitest';

import { registry } from '../content';
import { readQuestions } from '../content/questionSource';
import { withMeta } from '../lib/componentMeta';
import { parseQuestions } from '../lib/questions';

import { mdxComponents } from './mdxComponents';

/**
 * L4 — the two readers of a question must agree, on every published document.
 *
 * The design runs two independent readers over the same authored question, on
 * purpose: `lib/questions.ts` walks the RENDERED tree so the page can draw
 * nodes, and `content/questionSource.ts` walks the MDX SOURCE so the gates and
 * the printed control get what the author typed. Each had its own hand-built
 * fixtures and nothing compared them, which meant every divergence was
 * invisible — the page could show one thing and the graded sheet another.
 *
 * Four divergences were found by the review that prompted this file, and they
 * are the reason it is worth its cost:
 *
 *   - A `<Question>` whose attributes wrap over several lines, or whose `id` is
 *     missing, or whose attributes use single quotes: the source reader DROPS
 *     the question entirely while the page renders it normally. A student
 *     studies a question that is not in the bank the control draws from.
 *   - A statement or alternative hard-wrapped onto a second line: truncated in
 *     the artifact, whole on the page.
 *   - A question opening with a JSX line: raw JSX becomes the artifact's stem.
 *   - **Blank lines BETWEEN alternatives**, which make markdown emit a "loose"
 *     list wrapping each item in a `<p>`. The rendered reader looks at direct
 *     children for the checkbox, so EVERY alternative reads as incorrect: the
 *     student marks the right answer and the page answers "Incorrecto". The
 *     artifact is perfectly correct. That one is student-facing, and no gate in
 *     the repo could see it.
 *
 * Page-level, and therefore here rather than in `content/`: a document body may
 * use any shell-registered component, and those resolve only through the
 * shell's MDX map. With a feature-local map every marker would be an unknown
 * tag and this would pass vacuously.
 */

const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const sources = new Map<string, string>();
const trees = new Map<string, ReactNode>();

beforeAll(async () => {
  for (const key of Object.keys(import.meta.glob('@content/courses/**/*.mdx'))) {
    const source = readFileSync(join(APP_ROOT, key), 'utf8');
    const id = /^id:\s*(\S+)/m.exec(source)?.[1];
    if (id) sources.set(id, source);
  }
  for (const entry of registry.entries) {
    const module = (await entry.load()) as {
      default: ComponentType<{ components?: Record<string, unknown> }>;
    };
    const Doc = module.default;

    // The block hands over its subtree instead of drawing it. MDXContent calls
    // hooks, so it cannot be invoked as a plain function to get the tree; and
    // reading the questions back out of the DOM would mean asserting
    // correctness through a Tailwind class, which couples the gate to styling.
    // Capturing the ELEMENT TREE is the third way: the questions inside are
    // never mounted, so this costs a render of the prose and nothing more.
    let captured: ReactNode = null;
    const Capture = withMeta(
      function Questions({ children }: { children?: ReactNode }) {
        captured = children;
        return null;
      },
      { questionRole: 'group' },
    );

    const { unmount } = render(
      <MemoryRouter>
        <Doc components={{ ...mdxComponents, Questions: Capture }} />
      </MemoryRouter>,
    );
    trees.set(entry.meta.id, captured);
    unmount();
  }
});

/**
 * Comparable form of a question's text.
 *
 * The source keeps markdown (`` `Scanner` ``); the page yields plain text. So
 * the markers go, and whitespace collapses — which is also what makes a WRAPPED
 * line comparable, while still leaving a TRUNCATED one different by a whole
 * clause.
 */
function normalise(text: string): string {
  return text.replace(/[`*_]/g, '').replace(/\s+/g, ' ').trim();
}

describe('the source reader and the rendered reader agree', () => {
  it('finds documents carrying questions', () => {
    const withQuestions = [...sources.values()].filter((s) => readQuestions(s).length > 0);
    expect(
      withQuestions.length,
      'no document carries a question, so every case below is vacuous — if the bank really moved, retire this file',
    ).toBeGreaterThan(0);
  });

  it.each([...registry.entries.map((entry) => entry.meta.id)])('%s', (id) => {
    const source = sources.get(id);
    const tree = trees.get(id);
    expect(source, `no source found for ${id}`).toBeDefined();

    const authored = readQuestions(source!);
    const rendered = parseQuestions(tree);

    expect(
      rendered.map((q) => q.id),
      `${id}: the page and the source disagree about WHICH questions exist. A question the source reader drops (multi-line attributes, a missing id, single quotes) still renders, so the reader studies a question the printed control cannot contain.`,
    ).toEqual(authored.map((q) => q.id));

    for (const [index, question] of authored.entries()) {
      const shown = rendered[index];
      expect(normalise(shown?.statement ?? ''), `${id} / ${question.id}: statement`).toBe(
        normalise(question.statement),
      );
      expect(
        shown?.alternatives.map((a) => normalise(a.text)),
        `${id} / ${question.id}: alternatives`,
      ).toEqual(question.alternatives.map((a) => normalise(a.text)));
      expect(
        shown?.alternatives.flatMap((a, i) => (a.correct ? [i] : [])),
        `${id} / ${question.id}: which alternatives are correct. If the page says none are, the alternatives were probably written with blank lines between them — that makes a "loose" list and hides the checkbox one level down, so a student marking the right answer is told they are wrong.`,
      ).toEqual(question.alternatives.flatMap((a, i) => (a.correct ? [i] : [])));
    }
  });
});
