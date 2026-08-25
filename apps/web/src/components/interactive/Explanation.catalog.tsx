import type { CatalogEntry } from '../../lib/catalogEntry';

import { Question } from './Question';

// Same alternatives helper Question.catalog uses, inlined so this file stays
// standalone: the render is the same task-list shape MDX turns into once the
// markdown pipeline is done.
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

/**
 * Catalog entry (ADR-0010) — colocated with the component, aggregated in
 * catalogEntries.ts. The example renders inside a `<Question>` because
 * `<Explanation>` on its own paints nothing: the parent unwraps it and shows
 * it only after the reader answers.
 */
export const explanationCatalogEntry: CatalogEntry = {
  name: 'Explanation',
  family: 'interactive',
  description:
    'A pedagogical note attached to a <Question>. The reader sees it only AFTER answering, so the note cannot spoil the guess. Page-only — never travels to questions.json, so the printed control stays unaware.',
  whenToUse:
    'Inside a <Question>, after the alternatives, whenever the WHY of the answer is worth teaching (a common trap, a subtle rule, a reference to how a concept was framed in class). ' +
    'Not for cases where "the correct alternative is obvious once you read it" — a note that only restates the winning option is noise. ' +
    'Not for links or bibliography — the note is part of the study loop, not a citation. ' +
    'The block is dropped by the source reader before the bank is built (see Explanation.tsx), so it can hold any pedagogical prose the author wants without adding weight to the control artifact. ' +
    'Skip it entirely on questions where seeing the wrong alternatives already teaches the distinction — the "verdict + coloured alternatives" pair is what pays for those.',
  props: [
    {
      name: 'children',
      type: 'MDX',
      description:
        'The note itself, as any MDX (paragraphs, inline math, code, links). Rendered inline in a subtle panel below the verdict; the same MDX rules apply as inside the question body — code fences render as read-only listings, inline math with $$…$$ renders through KaTeX.',
    },
  ],
  examples: [
    {
      title: 'A question with an explanation',
      code: `<Question id="por-que-oe-no-segundos">

¿Por qué medimos la complejidad en operaciones elementales (OE) y no en segundos?

- [ ] Porque el cronómetro es impreciso a escala de milisegundos.
- [x] Porque los segundos dependen de la máquina, el compilador y la carga del sistema; las OE dependen solo del algoritmo.
- [ ] Porque los procesadores modernos no pueden ejecutar más de una operación por ciclo.
- [ ] Porque las OE se convierten directamente a segundos usando la frecuencia del CPU.

<Explanation>
El cronómetro mide el entorno, no el algoritmo. Contar OE aísla la propiedad
que queremos comparar entre algoritmos.
</Explanation>

</Question>`,
      render: () => (
        <Question id="por-que-oe-no-segundos">
          <p>¿Por qué medimos la complejidad en operaciones elementales (OE) y no en segundos?</p>
          {alternatives(
            ['Porque el cronómetro es impreciso a escala de milisegundos.', false],
            [
              'Porque los segundos dependen de la máquina, el compilador y la carga del sistema; las OE dependen solo del algoritmo.',
              true,
            ],
            [
              'Porque los procesadores modernos no pueden ejecutar más de una operación por ciclo.',
              false,
            ],
            [
              'Porque las OE se convierten directamente a segundos usando la frecuencia del CPU.',
              false,
            ],
          )}
        </Question>
      ),
    },
    {
      title: 'A trap question where the explanation names the trap',
      code: `<Question id="cota-vs-caso-trap">

¿Cuál afirmación es correcta?

- [ ] O siempre se refiere al peor caso, Ω al mejor caso.
- [x] La notación (O, Ω, Θ) y el caso (mejor/peor/promedio) son dimensiones independientes.
- [ ] Un algoritmo tiene una única complejidad, sin importar la entrada.
- [ ] O es una cota más apretada que Θ.

<Explanation>
Cota y caso son ejes ortogonales. Se puede decir "en el mejor caso este
algoritmo es Θ(1)" o "en el peor caso es O(n²)": la notación describe qué
tipo de cota se da; el caso describe qué entrada se consideró.
</Explanation>

</Question>`,
      render: () => (
        <Question id="cota-vs-caso-trap">
          <p>¿Cuál afirmación es correcta?</p>
          {alternatives(
            ['O siempre se refiere al peor caso, Ω al mejor caso.', false],
            [
              'La notación (O, Ω, Θ) y el caso (mejor/peor/promedio) son dimensiones independientes.',
              true,
            ],
            ['Un algoritmo tiene una única complejidad, sin importar la entrada.', false],
            ['O es una cota más apretada que Θ.', false],
          )}
        </Question>
      ),
    },
  ],
};
