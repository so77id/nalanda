import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  /** Optional breadcrumb back-link shown above the title. */
  back?: { to: string; label: string };
  children: ReactNode;
}

/** The shared layout of every catalog surface (not a route — those are the *Page files). */
export function CatalogLayout({ back, children }: Props) {
  return (
    // The background belongs to the page, not to the reading column: putting it
    // on the max-w-3xl <main> leaves the rest of a wide viewport unpainted.
    <div className="min-h-screen bg-ground text-ink">
      <main className="mx-auto max-w-3xl px-8 py-10">
        {back ? (
          <p className="text-sm">
            <Link to={back.to} className="text-accent hover:underline">
              ← {back.label}
            </Link>
          </p>
        ) : null}
        {children}
      </main>
    </div>
  );
}
