// Extension-qualified: this file is also compiled under tsconfig.node
// (nodenext), because vite.config.ts loads the bank emitter, which reads
// questions with this module.
import { slugify } from '../lib/slug.ts';

/**
 * One question as it was AUTHORED, read from the `.mdx` source.
 *
 * The sibling of `lib/questions.ts`, which reads the same question out of the
 * rendered tree for the page. Two readers because they answer different
 * questions: the page needs nodes it can draw, and the gates need what the
 * author typed. The compiled module cannot supply the second — `import.meta.glob`
 * with `?raw` hands back the compiled `MDXContent` here, because the MDX plugin
 * claims the file first (`architecture.test.ts` records the measurement).
 */
export interface SourceQuestion {
  id: string;
  anchor?: string;
  statement: string;
  /**
   * The listing the question shows, kept apart from the statement. The
   * generator writes it to its own file and the sheet reads it with
   * `\lstinputlisting`, which needs no escaping at all — braces, backslashes,
   * `$`, `%`, `_` and `#` travel literally from the `.mdx` to the printed page.
   * Inline in the `.tex` every one of them would have to be escaped, and a Java
   * program is mostly braces.
   */
  code?: { language: string; source: string };
  alternatives: { text: string; correct: boolean }[];
}

const FENCE = /^ {0,3}(`{3,}|~{3,})[^\n]*$/;
const H2 = /^ {0,3}## +(.+?)\s*$/;
const SLIDE_TITLE = /<Slide\b[^>]*?\btitle="([^"]*)"/g;
const OPEN = /<Question\b([^>]*)>/;
const CLOSE = /<\/Question>/;
const ALTERNATIVE = /^\s*[-*] \[([ xX])\]\s+(.*?)\s*$/;
const ATTR = (name: string) => new RegExp(`\\b${name}="([^"]*)"`);

/**
 * The source with fenced code blocks blanked out.
 *
 * Lines are kept (blanked, not deleted) so nothing downstream has to care that
 * this happened. A `## comentario` inside a shell listing is not a section, and
 * counting it would let a broken anchor resolve against a heading the page never
 * renders — worse than not checking at all, because it reports success.
 */
function withoutFences(source: string): string[] {
  const out: string[] = [];
  let closing: string | null = null;
  for (const line of source.split('\n')) {
    if (closing === null) {
      const opened = FENCE.exec(line);
      if (opened) {
        closing = opened[1] ?? null;
        out.push('');
        continue;
      }
      out.push(line);
      continue;
    }
    // A fence closes on a marker at least as long as the one that opened it.
    if (line.trimStart().startsWith(closing)) closing = null;
    out.push('');
  }
  return out;
}

/**
 * Every section slug the document renders, in document order.
 *
 * A section is an `h2` (ADR-0021), and a `<Slide title>` renders one too — which
 * is where most anchors point, because most of the teaching path is written as
 * slides.
 */
export function headingSlugs(source: string): string[] {
  const lines = withoutFences(source);
  const slugs: string[] = [];
  for (const line of lines) {
    const heading = H2.exec(line);
    if (heading?.[1]) slugs.push(slugify(heading[1]));
  }
  for (const [, title] of lines.join('\n').matchAll(SLIDE_TITLE)) {
    if (title !== undefined) slugs.push(slugify(title));
  }
  return slugs;
}

/**
 * Every question authored in the document, in document order.
 *
 * Walks the raw source with its own fence state rather than the blanked copy
 * `headingSlugs` uses, because a question's listing is CONTENT here — the field
 * the printed sheet reads from. Fences outside a question are still skipped, so
 * a document's ordinary code examples can never be mistaken for a question's.
 */
export function readQuestions(source: string): SourceQuestion[] {
  const lines = source.split('\n');
  const out: SourceQuestion[] = [];
  let open: { id: string; anchor?: string } | null = null;
  let statement = '';
  let code: SourceQuestion['code'];
  let alternatives: SourceQuestion['alternatives'] = [];
  let fence: { closing: string; language: string; body: string[] } | null = null;

  for (const line of lines) {
    if (fence !== null) {
      if (line.trimStart().startsWith(fence.closing)) {
        // Only the first listing of a question is its code; a second one would
        // have no field to live in, and the rules keep questions to one.
        if (open !== null && code === undefined && fence.language !== '') {
          code = { language: fence.language, source: fence.body.join('\n') };
        }
        fence = null;
        continue;
      }
      fence.body.push(line);
      continue;
    }

    const opened = FENCE.exec(line);
    if (opened) {
      fence = {
        closing: opened[1] ?? '```',
        language:
          line
            .trim()
            .replace(/^[`~]+/, '')
            .trim()
            .split(/\s+/)[0] ?? '',
        body: [],
      };
      continue;
    }

    if (open === null) {
      const opened = OPEN.exec(line);
      const id = opened ? ATTR('id').exec(opened[1] ?? '')?.[1] : undefined;
      if (id === undefined) continue;
      const anchor = ATTR('anchor').exec(opened?.[1] ?? '')?.[1];
      open = anchor === undefined || anchor === '' ? { id } : { id, anchor };
      statement = '';
      code = undefined;
      alternatives = [];
      continue;
    }

    if (CLOSE.test(line)) {
      out.push({ ...open, statement, ...(code ? { code } : {}), alternatives });
      open = null;
      continue;
    }

    const alternative = ALTERNATIVE.exec(line);
    if (alternative) {
      alternatives.push({
        text: alternative[2] ?? '',
        correct: (alternative[1] ?? ' ').toLowerCase() === 'x',
      });
      continue;
    }

    // The first prose line is the question as the student reads it. Fence
    // bodies never reach here, so a listing can never become the statement.
    if (statement === '' && line.trim() !== '') statement = line.trim();
  }

  return out;
}
