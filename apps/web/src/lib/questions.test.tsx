import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';

import { withMeta } from './componentMeta';
import { parseQuestions } from './questions';

/**
 * Synthetic JSX, deliberately — the same choice `presentation/parser.test.tsx`
 * makes. What the parser consumes is the element tree MDX produces, and building
 * that tree by hand keeps the cases here from needing anything in `content/`,
 * which is published: a fixture question written to exercise a parser would ship
 * to the live site with the professor's name on it (ADR-0025 makes `content/`
 * the suite's fixture set, which is exactly why nothing throwaway belongs there).
 *
 * The shapes below are not invented. They were measured by compiling MDX through
 * the real plugin list: a GFM task list renders as
 * `<ul class="contains-task-list"><li class="task-list-item"><input type="checkbox" checked/> …`,
 * and a fence renders as an element whose only child is
 * `<code className="language-java">`.
 */

// A stand-in for the real component: the parser recognises a question by its
// meta, never by importing the component — which is what keeps `lib/` free of
// any dependency on `components/`.
const Question = withMeta((_props: { id: string; anchor?: string; children?: ReactNode }) => null, {
  questionRole: 'question',
});

function alternatives(...items: [string, boolean][]) {
  return (
    <ul className="contains-task-list">
      {items.map(([text, correct]) => (
        <li className="task-list-item" key={text}>
          <input type="checkbox" disabled checked={correct} readOnly /> {text}
        </li>
      ))}
    </ul>
  );
}

function fence(language: string, source: string) {
  return (
    <pre>
      <code className={`language-${language}`}>{source}</code>
    </pre>
  );
}

describe('parseQuestions', () => {
  it('reads id, statement and alternatives, marking the checked one correct', () => {
    const defs = parseQuestions(
      <Question id="indice-cero" anchor="que-significa-static">
        <p>¿Cuál es el índice del primer elemento?</p>
        {alternatives(['0', true], ['1', false], ['-1', false], ['Depende', false])}
      </Question>,
    );

    expect(defs).toHaveLength(1);
    expect(defs[0]).toMatchObject({
      id: 'indice-cero',
      anchor: 'que-significa-static',
      statement: '¿Cuál es el índice del primer elemento?',
    });
    expect(defs[0]?.alternatives.map(({ text, correct }) => ({ text, correct }))).toEqual([
      { text: '0', correct: true },
      { text: '1', correct: false },
      { text: '-1', correct: false },
      { text: 'Depende', correct: false },
    ]);
  });

  it('derives the type from how many alternatives are marked correct', () => {
    // Derived, never declared. A `type` prop would be a second source of truth
    // that can disagree with the checkboxes, and the checkboxes are what the
    // reader sees — so the marks decide and nothing else can contradict them.
    const [simple] = parseQuestions(
      <Question id="una">
        <p>¿Cuál compila?</p>
        {alternatives(['a', true], ['b', false], ['c', false], ['d', false])}
      </Question>,
    );
    const [multiple] = parseQuestions(
      <Question id="varias">
        <p>¿Cuáles compilan?</p>
        {alternatives(['a', true], ['b', true], ['c', false], ['d', false])}
      </Question>,
    );

    expect(simple?.type).toBe('simple');
    expect(multiple?.type).toBe('multiple');
  });

  it('leaves anchor undefined when the question belongs to the whole document', () => {
    const defs = parseQuestions(
      <Question id="nota-final">
        <p>¿Con qué porcentaje se aprueba?</p>
        {alternatives(['50%', true], ['60%', false], ['40%', false], ['70%', false])}
      </Question>,
    );
    expect(defs[0]?.anchor).toBeUndefined();
  });

  it('extracts a code fence as its own field, with its language', () => {
    const source = 'int[] v = {1, 2, 3};\n';
    const defs = parseQuestions(
      <Question id="suma-arreglo" anchor="arreglos">
        <p>¿Qué imprime?</p>
        {fence('java', source)}
        {alternatives(['6', true], ['3', false], ['123', false], ['No compila', false])}
      </Question>,
    );
    // Its own field, never folded into the statement: the generator writes it to
    // a separate file so `listings` can read it verbatim, which is what saves
    // every brace and backslash from being escaped into a .tex.
    // The trailing newline every fence carries is trimmed: the editor renders
    // it as an empty last line, which reads as a mistake in the listing.
    expect(defs[0]?.code).toEqual({ language: 'java', source: source.trimEnd() });
    expect(defs[0]?.statement).toBe('¿Qué imprime?');
  });

  it('reads every question in a group, in document order', () => {
    const defs = parseQuestions(
      <>
        <Question id="uno" anchor="a">
          <p>Primera</p>
          {alternatives(['sí', true], ['no', false], ['tal vez', false], ['nunca', false])}
        </Question>
        <Question id="dos" anchor="b">
          <p>Segunda</p>
          {alternatives(['sí', false], ['no', true], ['tal vez', false], ['nunca', false])}
        </Question>
      </>,
    );
    expect(defs.map((d) => d.id)).toEqual(['uno', 'dos']);
  });

  // The defect this pins shipped green and was found by looking at the page:
  // `textOf` deliberately does not recurse into elements (a documented decision
  // about published anchor slugs), so a statement written as
  // "¿Por qué `main` tiene que ser `static`?" came out as "¿Por qué tiene que
  // ser ?" — both inline-code words silently gone, on the page and in the JSON
  // a printed sheet would be generated from.
  it('keeps inline elements in the statement and the alternatives', () => {
    const defs = parseQuestions(
      <Question id="static-inline" anchor="que-significa-static">
        <p>
          ¿Por qué <code>main</code> tiene que ser <code>static</code>?
        </p>
        {alternatives(
          ['Porque la máquina virtual lo llama sin crear un objeto', true],
          ['Porque solo los métodos static pueden imprimir', false],
          ['Porque lo exige el archivo .class', false],
          ['Porque se ejecuta más rápido', false],
        )}
      </Question>,
    );
    expect(defs[0]?.statement).toBe('¿Por qué main tiene que ser static?');
  });

  it('ignores anything that is not a question', () => {
    expect(parseQuestions(<p>Just prose</p>)).toEqual([]);
    expect(parseQuestions(null)).toEqual([]);
  });
});
