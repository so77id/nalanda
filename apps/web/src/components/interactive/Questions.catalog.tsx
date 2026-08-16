import type { CatalogEntry } from '../../lib/catalogEntry';

import { Question } from './Question';
import { Questions } from './Questions';

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

/** Catalog entry (ADR-0010) — colocated with the component, aggregated in catalogEntries.ts. */
export const questionsCatalogEntry: CatalogEntry = {
  name: 'Questions',
  family: 'interactive',
  description:
    'The block of control questions at the end of a course document. Holds the <Question>s and nothing else.',
  whenToUse:
    'Once per document that carries questions, after the last section and before the closing invitation of the document where it has one — questions after a goodbye read as an appendix nobody scrolls to. At the very end when there is no closing section. The document declares how it is covered in its frontmatter: `questions: per-section` (every section owes one, gaps declared with a reason), `pool` (a set with no per-section expectation, which is what an opening class wants), or `none`. ' +
    'Its heading is a bare `h2` with no id, deliberately: a section is an `h2` the platform gave a slug to (ADR-0021), and if this one became a section then a document declaring `per-section` would owe a question about its own questions block — a rule eating its own tail.',
  props: [
    {
      name: 'children',
      type: 'MDX',
      description: 'The <Question> elements, in the order they should be read.',
    },
  ],
  examples: [
    {
      title: 'Two questions at the end of a class',
      code: `<Questions>

<Question id="static-sin-objeto" anchor="que-significa-static">

¿Por qué \`main\` tiene que ser \`static\`?

- [x] Porque la máquina virtual lo llama sin haber creado ningún objeto todavía
- [ ] Porque así el programa se ejecuta más rápido
- [ ] Porque solo los métodos \`static\` pueden imprimir en pantalla
- [ ] Porque lo exige el nombre del archivo \`.class\`

</Question>

<Question id="indice-cero" anchor="arreglos">

¿Cuál es el índice del primer elemento de un arreglo en Java?

- [x] 0
- [ ] 1
- [ ] -1
- [ ] Depende del tipo

</Question>

</Questions>`,
      render: () => (
        <Questions>
          <Question id="static-sin-objeto" anchor="que-significa-static">
            <p>¿Por qué main tiene que ser static?</p>
            {alternatives(
              ['Porque la máquina virtual lo llama sin haber creado ningún objeto todavía', true],
              ['Porque así el programa se ejecuta más rápido', false],
              ['Porque solo los métodos static pueden imprimir en pantalla', false],
              ['Porque lo exige el nombre del archivo .class', false],
            )}
          </Question>
          <Question id="indice-cero" anchor="arreglos">
            <p>¿Cuál es el índice del primer elemento de un arreglo en Java?</p>
            {alternatives(['0', true], ['1', false], ['-1', false], ['Depende del tipo', false])}
          </Question>
        </Questions>
      ),
    },
    {
      title: 'A question about the whole chapter, with no anchor',
      code: `<Questions>

<Question id="nota-de-aprobacion">

¿Con qué porcentaje del puntaje se obtiene un 4,0?

- [x] 50%
- [ ] 60%
- [ ] 40%
- [ ] 70%

</Question>

</Questions>`,
      render: () => (
        <Questions>
          <Question id="nota-de-aprobacion">
            <p>¿Con qué porcentaje del puntaje se obtiene un 4,0?</p>
            {alternatives(['50%', true], ['60%', false], ['40%', false], ['70%', false])}
          </Question>
        </Questions>
      ),
    },
  ],
};
