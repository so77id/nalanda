import { Children, Fragment, isValidElement } from 'react';
import type { ReactElement, ReactNode } from 'react';

import { metaOf } from './componentMeta';
import { textOf } from './reactText';

/** One alternative of a control question; exactly one is correct (issue #139). */
export interface QuestionAlternative {
  /** Plain text, for the JSON the control generator reads. */
  text: string;
  /** The original nodes, for the page — inline code and mathematics survive. */
  node: ReactNode;
  correct: boolean;
}

/**
 * A code listing shown by a question, kept as its own field rather than folded
 * into the statement.
 *
 * That separation is not tidiness. The control generator writes this source to
 * its own file and the sheet reads it with `\lstinputlisting`, which needs no
 * escaping at all — braces, backslashes, `$`, `%`, `_` and `#` travel literally
 * from the `.mdx` to the printed page. Inline in the `.tex` every one of them
 * would have to be escaped, and a Java program is mostly braces. Measured in
 * #139's refinement against the real worker image, where `verbatim` inside an
 * AMC question does not compile at all.
 */
export interface QuestionCode {
  language: string;
  source: string;
}

/** One control question, as authored at the end of a course document. */
export interface QuestionDef {
  /**
   * Stable identifier, authored explicitly. It is the join key: it travels into
   * the generated `.tex`, comes back from the worker as `answers[].name`, and is
   * what the grade record joins to (ADR-0031). Deriving it was considered and
   * both options fail the requirement it exists for — anchor-plus-ordinal
   * renumbers silently when questions are reordered, and a hash of the statement
   * changes when a typo is fixed.
   */
  id: string;
  /**
   * The `h2` slug this question belongs to, or undefined when it belongs to the
   * whole document. An unanchored question enters a control's pool only when the
   * range covers the document entirely: one answerable from the whole chapter
   * cannot be answered from half of it.
   */
  anchor?: string;
  statement: string;
  code?: QuestionCode;
  alternatives: QuestionAlternative[];
}

const LANGUAGE_CLASS = /(?:^|\s)language-([\w+-]+)(?:\s|$)/;

function isQuestion(node: ReactNode): node is ReactElement {
  return isValidElement(node) && metaOf(node.type).questionRole === 'question';
}

function childrenOf(node: ReactNode): ReactNode[] {
  if (!isValidElement(node)) return [];
  return Children.toArray((node.props as { children?: ReactNode }).children);
}

/**
 * `textOf` deliberately does not recurse into elements — a documented decision
 * with a published-anchor migration behind it (see `reactText.ts`). So every
 * caller here hands it the CHILDREN of the element it wants the text of, never
 * the element, which would silently yield an empty string.
 */
function textIn(node: ReactNode): string {
  return textOf(childrenOf(node));
}

/**
 * Text of a whole subtree, INCLUDING what elements contain.
 *
 * `textOf` deliberately stops at elements, and `reactText.ts` explains why it
 * must keep doing so: recursing would change published anchor slugs. This is a
 * separate function for a separate job — a question's own text — so that rule
 * is left exactly where it is.
 *
 * Not recursing here was a real defect, and the suite could not see it: a
 * statement written as "¿Por qué `main` tiene que ser `static`?" rendered as
 * "¿Por qué tiene que ser ?" with both inline-code words silently gone. Found
 * by looking at the page (#139 S3).
 */
function deepText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(deepText).join('');
  if (isValidElement(node)) return deepText((node.props as { children?: ReactNode }).children);
  return '';
}

/** Flattens fragments so a group of questions is walked, not skipped. */
function flatten(children: ReactNode): ReactNode[] {
  const out: ReactNode[] = [];
  for (const node of Children.toArray(children)) {
    if (isValidElement(node) && node.type === Fragment) {
      out.push(...flatten((node.props as { children?: ReactNode }).children));
    } else {
      out.push(node);
    }
  }
  return out;
}

/** The `language-x` class of a `<code>` element, or null when it carries none. */
function languageOf(node: ReactNode): string | null {
  if (!isValidElement(node)) return null;
  const className = (node.props as { className?: unknown }).className;
  if (typeof className !== 'string') return null;
  return LANGUAGE_CLASS.exec(className)?.[1] ?? null;
}

/**
 * A fence renders as an element whose only child is a `<code class="language-x">`.
 *
 * Recognised by that shape rather than by element type on purpose: the shell
 * maps `pre` to its own component (`MdxPre`, which is a code editor), so by the
 * time these children exist the outer element is no longer a `pre` at all. The
 * inner `<code>` and its class survive either way.
 */
function codeOf(children: ReactNode[]): QuestionCode | null {
  for (const child of children) {
    // The class sits on the inner `<code>`, one level below the wrapper, so the
    // wrapper itself is checked too — the shell replaces `pre` with its own
    // component and a future one might carry the class directly.
    for (const candidate of [child, ...childrenOf(child)]) {
      const language = languageOf(candidate);
      // Trailing newline trimmed: a fence always ends with one, and it renders
      // as an empty last line in the listing — line 9 of an 8-line program.
      if (language) return { language, source: textIn(candidate).replace(/\s+$/, '\n') };
    }
  }
  return null;
}

/** True when a task-list item's checkbox is checked — the correct alternative. */
function isChecked(node: ReactNode): boolean {
  return childrenOf(node).some(
    (child) =>
      isValidElement(child) &&
      child.type === 'input' &&
      (child.props as { checked?: unknown }).checked === true,
  );
}

/**
 * The alternatives of a question: a GFM task list, where the checked item is the
 * correct one.
 *
 * Marked in place rather than named from outside (`answer="b"`), because naming
 * one by position means reordering the alternatives silently changes the correct
 * answer. It is also what the AMC source already does with `\correctchoice` —
 * correctness travels with the alternative it belongs to.
 */
function alternativesOf(children: ReactNode[]): QuestionAlternative[] {
  for (const child of children) {
    if (!isValidElement(child) || child.type !== 'ul') continue;
    const items = childrenOf(child).filter((li) => isValidElement(li) && li.type === 'li');
    if (items.length === 0) continue;
    return items.map((li) => {
      // The checkbox is a child of the item; keep the rest as the alternative.
      const rest = childrenOf(li).filter(
        (child) => !(isValidElement(child) && child.type === 'input'),
      );
      return { text: deepText(rest).trim(), node: rest, correct: isChecked(li) };
    });
  }
  return [];
}

/** The first paragraph of a question: the question as the student reads it. */
function statementOf(children: ReactNode[]): ReactNode {
  for (const child of children) {
    if (isValidElement(child) && child.type === 'p') {
      return (child.props as { children?: ReactNode }).children;
    }
  }
  return null;
}

/** The parts of one question, extracted from its own children. */
export interface QuestionParts {
  /** Plain text, for the JSON the control generator reads. */
  statement: string;
  /** The original nodes, for the page — inline code and mathematics survive. */
  statementNode: ReactNode;
  code?: QuestionCode;
  alternatives: QuestionAlternative[];
}

/**
 * The parts of a single question, for the component that renders it.
 *
 * The component renders FROM these rather than passing its children through,
 * which is what keeps a code fence from becoming a runnable editor: the shell
 * maps `pre` to one, and a Run button would answer "¿qué imprime este programa?"
 * before the student did.
 */
export function parseQuestionParts(children: ReactNode): QuestionParts {
  const nodes = Children.toArray(children);
  const code = codeOf(nodes);
  const statementNode = statementOf(nodes);
  return {
    statement: deepText(statementNode).trim(),
    statementNode,
    ...(code ? { code } : {}),
    alternatives: alternativesOf(nodes),
  };
}

/**
 * Pure extraction of the questions in a rendered subtree.
 *
 * Walks the element tree the MDX document produced rather than its source, the
 * same way `presentation/parser.ts` computes slides — one shape to understand
 * instead of two, and it cannot drift from what the page actually shows.
 */
export function parseQuestions(children: ReactNode): QuestionDef[] {
  const out: QuestionDef[] = [];
  for (const node of flatten(children)) {
    if (!isQuestion(node)) continue;
    const props = node.props as { id?: unknown; anchor?: unknown };
    out.push({
      id: typeof props.id === 'string' ? props.id : '',
      ...(typeof props.anchor === 'string' && props.anchor !== '' ? { anchor: props.anchor } : {}),
      ...parseQuestionParts((node.props as { children?: ReactNode }).children),
    });
  }
  return out;
}
