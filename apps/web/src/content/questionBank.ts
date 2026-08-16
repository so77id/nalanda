import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

// Extension-qualified imports: this file is also compiled under tsconfig.node
// (nodenext), because vite.config.ts imports the plugin.
import { parseCourseIndex, walkIndex } from './courseIndex.ts';
import { parseDocumentMeta, parseFrontmatterBlock } from './documentMeta.ts';
import { headingSlugs, readQuestions } from './questionSource.ts';

/** The published path. English like every other identifier here (root CLAUDE.md). */
export const BANK_FILE = 'questions.json';

/** One document, as the bank describes it. */
export interface BankDocument {
  id: string;
  title: string;
  coverage: string;
  /** Section slugs in reading order — what turns "from X to Y" into a set of questions. */
  sections: string[];
}

/** One question, as the control generator will read it. */
export interface BankQuestion {
  id: string;
  document: string;
  anchor: string | null;
  type: 'simple' | 'multiple';
  statement: string;
  code: { language: string; source: string } | null;
  alternatives: string[];
  /** Indices into `alternatives`. A SET, because a question may admit several. */
  correct: number[];
}

export interface Bank {
  version: 1;
  documents: BankDocument[];
  questions: BankQuestion[];
}

/** A document as the emitter hands it over: already in reading order. */
export interface BankInput {
  id: string;
  title: string;
  coverage: string;
  source: string;
}

/**
 * The published question bank.
 *
 * The shape is a cross-app contract — **ADR-0032**, the upstream half of the
 * join ADR-0031 owns at the other end.
 *
 * The server reads THIS rather than `content/`, so it can never generate a
 * control from a question the site does not show (design C14). Mounting the
 * repo beside the server was rejected for exactly that: it ties the deploy to a
 * checkout and allows the two to drift.
 *
 * Documents come in reading order and carry their sections in document order,
 * which is what lets "from section X to section Y" resolve to a pool without
 * the server parsing a single `.mdx`.
 *
 * The correct answers are in a public file, and that is consistent rather than
 * careless: the page reveals them to any reader who answers, and the bank was
 * published study material from the first decision (design C1).
 */
export function buildBank(documents: BankInput[]): Bank {
  const seen = new Map<string, string>();
  const questions: BankQuestion[] = [];

  for (const document of documents) {
    for (const question of readQuestions(document.source)) {
      const previous = seen.get(question.id);
      if (previous !== undefined) {
        // The id is the join key all the way to a grade (ADR-0031). Two
        // questions sharing one would silently merge two students' answers into
        // one column, and nothing downstream could tell.
        throw new Error(
          `Question bank: duplicate question id "${question.id}" in ${previous} and ${document.id}`,
        );
      }
      seen.set(question.id, document.id);

      const correct = question.alternatives.flatMap(({ correct }, index) =>
        correct ? [index] : [],
      );
      questions.push({
        id: question.id,
        document: document.id,
        anchor: question.anchor ?? null,
        type: correct.length > 1 ? 'multiple' : 'simple',
        statement: question.statement,
        code: question.code ?? null,
        alternatives: question.alternatives.map(({ text }) => text),
        correct,
      });
    }
  }

  return {
    version: 1,
    documents: documents.map(({ id, title, coverage, source }) => ({
      id,
      title,
      coverage,
      sections: headingSlugs(source),
    })),
    questions,
  };
}

function walkDir(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? walkDir(full) : [full];
  });
}

/**
 * Emits the question bank as a published asset of the site.
 *
 * `generateBundle` rather than `buildStart`: this reads content and writes an
 * output file, so it belongs where outputs are made — and unlike
 * `contentIntegrity`, it must NOT run on dev-server startup, where there is no
 * bundle to add an asset to.
 *
 * Documents are emitted in the order `index.yaml` defines. Documents off the
 * teaching path are skipped rather than appended: a control covers a RANGE of
 * the reading order, and a document with no position in it has no range to
 * belong to. Their questions, if any, would be unreachable by definition.
 */
export function questionBank(contentDir: string): Plugin {
  return {
    name: 'nalanda:question-bank',
    generateBundle() {
      const files = walkDir(contentDir);
      const byId = new Map<string, { title: string; coverage: string; source: string }>();

      for (const file of files.filter((f) => f.endsWith('.mdx'))) {
        const source = readFileSync(file, 'utf8');
        // `meta.questions` and not a second read of the raw frontmatter: the
        // parser has already validated the value against the schema and applied
        // the default, so re-reading it here would be a second source of truth
        // for one field — and it threw the union type away.
        const meta = parseDocumentMeta(file, parseFrontmatterBlock(source));
        byId.set(meta.id, { title: meta.title, coverage: meta.questions, source });
      }

      const ordered = files
        .filter((f) => f.endsWith('index.yaml'))
        .flatMap((file) => walkIndex(parseCourseIndex(readFileSync(file, 'utf8'), file)));

      const documents = ordered.flatMap((id) => {
        const document = byId.get(id);
        return document ? [{ id, ...document }] : [];
      });

      this.emitFile({
        type: 'asset',
        fileName: BANK_FILE,
        source: `${JSON.stringify(buildBank(documents), null, 2)}\n`,
      });
    },
  };
}
