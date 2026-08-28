import { Fragment, Suspense, lazy, type ReactNode } from 'react';

// Lazy: `katex` is ~260 kB minified and would otherwise ride in the entry
// chunk (Slide is used on every page). It is only fetched when a title
// actually contains inline math. Guarded by
// `src/architecture.test.ts > pulls in no package beyond what the first
// paint needs`.
const KatexInline = lazy(() => import('./katexInline'));

/**
 * Render a `<Slide title="...">` / `<Figure caption="...">`-style JSX attribute
 * string with inline KaTeX (`$$...$$`) and inline code (` `` `) support.
 *
 * WHY THIS EXISTS. A JSX attribute is a plain JavaScript string. The MDX
 * pipeline runs remark-math + rehype-katex over BODY text, but attribute
 * values never enter that pipeline — they reach the component as literal
 * characters. `<Slide title="Costo: $$O(N)$$">` therefore projects the
 * literal `$$O(N)$$` on the deck, and `title="Con `<Benchmark>`"` projects
 * literal backticks. The add-a-course-document guide used to work around
 * this by asking authors to move the formula into the slide body — which
 * was a workable stopgap but noisy pedagogically (the slide's own title is
 * the anchor of the section, so a plain text there loses the math cue).
 *
 * WHAT IT DOES. Tokenise the string into text / math / code runs, then
 * render each with the right primitive: text as text, code inside a `<code>`,
 * math through KaTeX's HTML+MathML output injected via
 * dangerouslySetInnerHTML. All three input sources are course content —
 * the CI-checked, PR-reviewed `content/` tree — so the html injection is
 * as safe as anything MDX ships from body prose (which uses the same
 * rehype-katex output).
 *
 * WHAT IT DOES NOT DO. No bold, italic, links, or headings. Titles are a
 * one-line concept and the parser stays minimal on purpose: expanding it
 * would replicate the whole markdown pipeline for a string that has only
 * two authoring needs to cover.
 */
export function renderInlineTitle(title: string): ReactNode {
  const tokens: Token[] = tokenise(title);
  return (
    <>
      {tokens.map((token, i) => (
        <Fragment key={i}>{renderToken(token)}</Fragment>
      ))}
    </>
  );
}

type Token =
  | { kind: 'text'; value: string }
  | { kind: 'math'; value: string }
  | { kind: 'code'; value: string };

/**
 * Walk the string and split it on the two delimiter classes. The pattern
 * is greedy on math (`$$...$$` may contain backticks) and non-greedy on
 * code — we do not want a single backtick to swallow the rest of the
 * title. Text between delimiters becomes text tokens; unbalanced
 * delimiters are treated as literal characters (the malformed delimiter
 * stays in the text, matching the guide's "malformed formula ships in
 * KaTeX's error colour" behaviour).
 */
function tokenise(text: string): Token[] {
  const tokens: Token[] = [];
  const pattern = /\$\$([\s\S]+?)\$\$|`([^`]+)`/g;
  let cursor = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > cursor) {
      tokens.push({ kind: 'text', value: text.slice(cursor, match.index) });
    }
    if (match[1] !== undefined) {
      tokens.push({ kind: 'math', value: match[1] });
    } else if (match[2] !== undefined) {
      tokens.push({ kind: 'code', value: match[2] });
    }
    cursor = match.index + match[0].length;
  }
  if (cursor < text.length) {
    tokens.push({ kind: 'text', value: text.slice(cursor) });
  }
  return tokens;
}

function renderToken(token: Token): ReactNode {
  if (token.kind === 'text') return token.value;
  if (token.kind === 'code') return <code>{token.value}</code>;
  // Math: while KaTeX loads (~260 kB) we show the raw LaTeX so the reader
  // still gets the intent; once it lands, the block swaps in the rendered
  // formula. Malformed input renders in KaTeX's error colour (same
  // behaviour as body math).
  return (
    <Suspense fallback={<span>${token.value}$</span>}>
      <KatexInline math={token.value} />
    </Suspense>
  );
}
