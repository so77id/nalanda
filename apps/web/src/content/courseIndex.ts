import { parse } from 'yaml';

/** One stop of the teaching path. Entries are topics, not class sessions (ADR-0002, D8). */
export interface IndexEntry {
  label?: string;
  levelName?: string;
  docId?: string;
  children?: IndexEntry[];
}

export interface CourseIndex {
  /** Course name — the first crumb of the breadcrumb. Optional: absent, the trail starts at the unit. */
  title?: string;
  entries: IndexEntry[];
}

const ENTRY_KEYS = ['label', 'levelName', 'docId', 'children'] as const;
const ROOT_KEYS = ['title', 'entries'] as const;

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
    if (!(ROOT_KEYS as readonly string[]).includes(key)) {
      fail(source, 'root', `unknown key "${key}" (allowed: ${ROOT_KEYS.join(', ')})`);
    }
  }
  const title = requireString(source, 'root', 'title', record['title']);
  if (!Array.isArray(record['entries']) || record['entries'].length === 0) {
    fail(source, 'root', 'must have a non-empty "entries" list');
  }
  const index: CourseIndex = {
    title,
    entries: record['entries'].map((entry, i) => parseEntry(source, `entries[${i}]`, entry)),
  };
  checkDuplicateDocIds(source, index.entries, 'entries', new Set());
  return index;
}

// A docId listed twice would silently corrupt prev/next (indexOf finds the first hit).
function checkDuplicateDocIds(
  source: string,
  entries: IndexEntry[],
  path: string,
  seen: Set<string>,
): void {
  entries.forEach((entry, i) => {
    const entryPath = `${path}[${i}]`;
    if (entry.docId) {
      if (seen.has(entry.docId)) {
        fail(source, entryPath, `duplicate docId "${entry.docId}" (already listed earlier)`);
      }
      seen.add(entry.docId);
    }
    if (entry.children) {
      checkDuplicateDocIds(source, entry.children, `${entryPath}.children`, seen);
    }
  });
}

function normalize(text: string): string {
  return text.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
}

/**
 * The index pruned to what matches a query: an entry survives if its own label
 * matches, or if any descendant's does — in which case it is kept as the path
 * to that descendant. A group that matches by name keeps all of its children,
 * because "Fundamentos" means the unit, not a unit with nothing in it.
 *
 * Labels are resolved by the caller (`labelOf`): a label-less entry displays
 * its document's registry title, and this module must not reach the registry.
 */
export function filterIndex(
  entries: IndexEntry[],
  query: string,
  labelOf: (entry: IndexEntry) => string,
): IndexEntry[] {
  const needle = normalize(query.trim());
  if (!needle) return entries;

  const prune = (list: IndexEntry[]): IndexEntry[] =>
    list.flatMap((entry) => {
      const self = normalize(labelOf(entry)).includes(needle);
      if (!entry.children) return self ? [entry] : [];
      if (self) return [entry];
      const children = prune(entry.children);
      return children.length > 0 ? [{ ...entry, children }] : [];
    });

  return prune(entries);
}

/** How many documents a (possibly pruned) list of entries holds. */
export function countDocuments(entries: IndexEntry[]): number {
  return entries.reduce(
    (total, entry) =>
      total + (entry.docId ? 1 : 0) + (entry.children ? countDocuments(entry.children) : 0),
    0,
  );
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

/** One ancestor group of a document, as the breadcrumb renders it. */
export interface TrailCrumb {
  label: string;
  levelName?: string;
}

/** Where a document sits in the course: the groups above it and its rank among its siblings. */
export interface Trail {
  /** Course name, from the index root; absent when the index has no title. */
  course?: string;
  /** Ancestor groups from the root down; empty for a top-level or unlisted document. */
  ancestors: TrailCrumb[];
  /** 1-based rank among the entries of the same list; absent when the document is unlisted. */
  position?: { at: number; of: number };
}

/**
 * The breadcrumb of a document, derived from the index alone. An unlisted
 * document is not an error — `/d/<id>` serves it, so the trail degrades to the
 * course name with no ancestors and no position.
 */
export function trailFor(
  index: CourseIndex,
  id: string,
  labelOf: (entry: IndexEntry) => string = (entry) => entry.label ?? entry.docId ?? '',
): Trail {
  const found = locate(index.entries, id, [], labelOf);
  return {
    course: index.title,
    ancestors: found?.ancestors ?? [],
    position: found?.position,
  };
}

/**
 * Whether a trail has anything to say. A trail with neither a course, an
 * ancestor nor a position renders nothing rather than an empty bar.
 */
export function hasTrail(trail: Trail): boolean {
  return Boolean(trail.course) || trail.ancestors.length > 0 || trail.position !== undefined;
}

/** Position in the tree — stable across renders, unique per entry, index-shaped. */
export function keyOf(parent: string, i: number): string {
  return parent ? `${parent}.${i}` : String(i);
}

/**
 * Keys of every group that has to be open for a document to be visible: its
 * ancestors, plus the group itself when the group carries the document as its
 * own cover page — otherwise reading a unit's cover leaves the unit shut with
 * the "you are here" mark hidden inside it.
 */
export function ancestorsOf(
  entries: IndexEntry[],
  id: string | undefined,
  parent = '',
): string[] | null {
  if (!id) return null;
  for (const [i, entry] of entries.entries()) {
    const key = keyOf(parent, i);
    if (entry.docId === id) return entry.children ? [key] : [];
    if (entry.children) {
      const deeper = ancestorsOf(entry.children, id, key);
      if (deeper) return [key, ...deeper];
    }
  }
  return null;
}

function locate(
  entries: IndexEntry[],
  id: string,
  ancestors: TrailCrumb[],
  labelOf: (entry: IndexEntry) => string,
): { ancestors: TrailCrumb[]; position: { at: number; of: number } } | null {
  for (const [i, entry] of entries.entries()) {
    // A group may carry a docId of its own: matched here, it is not its own ancestor.
    if (entry.docId === id) {
      return { ancestors, position: { at: i + 1, of: entries.length } };
    }
    if (entry.children) {
      const deeper = locate(
        entry.children,
        id,
        [...ancestors, { label: labelOf(entry), levelName: entry.levelName }],
        labelOf,
      );
      if (deeper) return deeper;
    }
  }
  return null;
}

/** Neighbors of a document along the depth-first walk; empty at the edges or off-index. */
export function prevNext(index: CourseIndex, id: string): { prev?: string; next?: string } {
  const ids = walkIndex(index);
  const at = ids.indexOf(id);
  if (at === -1) return { prev: undefined, next: undefined };
  return { prev: ids[at - 1], next: ids[at + 1] };
}
