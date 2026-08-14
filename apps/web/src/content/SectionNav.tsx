import type { Section } from './useSections';

interface Props {
  sections: Section[];
  activeId: string | undefined;
  /** Called after a section link is followed — the drawer closes on it; the rail ignores it. */
  onNavigate?: () => void;
}

/**
 * The sections of the current document, as links to their anchors. The single
 * renderer of the spine `useSections` produces (ADR-0021): the rail and the
 * drawer place it differently, neither owns it.
 */
export function SectionNav({ sections, activeId, onNavigate }: Props) {
  if (sections.length === 0) return null;

  return (
    <nav aria-label="En esta página" className="text-sm">
      <p className="mb-2 text-xs font-medium tracking-wide text-ink-faint uppercase">
        En esta página
      </p>
      <ol className="space-y-1">
        {sections.map((section) => (
          <li key={section.id}>
            {/* A plain anchor, not a router Link: the fragment is the whole
                navigation, and the browser's own scroll is what we want. */}
            <a
              href={`#${section.id}`}
              aria-current={section.id === activeId ? 'true' : undefined}
              onClick={onNavigate}
              className={
                section.id === activeId
                  ? 'block border-l-2 border-accent py-0.5 pl-3 text-accent'
                  : 'block border-l-2 border-transparent py-0.5 pl-3 text-ink-faint hover:border-rule-strong hover:text-ink-soft'
              }
            >
              {section.text}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
