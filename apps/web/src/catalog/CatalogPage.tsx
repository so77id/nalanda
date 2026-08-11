import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

interface Props {
  /** Optional breadcrumb back-link shown above the title. */
  back?: { to: string; label: string };
  children: ReactNode;
}

/** The shared page shell of every catalog surface (fourth use — extracted per style rule). */
export function CatalogPage({ back, children }: Props) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-950 px-8 py-10 text-slate-100">
      {back ? (
        <p className="text-sm">
          <Link to={back.to} className="text-sky-400 hover:underline">
            ← {back.label}
          </Link>
        </p>
      ) : null}
      {children}
    </main>
  );
}
