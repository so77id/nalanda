import { use } from 'react';
import { Link } from 'react-router-dom';

import { CatalogLayout } from './CatalogLayout';
import { componentCount } from './componentCount';
import { loadCatalog } from './registry';
import { EMPTY_FAMILY_REASON, families } from './families';

/** /catalog — the four families, their definitions, and entry counts. */
export function CatalogOverviewPage() {
  const catalog = use(loadCatalog());
  return (
    <CatalogLayout>
      <h1 className="text-accent-pop text-4xl font-bold tracking-tight">Catalog</h1>
      <p className="mt-3 text-ink-faint">
        The components a document can use — the platform&apos;s grammar (ADR-0010). Four editable
        families; every component ships its entry here.{' '}
        <Link to="/catalog/governance" className="text-accent hover:underline">
          Governance →
        </Link>
      </p>
      <ul className="mt-10 space-y-8">
        {families.map((family) => {
          const count = catalog.byFamily(family.id).length;
          return (
            <li key={family.id}>
              <div className="flex items-baseline gap-3">
                <h2 className="text-accent-pop text-2xl font-semibold">
                  {/* Coloured and underlined-on-hover like every other link here:
                      with only `hover:text-accent` the four family names were
                      indistinguishable from headings, and a keyboard user reached
                      them with no sign they led anywhere. */}
                  <Link to={`/catalog/${family.id}`} className="text-accent hover:underline">
                    {family.name}
                  </Link>
                </h2>
                <span className="text-sm text-ink-faint">{componentCount(count)}</span>
              </div>
              <p className="mt-1 text-ink-soft">{family.definition}</p>
              <p className="mt-1 text-sm text-ink-faint">{family.whatBelongs}</p>
              {/* Half the taxonomy is empty. Unexplained, that reads as a hole
                  in the page rather than as how this project works. */}
              {count === 0 && (
                <p className="mt-1 text-sm text-ink-faint italic">
                  Empty by design — {EMPTY_FAMILY_REASON}.
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </CatalogLayout>
  );
}
