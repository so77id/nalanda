import type { CatalogEntry } from '../lib/catalogEntry';

import { CatalogLayout } from './CatalogLayout';
import { ExampleBlock } from './ExampleBlock';
import { familyName } from './families';

interface Props {
  entry: CatalogEntry;
}

/** The component page template: description, when-to-use, props table, live examples. */
export function ComponentArticle({ entry }: Props) {
  // The id is the route; the name is what a reader is shown. The back link used
  // to carry the id and so read "structure" beside a page headed "Structure".
  return (
    <CatalogLayout back={{ to: `/catalog/${entry.family}`, label: familyName(entry.family) }}>
      <h1 className="text-accent-pop mt-4 text-4xl font-bold tracking-tight">{entry.name}</h1>
      <p className="mt-3 text-ink-soft">{entry.description}</p>
      <p className="mt-1 text-sm text-ink-faint">
        {/* The family id IS the folder name (#87) — no mapping to keep in sync. */}
        <code>
          src/components/{entry.family}/{entry.name}.tsx
        </code>
      </p>

      <h2 className="text-accent-pop mt-8 text-2xl font-semibold">When to use</h2>
      <p className="mt-2 text-ink-soft">{entry.whenToUse}</p>

      <h2 className="text-accent-pop mt-8 text-2xl font-semibold">Props</h2>
      {entry.props.length === 0 ? (
        <p className="mt-2 text-ink-faint">This component takes no props.</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-rule text-ink-faint">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Default</th>
              <th className="py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {entry.props.map((prop) => (
              <tr key={prop.name} className="border-b border-rule align-top">
                <td className="py-2 pr-4 font-mono">{prop.name}</td>
                <td className="py-2 pr-4 font-mono text-ink-faint">{prop.type}</td>
                <td className="py-2 pr-4 font-mono text-ink-faint">{prop.default ?? '—'}</td>
                <td className="py-2 text-ink-soft">{prop.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="text-accent-pop mt-8 text-2xl font-semibold">Examples</h2>
      {/* The catalog writes English; what it renders is the real component with
          real course content, so the snippets and the widgets' own chrome are
          Spanish. Stated here so the mix reads as the boundary it is (#87). */}
      <p className="mt-2 text-sm text-ink-faint">
        These run the real component. The snippets are course content and the widgets speak to
        students, so both are in Spanish — the catalog around them is not.
      </p>
      {entry.examples.map((example) => (
        <ExampleBlock key={example.title} title={example.title} code={example.code}>
          <example.render />
        </ExampleBlock>
      ))}
    </CatalogLayout>
  );
}
