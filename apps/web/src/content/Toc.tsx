import { ChevronRight } from 'lucide-react';
import { NavLink } from 'react-router-dom';

import type { CourseIndex, IndexEntry } from './courseIndex';
import { registry } from './liveContent';

function docLabel(entry: IndexEntry): string {
  if (entry.label) return entry.label;
  if (entry.docId) return registry.get(entry.docId)?.meta.title ?? entry.docId;
  return '';
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

function EntryItem({ entry }: { entry: IndexEntry }) {
  if (!entry.children) {
    return (
      <li>
        <DocLink entry={entry} />
      </li>
    );
  }
  return (
    <li>
      <details className="group" open>
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
          <EntryList entries={entry.children} />
        </div>
      </details>
    </li>
  );
}

function EntryList({ entries }: { entries: IndexEntry[] }) {
  return (
    <ul className="space-y-1">
      {entries.map((entry, i) => (
        <EntryItem key={entry.docId ?? `${entry.label}-${i}`} entry={entry} />
      ))}
    </ul>
  );
}

interface Props {
  index: CourseIndex;
}

/** Collapsible table of contents over the course index; the current document is highlighted. */
export function Toc({ index }: Props) {
  return (
    <nav aria-label="Course index" className="text-sm">
      <EntryList entries={index.entries} />
    </nav>
  );
}
