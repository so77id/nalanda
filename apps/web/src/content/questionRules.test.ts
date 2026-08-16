import { describe, expect, it } from 'vitest';

import { questionProblems } from './questionRules';
import type { SourceQuestion } from './questionSource';

const SECTIONS = new Set(['arreglos']);

/** A question that breaks no rule; each case below spoils exactly one thing. */
function sound(overrides: Partial<SourceQuestion> = {}): SourceQuestion {
  return {
    id: 'indice-cero',
    anchor: 'arreglos',
    statement: '¿Cuál es el índice del primer elemento?',
    alternatives: [
      { text: 'Cero, siempre', correct: true },
      { text: 'Uno, siempre', correct: false },
      { text: 'Depende del tipo', correct: false },
      { text: 'Depende del largo', correct: false },
    ],
    ...overrides,
  };
}

function problems(overrides: Partial<SourceQuestion> = {}): string[] {
  return questionProblems(sound(overrides), SECTIONS);
}

describe('questionProblems', () => {
  it('says nothing about a sound question', () => {
    expect(problems()).toEqual([]);
  });

  it('rejects an anchor that names no section', () => {
    expect(problems({ anchor: 'no-existe' }).join(' ')).toMatch(/no-existe/);
  });

  it('accepts a question with no anchor at all', () => {
    // Deliberate: it belongs to the whole chapter and enters a control only
    // when the range covers the document entirely.
    expect(problems({ anchor: undefined })).toEqual([]);
  });

  it('demands exactly four alternatives', () => {
    const three = sound().alternatives.slice(0, 3);
    expect(problems({ alternatives: three }).join(' ')).toMatch(/cuatro/i);
  });

  it('demands at least one correct alternative', () => {
    const none = sound().alternatives.map((a) => ({ ...a, correct: false }));
    expect(problems({ alternatives: none }).join(' ')).toMatch(/correcta/i);
  });

  it('refuses a question where every alternative is correct', () => {
    // "Mark everything" measures nothing, and it collides with the
    // "none of these" box AMC adds to every multiple.
    const all = sound().alternatives.map((a) => ({ ...a, correct: true }));
    expect(problems({ alternatives: all }).join(' ')).toMatch(/tres/i);
  });

  it('accepts two correct alternatives, which is just a multiple', () => {
    const two = sound().alternatives.map((a, i) => ({ ...a, correct: i < 2 }));
    expect(problems({ alternatives: two })).toEqual([]);
  });

  it('refuses "todas las anteriores", which measures nothing', () => {
    // Not a shuffling problem — pinning would solve that. If every alternative
    // is correct a multiple already says so by marking them, and whoever knows
    // nothing marks everything and scores.
    const withAll = [...sound().alternatives];
    withAll[3] = { text: 'Todas las anteriores', correct: false };
    expect(problems({ alternatives: withAll }).join(' ')).toMatch(/anteriores/i);
  });

  it('ACCEPTS "ninguna de las anteriores", which the sheet prints last', () => {
    // The ban existed because a shuffled catch-all lands mid-list and says
    // something false. #147 pins it with AMC's \lastchoices, so the reason is
    // gone — and a question where every listed option is wrong cannot be
    // authored any other way (ADR-0033).
    const withNone = [...sound().alternatives];
    withNone[3] = { text: 'Ninguna de las anteriores', correct: true };
    expect(problems({ alternatives: withNone })).toEqual([]);
  });

  it('refuses a negated stem', () => {
    // Under a five-minute clock with shuffled alternatives, a negation measures
    // hurried reading rather than knowledge.
    expect(problems({ statement: '¿Cuál NO es un tipo primitivo?' }).join(' ')).toMatch(/negad/i);
  });

  it('refuses an "excepto" stem, which is a negation wearing a hat', () => {
    expect(problems({ statement: '¿Cuáles son primitivos, excepto uno?' }).join(' ')).toMatch(
      /negad/i,
    );
  });

  it('refuses a negated stem that opens with the Spanish inverted mark', () => {
    // `¿` is neither whitespace nor start-of-string, so the rule written for
    // Spanish missed the one punctuation Spanish actually uses.
    expect(problems({ statement: '¿NO compila este programa?' }).join(' ')).toMatch(/negad/i);
  });

  it('reports an empty alternative as empty, not as a length problem', () => {
    // Restoring a guard dropped while adding the length floor: with an empty
    // rival the ratio always trips, and the author is handed the wrong
    // diagnosis for a real defect.
    const gap = [...sound().alternatives];
    gap[1] = { text: '', correct: false };
    expect(problems({ alternatives: gap }).join(' ')).toMatch(/vac/i);
  });

  it('leaves a lowercase "no" alone, because it is usually the question itself', () => {
    // "¿Por qué no compila?" is one of the best questions this course can ask.
    expect(problems({ statement: '¿Por qué no compila este programa?' })).toEqual([]);
  });

  it('refuses a correct alternative that is far longer than the rest', () => {
    // The most measurable authoring tell there is: the longest alternative is
    // usually the answer, and a student who has not studied can find it.
    const tell = [...sound().alternatives];
    tell[0] = {
      text: 'Cero, siempre, porque los arreglos en Java se indexan desde el principio y el primer elemento ocupa la posición inicial',
      correct: true,
    };
    expect(problems({ alternatives: tell }).join(' ')).toMatch(/larga/i);
  });

  it('allows a long alternative when it is not the correct one', () => {
    // Length is only a tell when it points AT the answer. A wrong alternative
    // that needs words to be plausible is not giving anything away.
    const tell = [...sound().alternatives];
    tell[1] = {
      text: 'Uno, siempre, porque los arreglos en Java se indexan desde el principio y el primer elemento ocupa la posición inicial',
      correct: false,
    };
    expect(problems({ alternatives: tell })).toEqual([]);
  });

  it('refuses an empty statement', () => {
    // A blank stem passes every other gate and reaches a printed, graded sheet
    // as a question with nothing written on it.
    expect(problems({ statement: '' }).join(' ')).toMatch(/enunciado/i);
  });

  it('refuses an id that is empty or not kebab-case', () => {
    // The id is the join key from the printed sheet, through the scanner, into
    // a grade (ADR-0031). An empty one is an empty column in a grade sheet.
    expect(questionProblems(sound({ id: '' }), SECTIONS).join(' ')).toMatch(/id/i);
    expect(questionProblems(sound({ id: 'Pregunta 1' }), SECTIONS).join(' ')).toMatch(/id/i);
    expect(questionProblems(sound({ id: 'indice-cero-2' }), SECTIONS)).toEqual([]);
  });

  it('accepts short alternatives whose lengths differ by a lot', () => {
    // The archetypal "what does this print" set, already in the repo. Between
    // "123" and "No compila" the ratio is 3.3x and it means nothing: length
    // only carries a signal once an alternative is long enough to read as
    // more complete than its rivals.
    const output = [
      { text: '3', correct: false },
      { text: '6', correct: false },
      { text: '123', correct: false },
      { text: 'No compila', correct: true },
    ];
    expect(problems({ alternatives: output })).toEqual([]);
  });

  it('names the question in every problem it reports', () => {
    // The message is read in a failing suite, far from the document.
    for (const problem of problems({ anchor: 'no-existe', statement: '¿Cuál NO es válida?' })) {
      expect(problem).toMatch(/indice-cero/);
    }
  });
});
