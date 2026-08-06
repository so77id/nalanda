import { parse } from 'yaml';

/** One stop of the teaching path. Entries are topics, not class sessions (ADR-0002, D8). */
export interface IndexEntry {
  label?: string;
  levelName?: string;
  docId?: string;
  children?: IndexEntry[];
}

export interface CourseIndex {
  entries: IndexEntry[];
}

const ENTRY_KEYS = ['label', 'levelName', 'docId', 'children'] as const;

function fail(source: string, path: string, message: string): never {
  throw new Error(`Course index (${source}): ${path}: ${message}`);
}

function requireString(
  source: string,
  path: string,
  key: string,
  value: unknown,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || value === '') {
    fail(source, `${path}.${key}`, `must be a non-empty string, got ${typeof value}`);
  }
  return value;
}

function parseEntry(source: string, path: string, raw: unknown): IndexEntry {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    fail(source, path, 'each entry must be a mapping');
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(ENTRY_KEYS as readonly string[]).includes(key)) {
      fail(source, path, `unknown key "${key}" (allowed: ${ENTRY_KEYS.join(', ')})`);
    }
  }

  const label = requireString(source, path, 'label', record['label']);
  const levelName = requireString(source, path, 'levelName', record['levelName']);
  const docId = requireString(source, path, 'docId', record['docId']);

  let children: IndexEntry[] | undefined;
  if (record['children'] !== undefined) {
    if (!Array.isArray(record['children']) || record['children'].length === 0) {
      fail(source, `${path}.children`, 'must be a non-empty list');
    }
    children = record['children'].map((child, i) =>
      parseEntry(source, `${path}.children[${i}]`, child),
    );
  }

  if (!docId && !children) {
    fail(source, path, 'an entry needs a "docId" or "children"');
  }
  if (children && !docId && !label) {
    fail(source, path, 'a group entry (with children) needs a "label"');
  }

  return { label, levelName, docId, children };
}

/** Parses and strictly validates a course index; throws with a field path on any shape error. */
export function parseCourseIndex(raw: string, source: string): CourseIndex {
  const data: unknown = parse(raw);
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    fail(source, 'root', 'must be a mapping with an "entries" list');
  }
  const record = data as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (key !== 'entries') {
      fail(source, 'root', `unknown key "${key}" (allowed: entries)`);
    }
  }
  if (!Array.isArray(record['entries']) || record['entries'].length === 0) {
    fail(source, 'root', 'must have a non-empty "entries" list');
  }
  return {
    entries: record['entries'].map((entry, i) => parseEntry(source, `entries[${i}]`, entry)),
  };
}

/** Depth-first walk over the index — the linear reading order of the course. */
export function walkIndex(index: CourseIndex): string[] {
  const ids: string[] = [];
  const visitEntries = (entries: IndexEntry[]): void => {
    for (const entry of entries) {
      if (entry.docId) ids.push(entry.docId);
      if (entry.children) visitEntries(entry.children);
    }
  };
  visitEntries(index.entries);
  return ids;
}

/** Neighbors of a document along the depth-first walk; empty at the edges or off-index. */
export function prevNext(index: CourseIndex, id: string): { prev?: string; next?: string } {
  const ids = walkIndex(index);
  const at = ids.indexOf(id);
  if (at === -1) return { prev: undefined, next: undefined };
  return { prev: ids[at - 1], next: ids[at + 1] };
}

const rawIndexes = import.meta.glob('@content/courses/*/index.yaml', {
  eager: true,
  query: '?raw',
  import: 'default',
});
const found = Object.entries(rawIndexes);
if (found.length !== 1) {
  throw new Error(
    `Course index: expected exactly one content/courses/*/index.yaml (v0.1 is single-course), found ${found.length}`,
  );
}

/** The live index of the single v0.1 course. */
export const courseIndex = parseCourseIndex(found[0]![1] as string, found[0]![0]);
