import type { ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';

import { CatalogLayout } from './CatalogLayout';
import { catalog } from './registry';
import { EMPTY_FAMILY_REASON, families } from './families';

interface Props {
  /** Rendered when the family id is unknown — injected by the shell. */
  notFound: ReactNode;
}

/** /catalog/:family — the family definition and its components. */
export function FamilyPage({ notFound }: Props) {
  const { family: familyId = '' } = useParams();
  const family = families.find((f) => f.id === familyId);

  if (!family) return <>{notFound}</>;
  const entries = catalog.byFamily(family.id);
  return (
    <CatalogLayout back={{ to: '/catalog', label: 'Catalog' }}>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{family.name}</h1>
      <p className="mt-3 text-slate-300">{family.definition}</p>
      <p className="mt-1 text-sm text-slate-500">{family.whatBelongs}</p>
      <p className="mt-1 text-sm text-slate-500">
        {/* An empty family has no folder yet — the first component added to it
            creates one. Claiming otherwise pointed readers at a missing path. */}
        Components {entries.length === 0 ? 'will live' : 'live'} in{' '}
        <code>src/components/{family.id}/</code>.
      </p>
      {entries.length === 0 ? (
        <p className="mt-10 text-slate-500">
          Nothing lives here yet, and that is the plan: {EMPTY_FAMILY_REASON} (ADR-0010). An empty
          family is a family nobody has needed, not one waiting to be filled.
        </p>
      ) : (
        <ul className="mt-10 space-y-4">
          {entries.map((entry) => (
            <li key={entry.name}>
              <Link
                to={`/catalog/c/${entry.name}`}
                className="text-xl text-sky-300 hover:underline"
              >
                {entry.name}
              </Link>
              <p className="text-slate-400">{entry.description}</p>
            </li>
          ))}
        </ul>
      )}
    </CatalogLayout>
  );
}
