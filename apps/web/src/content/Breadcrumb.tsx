import { hasTrail } from './courseIndex';
import type { Trail } from './courseIndex';

interface Props {
  trail: Trail;
}

/**
 * Where the document sits: course › unit(s) · position. Everything is
 * optional — an unlisted document keeps the course crumb alone, and a trail
 * with nothing to say renders nothing rather than an empty bar.
 */
export function Breadcrumb({ trail }: Props) {
  const { course, ancestors, position } = trail;
  if (!hasTrail(trail)) return null;

  return (
    <nav aria-label="Location" className="min-w-0 text-sm text-slate-400">
      <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {course ? <li className="text-slate-300">{course}</li> : null}
        {ancestors.map((crumb) => (
          <li key={`${crumb.levelName ?? ''}-${crumb.label}`} className="flex items-center gap-1.5">
            <span aria-hidden="true">›</span>
            {crumb.levelName ? (
              <span className="text-xs tracking-wide text-slate-500 uppercase">
                {crumb.levelName}
              </span>
            ) : null}
            <span>{crumb.label}</span>
          </li>
        ))}
        {position ? (
          <li className="flex items-center gap-1.5 text-slate-500">
            <span aria-hidden="true">·</span>
            <span>{`${position.at} de ${position.of}`}</span>
          </li>
        ) : null}
      </ol>
    </nav>
  );
}
