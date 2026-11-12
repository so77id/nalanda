// Pure arithmetic of a listing cut out of a file: which lines it shows, how
// they are numbered, and how many stay hidden above and below. Kept apart from
// the components so the suite checks it exactly (the way `memoryLayout.ts`
// is), and so `<StepShow>` and `<SourceFile>` cut a file the same way.

/** A listing as a widget shows it: its text and where it sits in its file. */
export interface Excerpt {
  /** The lines shown, joined. */
  text: string;
  /** The file line the first shown line is — 1 for a whole file. */
  first: number;
  /** The file line the last shown line is. */
  last: number;
  /** How many lines the file has. */
  total: number;
  /** Lines of the file hidden above the excerpt. */
  above: number;
  /** Lines of the file hidden below it. */
  below: number;
}

/**
 * The lines of `source` named by `range` — "12-16", or "12" for one line, or
 * undefined for the whole file. A range that runs past the file is clamped to
 * it, so a file that shrinks does not blank the listing; a malformed one
 * shows the whole file rather than nothing.
 */
export function excerptOf(source: string, range?: string): Excerpt {
  const lines = source.replace(/\n$/, '').split('\n');
  const total = lines.length;
  const parsed = parseRange(range);
  const first = parsed === null ? 1 : Math.min(Math.max(parsed[0], 1), total);
  const last = parsed === null ? total : Math.min(Math.max(parsed[1], first), total);
  return {
    text: dedent(lines.slice(first - 1, last)).join('\n'),
    first,
    last,
    total,
    above: first - 1,
    below: total - last,
  };
}

/**
 * The quoted lines without the indentation they all share: a fragment of a
 * method sits eight columns in, and on a slide those columns are the ones a
 * line clips by. The numbers stay the file's; the whole file, in the viewer,
 * keeps its real indentation.
 */
function dedent(lines: string[]): string[] {
  const indents = lines.filter((l) => l.trim() !== '').map((l) => /^ */.exec(l)![0].length);
  const cut = indents.length === 0 ? 0 : Math.min(...indents);
  return lines.map((l) => l.slice(Math.min(cut, /^ */.exec(l)![0].length)));
}

function parseRange(range: string | undefined): [number, number] | null {
  if (range === undefined) return null;
  const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(range);
  if (m === null) return null;
  const a = Number(m[1]);
  const b = m[2] === undefined ? a : Number(m[2]);
  return a <= b ? [a, b] : [b, a];
}

/**
 * File line numbers as the listing's own (1-based) lines, dropping the ones
 * the excerpt does not show — a step names lines in the file's numbering, the
 * editor paints its own.
 */
export function toExcerptLines(fileLines: number[], excerpt: Excerpt): number[] {
  return fileLines
    .filter((n) => n >= excerpt.first && n <= excerpt.last)
    .map((n) => n - excerpt.first + 1);
}

/** The base name of a path: `AdjMatrixGraph.java` from `asset:…/AdjMatrixGraph.java`. */
export function fileNameOf(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}
