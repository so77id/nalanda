import { Link } from 'react-router-dom';

import type { CatalogEntry } from '../lib/catalogEntry';

import { ExampleBlock } from './ExampleBlock';

interface Props {
  entry: CatalogEntry;
}

/** The component page template: description, when-to-use, props table, live examples. */
export function ComponentArticle({ entry }: Props) {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-950 px-8 py-10 text-slate-100">
      <p className="text-sm">
        <Link to={`/catalog/${entry.family}`} className="text-sky-400 hover:underline">
          ← {entry.family}
        </Link>
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">{entry.name}</h1>
      <p className="mt-3 text-slate-300">{entry.description}</p>

      <h2 className="mt-8 text-2xl font-semibold">When to use</h2>
      <p className="mt-2 text-slate-300">{entry.whenToUse}</p>

      <h2 className="mt-8 text-2xl font-semibold">Props</h2>
      {entry.props.length === 0 ? (
        <p className="mt-2 text-slate-500">This component takes no props.</p>
      ) : (
        <table className="mt-2 w-full text-left text-sm">
          <thead>
            <tr className="border-b border-slate-700 text-slate-400">
              <th className="py-2 pr-4">Name</th>
              <th className="py-2 pr-4">Type</th>
              <th className="py-2 pr-4">Default</th>
              <th className="py-2">Description</th>
            </tr>
          </thead>
          <tbody>
            {entry.props.map((prop) => (
              <tr key={prop.name} className="border-b border-slate-800 align-top">
                <td className="py-2 pr-4 font-mono">{prop.name}</td>
                <td className="py-2 pr-4 font-mono text-slate-400">{prop.type}</td>
                <td className="py-2 pr-4 font-mono text-slate-400">{prop.default ?? '—'}</td>
                <td className="py-2 text-slate-300">{prop.description}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 className="mt-8 text-2xl font-semibold">Examples</h2>
      {entry.examples.map((example) => (
        <ExampleBlock key={example.title} title={example.title} code={example.code}>
          {example.render()}
        </ExampleBlock>
      ))}
    </main>
  );
}
