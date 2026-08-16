import type { CatalogEntry } from '../../lib/catalogEntry';

import { Question } from './Question';

// What an author writes is a markdown task list; what the component consumes is
// the element tree that becomes. Same split as the Figure and SideBySide
// entries: the snippet shows the source, the render shows what it turned into.
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

const SUMA = `public class Demo {
    public static void main(String[] args) {
        int[] v = {1, 2, 3};
        int s = 0;
        for (int x : v) s += x;
        System.out.println(s);
    }
}
`;

/** Catalog entry (ADR-0010) — colocated with the component, exported via the seam. */
export const questionCatalogEntry: CatalogEntry = {
  name: 'Question',
  family: 'interactive',
  description:
    'One multiple-choice question, answered on the page and — once answered — marked right or wrong. The unit the entrance controls draw from.',
  whenToUse:
    'At the end of a course document, inside <Questions>. Write the question where the class ends rather than beside the section it asks about: writing prose and writing questions are different mental modes, and `anchor` is what keeps the question tied to its section anyway. ' +
    'The correct alternative is marked in place with a checked task-list item, never named from outside — naming one by position means reordering the alternatives silently changes the answer. ' +
    'The answer is revealed only once the reader answers: pacing, not secrecy. Everything under `content/` is published, so the page source holds it either way, and a question a student cannot self-check is worth less as study material. ' +
    'A code listing is shown read-only. In a document body a fence is a runnable editor, and inside a question a Run button would answer a what-does-this-print question before the student did.',
  props: [
    {
      name: 'id',
      type: 'string',
      description:
        'Stable identifier, written by hand and never derived. It is the join key all the way to a grade: into the generated sheet, back from the reader, into the grade record (ADR-0031). Deriving it fails both ways — anchor-plus-ordinal renumbers when questions are reordered, and a hash of the statement changes when a typo is fixed.',
    },
    {
      name: 'anchor',
      type: 'string',
      description:
        'The `h2` slug this question belongs to — a `<Slide title>` renders an `h2`, so slide titles are anchorable. Omit it when the question belongs to the whole chapter: an unanchored question enters a control only when the range covers the document entirely, because one answerable from the whole chapter cannot be answered from half of it.',
    },
    {
      name: 'children',
      type: 'MDX',
      description:
        'A paragraph (the question), optionally a fenced code block, and a task list of exactly four alternatives with the correct one checked.',
    },
  ],
  examples: [
    {
      title: 'A question anchored to a section',
      code: `<Question id="static-sin-objeto" anchor="que-significa-static">

¿Por qué \`main\` tiene que ser \`static\`?

- [x] Porque la máquina virtual lo llama sin haber creado ningún objeto todavía
- [ ] Porque así el programa se ejecuta más rápido
- [ ] Porque solo los métodos \`static\` pueden imprimir en pantalla
- [ ] Porque lo exige el nombre del archivo \`.class\`

</Question>`,
      render: () => (
        <Question id="static-sin-objeto" anchor="que-significa-static">
          <p>¿Por qué main tiene que ser static?</p>
          {alternatives(
            ['Porque la máquina virtual lo llama sin haber creado ningún objeto todavía', true],
            ['Porque así el programa se ejecuta más rápido', false],
            ['Porque solo los métodos static pueden imprimir en pantalla', false],
            ['Porque lo exige el nombre del archivo .class', false],
          )}
        </Question>
      ),
    },
    {
      title: 'A question that shows code',
      code: `<Question id="que-imprime-arreglo" anchor="arreglos">

¿Qué imprime este programa?

\`\`\`java
public class Demo {
    public static void main(String[] args) {
        int[] v = {1, 2, 3};
        int s = 0;
        for (int x : v) s += x;
        System.out.println(s);
    }
}
\`\`\`

- [ ] 3
- [x] 6
- [ ] 123
- [ ] No compila

</Question>`,
      render: () => (
        <Question id="que-imprime-arreglo" anchor="arreglos">
          <p>¿Qué imprime este programa?</p>
          <pre>
            <code className="language-java">{SUMA}</code>
          </pre>
          {alternatives(['3', false], ['6', true], ['123', false], ['No compila', false])}
        </Question>
      ),
    },
  ],
};
