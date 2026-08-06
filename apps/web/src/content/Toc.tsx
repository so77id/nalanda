import { NavLink } from 'react-router-dom';

import type { CourseIndex, IndexEntry } from './courseIndex';
import { registry } from './registry';

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
    return <li>{<DocLink entry={entry} />}</li>;
  }
  return (
    <li>
      <details open>
        <summary className="cursor-pointer px-2 py-1 text-slate-100">
          {entry.levelName ? (
            <span className="mr-1 text-xs tracking-wide text-slate-400 uppercase">
              {entry.levelName}
            </span>
          ) : null}
          {entry.label}
        </summary>
        <div className="ml-3 border-l border-slate-800 pl-1">
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
