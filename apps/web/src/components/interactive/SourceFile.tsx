import { useState } from 'react';

import { resolveCode } from '../../lib/contentCode';
import { AuthoringError } from '../AuthoringError';
import { CodeFileViewer } from './CodeFileViewer';
import { CodeListing } from './CodeListing';
import { excerptOf, fileNameOf } from './codeExcerpt';

export interface SourceFileProps {
  /**
   * The file quoted, a path relative to the document
   * (`./26-grafos-tda-modelado.code/Graph.java`, ADR-0091).
   */
  src: string;
  /** The lines quoted, "12-16"; the whole file without it. */
  range?: string;
  /** The name in the header; the file's own name without it. */
  name?: string;
  language?: string;
}

/**
 * A listing quoted from a file kept beside the document — what a fenced
 * block is when the code already lives in a file (#363, ADR-0091). One copy of
 * the file, quoted wherever it is needed: change the file and every slide that
 * quotes it changes. The header names the file and the range, the gutter
 * counts as the file does, a fold row counts the lines left out, and «Ver
 * archivo» opens the whole file with the quoted lines banded.
 */
export function SourceFile({ src, range, name, language = 'java' }: SourceFileProps) {
  const [open, setOpen] = useState(false);
  const source = resolveCode(src);
  if (source === null) {
    return (
      <AuthoringError component="SourceFile">
        no encontró el archivo <code>{src}</code>: la ruta va relativa al documento, y el archivo
        tiene que estar bajo <code>content/</code>.
      </AuthoringError>
    );
  }
  const excerpt = excerptOf(source, range);
  const label = name ?? fileNameOf(src);
  return (
    <div className="not-prose my-6 overflow-hidden rounded-lg border border-rule bg-surface text-ink">
      <CodeListing
        name={label}
        code={excerpt.text}
        excerpt={excerpt}
        lines={[]}
        language={language}
        onOpen={() => setOpen(true)}
      />
      {open ? (
        <CodeFileViewer
          files={[{ name: label, source, first: excerpt.first, last: excerpt.last, lines: [] }]}
          start={0}
          onClose={() => setOpen(false)}
        />
      ) : null}
    </div>
  );
}
