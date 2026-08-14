import { ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { NavLink } from 'react-router-dom';

import { ancestorsOf, countDocuments, filterIndex, keyOf } from './courseIndex';
import type { CourseIndex, IndexEntry } from './courseIndex';
import { registry } from './liveContent';

// The empty override set, named so that `overrides` below reads as a decision
// ("nothing recorded for this situation") rather than as an allocation.
const NO_OVERRIDES: ReadonlyMap<string, boolean> = new Map();

function docLabel(entry: IndexEntry): string {
  if (entry.label) return entry.label;
  if (entry.docId) return registry.get(entry.docId)?.meta.title ?? entry.docId;
  return '';
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
          ? 'block rounded bg-sunk px-2 py-1 font-medium text-accent'
          : 'block rounded px-2 py-1 text-ink-soft hover:bg-sunk/60'
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
        <summary className="flex cursor-pointer list-none items-start gap-1.5 rounded px-2 py-1 text-ink hover:bg-sunk/60 [&::-webkit-details-marker]:hidden">
          <ChevronRight
            size={14}
            aria-hidden="true"
            className="mt-1 shrink-0 text-ink-faint transition-transform group-open:rotate-90"
          />
          <span className="min-w-0 flex-1">
            {entry.levelName ? (
              <span className="mr-1 text-xs tracking-wide text-ink-faint uppercase">
                {entry.levelName}
              </span>
            ) : null}
            {/* docLabel, not entry.label: an entry with children AND a docId is
                index-legal without a label, and rendered raw it is a chevron
                with no name — while the filter still matches its registry title. */}
            {docLabel(entry)}
          </span>
        </summary>
        {/* 16px (ml-3 + pl-1) was too shallow to read as nesting once labels
            wrap. The guide line runs under the marker column and the child text
            lands past it. */}
        <div className="ml-2 border-l border-rule pl-4">
          <DocLink entry={entry} />
          <EntryList
            entries={entry.children}
            parentKey={entryKey}
            isOpen={isOpen}
            onToggle={onToggle}
          />
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
    [index.entries, activeId],
  );

  // What the reader opened or closed by hand, and the situation they did it in.
  // Keyed by VALUES, never by the identity of the memo above: React documents
  // useMemo as a performance optimization, not a semantic guarantee, so a
  // dropped cache would silently discard the reader's tree.
  const situation = `${activeId ?? ''}\u0000${query.trim()}`;
  const [toggled, setToggled] = useState<{ for: string; open: Map<string, boolean> }>({
    for: situation,
    open: new Map(),
  });
  const overrides = toggled.for === situation ? toggled.open : NO_OVERRIDES;

  // Filtering opens everything it kept — a match behind a closed triangle is
  // not a result — but a group the reader then shuts must STAY shut, or the
  // controlled <details> and the DOM disagree and the node never reopens.
  // Navigating, or changing the query, starts a new situation and forgets both.
  const isOpen = (key: string) => overrides.get(key) ?? (filtering || onPath.has(key));
  const onToggle = (key: string, open: boolean) => {
    if (open === isOpen(key)) return;
    setToggled((prev) => {
      const next = new Map(prev.for === situation ? prev.open : []);
      next.set(key, open);
      return { for: situation, open: next };
    });
  };

  return (
    <nav aria-label="Índice del curso" className="text-sm">
      <label className="mb-3 block">
        <span className="sr-only">Filtrar el índice</span>
        <input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filtrar…"
          className="w-full rounded border border-rule bg-surface px-2 py-1 text-ink placeholder:text-ink-faint"
        />
      </label>
      {/* Announced, not just drawn: with 14 groups the reader cannot see at a
          glance whether a query found one thing or thirty. */}
      {filtering ? (
        <p role="status" className="mb-2 text-xs text-ink-faint">
          {matches === 0
            ? `Nada coincide con «${query.trim()}»`
            : `${matches} ${matches === 1 ? 'documento' : 'documentos'}`}
        </p>
      ) : null}
      <EntryList entries={entries} parentKey="" isOpen={isOpen} onToggle={onToggle} />
    </nav>
  );
}
