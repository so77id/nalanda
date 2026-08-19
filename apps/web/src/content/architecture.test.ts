import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { walkIndex } from './courseIndex';
import { parseFrontmatterBlock } from './documentMeta';
import { courseIndex, registry } from './liveContent';
import { questionProblems } from './questionRules';
import { headingSlugs, readQuestions } from './questionSource';

// The document list comes from the same glob `liveContent.ts` uses, so this
// invariant covers exactly the set the app ships — no more and no less. A
// directory walk of its own drifts from that set in both directions: it follows
// a symlinked directory out of the tree, and it drops a symlinked `.mdx` the
// glob (and therefore the registry) does publish.
//
// The BODY still reads the file, and two measured facts say it has to:
//   - `parseDocumentMeta` normalises an absent `presentation` to 'auto', so the
//     parsed meta cannot tell "declared auto" from "never declared" — and that
//     difference is the entire point of the invariant below. The `?frontmatter`
//     virtual module goes through the same normaliser, so it is no better.
//   - `import.meta.glob(..., { query: '?raw' })` does NOT return the source
//     here: the MDX plugin claims the file first, so the glob hands back the
//     compiled `MDXContent` function. A frontmatter regex over that finds
//     nothing and every case fails with "no frontmatter block", which looks
//     like the invariant working and is not.
//
// Glob keys are relative to the Vite root, so they are resolved against this
// file rather than the cwd. `fileURLToPath(import.meta.url)` is fine on its own
// — it is the `new URL(x, import.meta.url)` PATTERN that Vite rewrites into an
// asset URL, and only that pattern throws.
const APP_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const documents = Object.keys(import.meta.glob('@content/courses/**/*.mdx'));

// L4 invariants over the live content/ tree (testing-strategy.md): unique ids
// and index integrity. Importing liveContent re-runs all fail-fast validation.
describe('architecture: content invariants', () => {
  it('the registry builds and every entry is retrievable by its id', () => {
    expect(registry.entries.length).toBeGreaterThan(0);
    for (const entry of registry.entries) {
      expect(registry.get(entry.meta.id)).toBe(entry);
    }
  });

  it('the course index exists and every referenced docId resolves in the registry', () => {
    const ids = walkIndex(courseIndex);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) {
      expect(registry.get(id), `index references unknown doc "${id}"`).toBeDefined();
    }
  });

  // Issue #108. `presentation` is optional in the schema and defaults to 'auto',
  // so a document that never declares it still ships a deck — one its author has
  // never seen. The schema keeps the default (a platform where most documents
  // should be presentable wants it); this invariant is about authored intent, and
  // it is the only thing that can tell the two apart.
  //
  // Registry-driven per testing-strategy.md: one case per document the glob
  // finds, so a new document is gated the moment it lands, with the non-vacuity
  // guard naming what to do if it ever trips.
  describe('every course document declares how it presents', () => {
    it('finds documents to check', () => {
      expect(
        documents.length,
        'the @content glob matched no .mdx — the content tree moved; repoint it before trusting the cases below',
      ).toBeGreaterThan(0);
    });

    it.each(documents)('%s declares `presentation`', (key) => {
      const front = parseFrontmatterBlock(readFileSync(join(APP_ROOT, key), 'utf8')) as Record<
        string,
        unknown
      > | null;
      expect(front, `no frontmatter block in ${key}`).not.toBeNull();
      expect(
        Object.hasOwn(front!, 'presentation'),
        `${key} does not declare "presentation". It still ships a deck (the default is 'auto') — one nobody chose. Declare auto, explicit or none.`,
      ).toBe(true);
    });
  });

  // Issue #139, same shape and the same reason as `presentation` above: the
  // schema defaults `questions` to 'none', so the parsed meta cannot tell "the
  // author decided this document carries no questions" from "nobody thought
  // about it". Reading the source is the only thing that can.
  //
  // Why it matters more here than a missing declaration usually does: a control
  // draws its pool from a range of sections, and a document nobody declared is
  // silently absent from every pool it should have been in. That surfaces when
  // a control is generated — which is the week it is needed, not before.
  describe('every course document declares its question coverage', () => {
    it.each(documents)('%s declares `questions`', (key) => {
      const front = parseFrontmatterBlock(readFileSync(join(APP_ROOT, key), 'utf8')) as Record<
        string,
        unknown
      > | null;
      expect(front, `no frontmatter block in ${key}`).not.toBeNull();
      expect(
        Object.hasOwn(front!, 'questions'),
        `${key} does not declare "questions". Declare per-section (every section owes one, gaps declared), pool (a set with no per-section expectation), or none.`,
      ).toBe(true);
    });
  });

  // Issue #139. The rules a machine can check — four alternatives, between one
  // and three marked, no all/none-of-the-above, no negated stem, no correct
  // alternative that gives itself away by length, and an anchor that names a
  // real section (ADR-0021). Each exists because it changes what a control
  // MEASURES; the pedagogical ones live in the guide and nothing enforces them.
  //
  // Over the SOURCE, for the same reason the coverage invariant is: the
  // compiled module cannot tell us what the author typed.
  //
  // The suite refuses it and the BUILD DOES NOT. Drafting a question before its
  // section exists is a real order of work — only publishing one is not — so
  // `npm run build` stays green and this is what stops it shipping. The page
  // says so too: `<Question>` paints an authoring error over an anchor it
  // cannot resolve, which is the half a reader would see.
  describe('every question obeys the mechanical authoring rules', () => {
    it.each(documents)('%s has no question the rules refuse', (key) => {
      const source = readFileSync(join(APP_ROOT, key), 'utf8');
      const sections = new Set(headingSlugs(source));
      const problems = readQuestions(source).flatMap((question) =>
        questionProblems(question, sections),
      );
      expect(problems, `${key}\n  ${problems.join('\n  ')}`).toEqual([]);
    });
  });

  // Issue #139. What `questions: per-section` and `questions: pool` promise.
  //
  // A section deliberately without a question is DECLARED, with its reason —
  // the same shape as RETIRED in `app/documentBreadcrumb.test.tsx` (#136), and
  // for the same reason: the set is closed in both directions. Forget a section
  // and it goes red; cover one that used to be exempt and it goes red too, so a
  // stale exemption cannot outlive the gap it described.
  //
  // The alternative — demanding one question per section, no exceptions —
  // produces filler for hands-on slides and side-by-side listings, and filler
  // measures noise and then lands in a real control.
  const NO_QUESTION: Record<string, Record<string, string>> = {
    'java-desde-cpp': {
      'de-donde-viene-java': 'contexto histórico; el control mide Java, no de dónde salió',
      'el-mismo-programa-en-dos-idiomas':
        'muestra los dos listados lado a lado; lo que enseña se mide en "Cuatro diferencias"',
      'ejecutalo-helloworld': 'actividad: el alumno corre el programa, no hay nada que preguntar',
      'pruebalo-el-metodo-sin-static': 'actividad, igual que la anterior',
      'la-prueba-del-nombre-completo':
        'comprueba a mano que import es una abreviatura, que es justo lo que mide la pregunta de "import y paquetes"',
      'lo-que-sigue': 'cierre del documento: anuncia el siguiente, no enseña nada propio',
    },
    // Why these three and not the lab slides too: `write-control-questions.md`
    // §"When a section owes nothing, and when one owes two" holds the rule and
    // both worked cases. Reasons here, rule there — one home per fact.
    'java-tipos-y-flujo': {
      'ejercicio-en-vivo-es-par':
        'actividad: el alumno escribe el método y lo comprueba, no hay nada que preguntar',
      ejercicios: 'actividad: cinco problemas para escribir, no materia que medir en cinco minutos',
      'lo-que-sigue': 'cierre del documento: anuncia lo que viene, no enseña nada propio',
    },
    'referencias-null-igualdad': {
      ejercicios: 'actividad: tres problemas para escribir, no materia que medir en cinco minutos',
      'lo-que-sigue': 'cierre del documento: anuncia lo que viene, no enseña nada propio',
    },
    // Regla del WP #78 (AC-11): cada sección abre con la ancla C++ antes del
    // delta Java. La slide de C++ y las de sub-detalle no llevan pregunta
    // propia — lo que enseñan se mide en la pregunta de la sección Java que
    // las sigue. Convención inaugurada aquí, misma forma que las exenciones
    // de `java-desde-cpp` arriba (contexto, comparaciones, actividades).
    'arrays-y-funciones': {
      'arrays-en-c':
        'contraste con C++; el delta Java que introduce se mide en la pregunta de "Arrays en Java"',
      'tres-iniciaciones':
        'sub-detalle del §1 arrays; el hecho principal (largo como campo, tamaño fijo) se mide en la pregunta de "Arrays en Java"',
      'en-c-era-segfault':
        'contraste con C++; el comportamiento que Java garantiza se mide en la pregunta de "Acceso y bounds"',
      'funciones-en-c':
        'contraste con C++; lo que Java hace distinto se mide en la pregunta de "Anatomía de una función"',
      'factorial-en-vivo':
        'actividad: el alumno corre factorial(5) y compara los resultados; la mecánica se mide en "Recursión"',
      'sin-caso-base':
        'actividad: el alumno provoca el StackOverflowError; la pregunta que mide el mecanismo vive en "Recursión"',
      'fibonacci-con-arreglo':
        'actividad: el alumno corre la versión con arreglo y mide su tiempo; la lección se sintetiza en "El árbol de llamadas"',
      'fibonacci-con-dos-variables':
        'actividad: el alumno corre la versión con ventana y compara con la del arreglo; misma razón que la anterior',
      'fibonacci-recursivo':
        'actividad: el alumno corre la versión recursiva y siente la lentitud; el porqué se mide en "El árbol de llamadas"',
      ejercicios:
        'actividad: cuatro problemas para escribir; la materia se mide en las preguntas ancladas a las secciones que los preparan',
      'lo-que-sigue':
        'cierre del documento: anuncia el siguiente y cierra el hilo de complejidad, no enseña nada propio',
    },
    // WP #79, same convention as #78: C++ openers and detail/activity slides
    // owe nothing of their own — what they teach is measured by the section's
    // main question. The seven section anchors (clase-atributos-y-metodos,
    // this, visibilidad, herencia, interfaces, polimorfismo,
    // tostring-equals-hashcode) carry the bank's eleven questions; the
    // entries below are the slides that sit beside them.
    objetos: {
      'que-es-una-clase-que-es-un-objeto':
        'definiciones de apertura: clase, objeto e instancia; lo que mide la pregunta de la sección es la anatomía de la clase',
      'clases-en-c':
        'contraste con C++; el delta Java que introduce se mide en la pregunta de "Clase: atributos y métodos"',
      'clases-en-java':
        'sub-detalle del §1; el hecho principal (atributos + constructor + métodos, en un archivo) se mide en la pregunta de la sección',
      'instancia-y-usa':
        'actividad: el alumno construye una Pair y llama getters; la mecánica se mide en la pregunta de la sección',
      'visibilidad-en-c':
        'contraste con C++; el delta Java que introduce se mide en la pregunta de "Visibilidad"',
      'public-private-en-java':
        'sub-detalle del §3; el hecho principal (acceso por miembro, compilador como guardia) se mide en la pregunta de la sección',
      'la-trampa-acceso-desde-afuera':
        'actividad: el alumno predice el error de compilación; la pregunta que mide el mecanismo vive en "Visibilidad"',
      'herencia-para-que-sirve':
        'motivación de la sección; el mecanismo (extends/super/@Override) se mide en las preguntas ancladas a "Herencia"',
      'herencia-en-el-jdk-ejemplo-real':
        'ejemplo: lo que enseña (el padre acepta a cualquier hijo) se mide en las preguntas ancladas a "Herencia"',
      'extends-super-override':
        'sub-detalle de §5: la mecánica que muestra se mide en las preguntas ancladas a la sección',
      'la-trampa-del-override':
        'actividad: el alumno predice la salida del typo sin @Override; la pregunta que mide el mecanismo vive en "Herencia"',
      'interfaces-para-que-sirven':
        'motivación de la sección; el mecanismo (implements como contrato) se mide en la pregunta anclada a "Interfaces"',
      'una-interfaz-una-clase-que-la-cumple':
        'sub-detalle de §6: el primer ejemplo; la regla (implements obliga a definir el método) se mide en la pregunta anclada a la sección',
      'la-misma-clase-varias-interfaces':
        'sub-detalle de §6: la extensión a varios contratos se mide en la pregunta anclada a la sección',
      'una-interfaz-del-sistema-comparable':
        'ejemplo detallado: lo que mide una pregunta va en la sección principal de §6',
      'tu-clase-se-une-al-club':
        'ejemplo detallado: lo que mide una pregunta va en la sección principal de §6',
      'la-trampa-implements-sin-cumplir':
        'actividad: el alumno predice el error de compilación; el mecanismo se mide en la pregunta anclada a "Interfaces"',
      'polimorfismo-que-es-y-para-que':
        'motivación de la sección; el mecanismo (dispatch según el objeto real) se mide en las preguntas ancladas a "Polimorfismo"',
      'dos-maneras-un-mismo-verbo':
        'el diagrama muestra las dos vías; lo que enseña (un mismo verbo, dos jerarquías) se mide en las preguntas ancladas a "Polimorfismo"',
      'polimorfismo-por-herencia-vehiculo':
        'actividad: el alumno corre el arreglo Vehiculo[]; la mecánica se mide en las preguntas ancladas a "Polimorfismo"',
      'polimorfismo-por-interfaz-comparable':
        'actividad: el alumno corre el arreglo Comparable[]; la mecánica se mide en las preguntas ancladas a "Polimorfismo"',
      'los-metodos-que-toda-clase-hereda':
        'introducción de la sección; lo que enseña (herencia desde Object, por qué se sobrescribe) se mide en las preguntas ancladas a "toString, equals, hashCode"',
      tostring:
        'sub-detalle de §8: el override de toString; lo que se mide vive en las preguntas ancladas a la sección',
      'equals-cuando-dos-objetos-son-el-mismo':
        'el ejemplo y el mecanismo de equals se miden en las preguntas ancladas a "toString, equals, hashCode"',
      ejercicios:
        'actividad: cuatro problemas para escribir; la materia se mide en las preguntas ancladas a las secciones que los preparan',
      'lo-que-sigue':
        'cierre del documento: anuncia el siguiente (genéricos), no enseña nada propio',
    },
  };

  function sourceOf(key: string): string {
    return readFileSync(join(APP_ROOT, key), 'utf8');
  }

  function frontOf(key: string): Record<string, unknown> {
    return (parseFrontmatterBlock(sourceOf(key)) ?? {}) as Record<string, unknown>;
  }

  const perSection = documents.filter((key) => frontOf(key).questions === 'per-section');
  const pooled = documents.filter((key) => frontOf(key).questions === 'pool');

  describe('a per-section document carries a question for every section it did not exempt', () => {
    it('finds per-section documents to check', () => {
      expect(
        perSection.length,
        'no document declares questions: per-section, so the cases below prove nothing. If the teaching path really moved off per-section, retire this block.',
      ).toBeGreaterThan(0);
    });

    it.each(perSection)('%s covers its sections', (key) => {
      const source = sourceOf(key);
      const covered = new Set(
        readQuestions(source)
          .map(({ anchor }) => anchor)
          .filter((anchor): anchor is string => anchor !== undefined),
      );
      const gaps = headingSlugs(source)
        .filter((slug) => !covered.has(slug))
        .sort();
      const exempt = Object.keys(NO_QUESTION[String(frontOf(key).id)] ?? {}).sort();

      expect(
        gaps,
        `${key}: the sections without a question do not match NO_QUESTION.\n  sin pregunta: ${gaps.join(', ') || '(ninguna)'}\n  declaradas:   ${exempt.join(', ') || '(ninguna)'}\nWrite a question for the section, or add it to NO_QUESTION above WITH ITS REASON. A section that now has one must leave that list.`,
      ).toEqual(exempt);
    });
  });

  // `pool` says "a set of questions, with no per-section expectation". With no
  // questions at all it says exactly what `none` says, and a document could
  // ship an empty pool that nothing notices — until a control is generated from
  // a range that includes it and comes up short.
  // One case that walks the list, rather than `it.each` over it: no document
  // declares `pool` today (bienvenida will, once its questions are written), and
  // `it.each([])` makes vitest fail the whole suite with "No test found" — which
  // exits 1 while reporting every test passed, the exact trap
  // `testing-strategy.md` §Conventions warns about.
  it('every pool document carries at least one question', () => {
    const empty = pooled.filter((key) => readQuestions(sourceOf(key)).length === 0);
    expect(
      empty,
      `${empty.join(', ')} declares questions: pool and carries none, which is what "none" already means. Write them, or declare none — the honest word for a document that has none yet.`,
    ).toEqual([]);
  });

  // Issue #119. Where the gate on a missing image goes, and why here.
  //
  // Rendering one is deliberately forgiving: an unresolved asset shows a broken
  // box and warns, exactly as an unresolved wiki-link does (ADR-0002), because
  // writing twenty-two slides before drawing nine diagrams is a real order of
  // work. Failing the BUILD would also take the dev server down — the integrity
  // plugin runs at `buildStart` — so an author could not preview the very
  // document they are drafting.
  //
  // But merging to main publishes the site, and a hole where a diagram belongs
  // gets projected in front of a class. So the gate sits in the suite: it does
  // not block writing, and it does block publishing (pre-PR protocol + CI).
  //
  // Deliberately a second opinion rather than a re-run of `remarkContentImages`:
  // this reads the source and touches the filesystem, so a bug in the plugin's
  // path arithmetic cannot make both agree that a missing file is fine.
  describe('every image a document references is a file that exists', () => {
    const MARKDOWN_IMAGE = /!\[[^\]]*\]\(([^)\s]+)\)/g;
    const JSX_SRC = /\bsrc=(?:"([^"]+)"|'([^']+)')/g;
    // Anything with a scheme, protocol-relative, or already rooted is not ours.
    const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

    function referencesIn(key: string): string[] {
      const source = readFileSync(join(APP_ROOT, key), 'utf8');
      const found = [
        ...[...source.matchAll(MARKDOWN_IMAGE)].map((m) => m[1]),
        ...[...source.matchAll(JSX_SRC)].map((m) => m[1] ?? m[2]),
      ];
      return found.filter((url) => url !== undefined && !NOT_RELATIVE.test(url));
    }

    const withImages = documents.flatMap((key) =>
      referencesIn(key).map((url) => ({ key, url }) as const),
    );

    it('finds image references to check', () => {
      expect(
        withImages.length,
        'no document references a relative image any more — either the convention changed or this regex stopped matching it; fix this before trusting the cases below',
      ).toBeGreaterThan(0);
    });

    it.each(withImages.map(({ key, url }) => [`${key} -> ${url}`, key, url] as const))(
      '%s',
      (_label, key, url) => {
        const file = join(dirname(join(APP_ROOT, key)), url);
        expect(
          existsSync(file),
          `${key} references "${url}", which is not a file. Draw it, or fix the path — it renders as a broken box and would ship that way.`,
        ).toBe(true);
      },
    );
  });

  // Issue #119 (review CT-3). Alt is required and in Spanish (root CLAUDE.md: the
  // page is lang="es", so an accessible name is announced with Spanish phonemes).
  // `<Figure>` enforces this at runtime, but a markdown image `![](./x.svg)`
  // routes through `MdxImage`, which passes alt straight through — so an empty-alt
  // markdown image would ship an unnamed picture past every gate. The one
  // documented exception (`alt=""`) lives inside a `<Mosaic>` cell, a JSX-only
  // affordance; markdown has no Mosaic, so every relative markdown image must
  // name itself. Reads the source and ships at publish-time weight, like the
  // file-existence gate above.
  //
  // No document uses `![](…)` today: `busqueda-binaria` was the last one and #135
  // deleted it. That is why this is ONE set assertion rather than the per-image
  // `it.each` plus non-vacuity floor it was until then. The FLOOR is what could
  // not survive — it demanded a markdown image exist, so at zero the block could
  // only be deleted or fed an invented one, and inventing content for the suite
  // is what ADR-0025 exists to refuse. The alt check itself never needed a
  // fixture. Asserting the offending SET is empty passes at zero documents and
  // arms itself the moment someone writes the syntax — which the authoring guide
  // still teaches and `content/mdxPipeline.test.tsx` still pins as supported
  // pipeline behaviour.
  //
  // #135 first deleted this whole block, on the reasoning that the file-existence
  // gate above covers it. It does not: that gate checks the PATH and never the
  // alt, and `MdxImage` passes alt through unvalidated. Two review lenses caught
  // it, one by appending `![](./costo-busqueda.svg)` to a real document and
  // watching the suite stay green.
  it('every relative markdown image names itself', () => {
    const MARKDOWN_IMAGE = /!\[([^\]]*)\]\(([^)\s]+)\)/g;
    // Anything with a scheme, protocol-relative, or already rooted is not ours.
    const NOT_RELATIVE = /^(?:[a-z][a-z0-9+.-]*:|\/\/|\/)/i;

    const unnamed = documents.flatMap((key) => {
      const source = readFileSync(join(APP_ROOT, key), 'utf8');
      return [...source.matchAll(MARKDOWN_IMAGE)]
        .filter((m) => !NOT_RELATIVE.test(m[2]!) && m[1]!.trim() === '')
        .map((m) => `${key} -> ${m[2]!}`);
    });

    expect(
      unnamed,
      'a markdown image with empty alt ships an unnamed picture — write its alt in Spanish, or use <Figure> if it belongs on a slide',
    ).toEqual([]);
  });
});
