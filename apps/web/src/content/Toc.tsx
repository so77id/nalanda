import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { countDocuments, filterIndex } from './courseIndex';
import type { CourseIndex, IndexEntry } from './courseIndex';
import { registry } from './liveContent';

function docLabel(entry: IndexEntry): string {
  if (entry.label) return entry.label;
  if (entry.docId) return registry.get(entry.docId)?.meta.title ?? entry.docId;
  return '';
}

/** Position in the tree — stable across renders, unique per entry, index-shaped. */
function keyOf(parent: string, i: number): string {
  return parent ? `${parent}.${i}` : String(i);
}

/** Keys of every group between the root and the given document. */
function ancestorsOf(entries: IndexEntry[], id: string | undefined, parent = ''): string[] | null {
  if (!id) return null;
  for (const [i, entry] of entries.entries()) {
    const key = keyOf(parent, i);
    if (entry.docId === id) return [];
    if (entry.children) {
      const deeper = ancestorsOf(entry.children, id, key);
      if (deeper) return [key, ...deeper];
    }
  }
  return null;
}

interface ItemProps {
  entry: IndexEntry;
  entryKey: string;
  isOpen: (key: string) => boolean;
  onToggle: (key: string, open: boolean) => void;
}

function DocLink({ entry }: { entry: IndexEntry }) {
  if (!entry.docId) return null;
  return (
    <NavLink
      to={`/d/${entry.docId}`}
      className={({ isActive }) =>
        isActive
          ? 'block rounded bg-slate-800 px-2 py-1 font-medium text-sky-300'
          : 'block rounded px-2 py-1 text-slate-300 hover:bg-slate-800/60'
      }
    >
      {docLabel(entry)}
    </NavLink>
  );
}

function EntryItem({ entry, entryKey, isOpen, onToggle }: ItemProps) {
  if (!entry.children) {
    return (
      <li>
        <DocLink entry={entry} />
      </li>
    );
  }
  return (
    <li>
      <details
        className="group"
        open={isOpen(entryKey)}
        onToggle={(event) => onToggle(entryKey, event.currentTarget.open)}
      >
        {/* The marker gets a column of its own. Inline, it pushed only the
            FIRST line of the label: a wrapped group name ("Java para quien
            viene de C++") started its second line under the triangle, left of
            the label's own text, and the tree lost its vertical edge. */}
        <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded px-2 py-1 text-slate-100 hover:bg-slate-800/60 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="mt-1 shrink-0 text-slate-500 transition-transform group-open:rotate-90"
          />
          <span className="min-w-0 flex-1">
            {entry.levelName ? (
              <span className="mr-1 text-xs tracking-wide text-slate-400 uppercase">
                {entry.levelName}
              </span>
            ) : null}
            {entry.label}
          </span>
        </summary>
        {/* 16px (ml-3 + pl-1) was too shallow to read as nesting once labels
            wrap. The guide line runs under the marker column and the child text
            lands past it. */}
        <div className="ml-2 border-l border-slate-800 pl-4">
          <DocLink entry={entry} />
          <EntryList entries={entry.children} parentKey={entryKey} {...{ isOpen, onToggle }} />
        </div>
      </details>
    </li>
  );
}

interface ListProps {
  entries: IndexEntry[];
  parentKey: string;
  isOpen: (key: string) => boolean;
  onToggle: (key: string, open: boolean) => void;
}

function EntryList({ entries, parentKey, isOpen, onToggle }: ListProps) {
  return (
    <ul className="space-y-1">
      {entries.map((entry, i) => (
        <EntryItem
          key={entry.docId ?? `${entry.label}-${i}`}
          entry={entry}
          entryKey={keyOf(parentKey, i)}
          isOpen={isOpen}
          onToggle={onToggle}
        />
      ))}
    </ul>
  );
}

interface Props {
  index: CourseIndex;
  /** The document being read; its ancestors are the groups that open. */
  activeId?: string;
}

/**
 * The course index as a tree. Groups start collapsed — the real syllabus is 51
 * topics across 14 groups, and all-expanded is a wall — except the path down to
 * the document being read. What the reader opens by hand wins over both, until
 * they navigate somewhere else.
 */
export function Toc({ index, activeId }: Props) {
  const [query, setQuery] = useState('');
  const filtering = query.trim() !== '';
  const entries = useMemo(
    () => filterIndex(index.entries, query, docLabel),
    [index.entries, query],
  );
  const matches = countDocuments(entries);

  const onPath = useMemo(
    () => new Set(ancestorsOf(index.entries, activeId) ?? []),
    [index, activeId],
  );
  // Reset on navigation: `onPath` is a fresh Set per document, so keying the
  // manual overrides to it drops them exactly when the path changes.
  const [toggled, setToggled] = useState<{ for: Set<string>; open: Map<string, boolean> }>({
    for: onPath,
    open: new Map(),
  });
  const overrides = toggled.for === onPath ? toggled.open : new Map<string, boolean>();

  // While filtering, everything kept is open: a match behind a closed triangle
  // is not a result. The manual overrides are ignored, not discarded, so
  // clearing the field returns the tree exactly as the reader left it.
  const isOpen = (key: string) => (filtering ? true : (overrides.get(key) ?? onPath.has(key)));
  const onToggle = (key: string, open: boolean) => {
    if (filtering || open === isOpen(key)) return;
    setToggled((prev) => {
      const next = new Map(prev.for === onPath ? prev.open : []);
      next.set(key, open);
      return { for: onPath, open: next };
    });
  };

  return (
    <nav aria-label="Course index" className="text-sm">
      <label className="mb-3 block">
        <span className="sr-only">Filtrar el índice</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrar…"
          className="w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-slate-100 placeholder:text-slate-500"
        />
      </label>
      {/* Announced, not just drawn: with 14 groups the reader cannot see at a
          glance whether a query found one thing or thirty. */}
      {filtering ? (
        <p role="status" className="mb-2 text-xs text-slate-400">
          {matches === 0
            ? `Nada coincide con «${query.trim()}»`
            : `${matches} ${matches === 1 ? 'documento' : 'documentos'}`}
        </p>
      ) : null}
      <EntryList entries={entries} parentKey="" isOpen={isOpen} onToggle={onToggle} />
    </nav>
  );
}
