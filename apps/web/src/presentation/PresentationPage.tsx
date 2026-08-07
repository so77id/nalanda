import { Suspense, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useParams } from 'react-router-dom';

import { lazyDocumentComponent, registry } from '../content';
import { ModeProvider } from './ModeProvider';
import { SlideDeck } from './SlideDeck';

interface Props {
  /** Rendered when the id is unknown — injected by the shell so the feature never imports app/. */
  notFound: ReactNode;
}

/**
 * Presentation route: renders the document with an MDX wrapper that hands the
 * rendered children to the SlideDeck instead of painting them as a page.
 */
export function PresentationPage({ notFound }: Props) {
  const { id = '' } = useParams();
  const entry = registry.get(id);

  const components = useMemo(() => {
    if (!entry) return undefined;
    const { id: docId, title } = entry.meta;
    function DeckWrapper({ children }: { children?: ReactNode }) {
      return (
        <SlideDeck docId={docId} title={title}>
          {children}
        </SlideDeck>
      );
    }
    return { wrapper: DeckWrapper };
  }, [entry]);

  if (!entry) return <>{notFound}</>;
  const Doc = lazyDocumentComponent(entry);
  return (
    <ModeProvider mode="presentation">
      <Suspense fallback={null}>
        <Doc components={components} />
      </Suspense>
    </ModeProvider>
  );
}
