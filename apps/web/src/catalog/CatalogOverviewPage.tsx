import { Link } from 'react-router-dom';

import { CatalogPage } from './CatalogPage';
import { catalog } from './registry';
import { families } from './families';

/** /catalog — the four families, their definitions, and entry counts. */
export function CatalogOverviewPage() {
  return (
    <CatalogPage>
      <h1 className="text-4xl font-bold tracking-tight">Catalog</h1>
      <p className="mt-3 text-slate-400">
        The components a document can use — the platform&apos;s grammar (ADR-0010). Four editable
        families; every component ships its entry here.{' '}
        <Link to="/catalog/governance" className="text-sky-400 hover:underline">
          Governance →
        </Link>
      </p>
      <ul className="mt-10 space-y-8">
        {families.map((family) => (
          <li key={family.id}>
            <div className="flex items-baseline gap-3">
              <h2 className="text-2xl font-semibold">
                <Link to={`/catalog/${family.id}`} className="hover:text-sky-300">
                  {family.name}
                </Link>
              </h2>
              <span className="text-sm text-slate-500">
                {catalog.byFamily(family.id).length} component(s)
              </span>
            </div>
            <p className="mt-1 text-slate-300">{family.definition}</p>
            <p className="mt-1 text-sm text-slate-500">{family.whatBelongs}</p>
          </li>
        ))}
      </ul>
    </CatalogPage>
  );
}
