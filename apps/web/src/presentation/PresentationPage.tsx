import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { registry } from '../content';
import { ModeProvider } from './ModeProvider';

interface Props {
  /** Rendered when the id is unknown — injected by the shell so the feature never imports app/. */
  notFound: ReactNode;
}

/** Presentation route for a document. Placeholder viewer until S4 delivers the real one. */
export function PresentationPage({ notFound }: Props) {
  const { id = '' } = useParams();
  const entry = registry.get(id);

  if (!entry) return <>{notFound}</>;
  return (
    <ModeProvider mode="presentation">
      <div className="fixed inset-0 z-40 flex flex-col items-center justify-center bg-slate-950 text-slate-100">
        <h1 className="text-5xl font-bold tracking-tight">{entry.meta.title}</h1>
        <p className="mt-4 text-slate-400">Presentation mode</p>
      </div>
    </ModeProvider>
  );
}
