import type { SourceQuestion } from './questionSource';

/**
 * The mechanical authoring rules — the ones a machine can check.
 *
 * The pedagogical ones (answerable from that section alone, asks what the
 * section says rather than what can be inferred, a multiple because the
 * material genuinely has several true statements) live in
 * `guides/write-control-questions.md` and nothing enforces them, because
 * nothing can.
 *
 * Every rule here exists because it changes what a control MEASURES. None is
 * about tidiness, and each message says which question is wrong, since it is
 * read from a failing suite far away from the document.
 */

const ALTERNATIVES = 4;
/** At most three of four: "mark everything" measures nothing. */
const MOST_CORRECT = 3;

const ALL_OR_NONE = /\b(todas|ninguna|ambas)\b[^.]*\banteriores\b/i;
/**
 * Uppercase `NO` only, plus the words that smuggle a negation in.
 *
 * Lowercase "no" is deliberately allowed: "¿Por qué no compila este programa?"
 * is one of the best questions this course can ask, and banning it to catch
 * "¿cuál no es válida?" would cost far more than it saves. Uppercase is the
 * typographic convention for the negated stem, which is the form that actually
 * appears.
 */
const NEGATED_CAPS = /(?:^|\s)NO(?:\s|[?.,;:!]|$)/;
const NEGATED_WORD = /\b(excepto|salvo)\b/i;
/**
 * How much longer the correct alternative may be than its nearest rival before
 * its length becomes the answer. Measured against the SECOND longest rather
 * than the average, because one very short distractor would otherwise drag the
 * average down and flag a set that reads evenly.
 */
const LENGTH_TELL = 1.6;

function say(question: SourceQuestion, problem: string): string {
  return `<Question id="${question.id}"> ${problem}`;
}

export function questionProblems(
  question: SourceQuestion,
  sections: ReadonlySet<string>,
): string[] {
  const problems: string[] = [];
  const { anchor, statement, alternatives } = question;

  if (anchor !== undefined && !sections.has(anchor)) {
    problems.push(
      say(
        question,
        `apunta a "${anchor}", que no es ninguna sección de este documento. Corrige el anchor o quítalo si la pregunta es del capítulo entero.`,
      ),
    );
  }

  if (alternatives.length !== ALTERNATIVES) {
    problems.push(
      say(
        question,
        `tiene ${alternatives.length} alternativas y deben ser cuatro: el generador reparte el punto entre ellas, y una pregunta con otro número pesa distinto que las demás.`,
      ),
    );
  }

  const correct = alternatives.filter(({ correct }) => correct).length;
  if (correct === 0) {
    problems.push(
      say(question, 'no marca ninguna alternativa correcta: marca la respuesta con `- [x]`.'),
    );
  } else if (correct > MOST_CORRECT) {
    problems.push(
      say(
        question,
        `marca ${correct} alternativas correctas de ${alternatives.length}; el máximo son tres. Marcarlas todas no mide nada y choca con la casilla de "ninguna de estas" que el control agrega a cada pregunta múltiple.`,
      ),
    );
  }

  for (const { text } of alternatives) {
    if (ALL_OR_NONE.test(text)) {
      problems.push(
        say(
          question,
          `usa "${text}": cada copia baraja sus alternativas, así que fuera del último lugar deja de significar algo.`,
        ),
      );
      break;
    }
  }

  if (NEGATED_CAPS.test(statement) || NEGATED_WORD.test(statement)) {
    problems.push(
      say(
        question,
        'tiene el enunciado negado. Con cinco minutos de reloj y las alternativas barajadas, eso mide lectura apurada y no conocimiento: pregúntalo en positivo.',
      ),
    );
  }

  const lengths = [...alternatives].sort((a, b) => b.text.length - a.text.length);
  const longest = lengths[0];
  const runnerUp = lengths[1];
  if (
    longest?.correct === true &&
    runnerUp !== undefined &&
    runnerUp.text.length > 0 &&
    longest.text.length > runnerUp.text.length * LENGTH_TELL
  ) {
    problems.push(
      say(
        question,
        'tiene la alternativa correcta bastante más larga que las demás. Es el vicio de redacción más fácil de explotar: quien no estudió elige la más larga y acierta.',
      ),
    );
  }

  return problems;
}
