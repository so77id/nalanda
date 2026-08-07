import { Link } from 'react-router-dom';

const CONTRACT_POINTS = [
  'Explicit render per mode — no component may ignore a mode (even if the answer is "I don\'t appear").',
  'Typed props schema (TypeScript) — the public contract.',
  'Mandatory catalog entry — usage docs, when-to-use, live examples. A PR adding a component without its entry fails review AND the completeness test.',
  'Reserved optional sync interface — which session event types it emits/consumes (ADR-0008), designed per component when needed.',
  'Client-side compute (ADR-0001) for any heavy work.',
  'Feature-toggle props — capabilities switch on/off per instance.',
  'Composition — abstract components may receive/render injected components.',
];

const ADD_STEPS = [
  'Pick the family (estructura, semánticos, interactivos, media) — or propose a family change here first.',
  'Implement the component in src/components/<family>/ satisfying the seven contract points below; register it in the shell MDX map (app/mdxComponents.ts) if documents use it directly.',
  'Write its colocated <Component>.catalog.tsx entry (CatalogEntry from lib/) and export it through the components seam — the completeness test enforces this.',
  "Test per-mode behavior (contract point 1 gives the concrete cases) plus the component's own logic.",
  'Run the review flow: the review checklist below is part of the PR review.',
];

const DOC_CHECKLIST = [
  'Entry complete: description, when-to-use, full props table (name, type, default, description).',
  'At least two live examples that actually run — covering both modes when the component behaves differently per mode.',
  'When-to-use says when NOT to use it too (what to prefer instead).',
];

const REVIEW_CHECKLIST = [
  'All seven contract points verified (see Component contract).',
  'Catalog entry present and accurate — the completeness test is green.',
  'Per-mode tests exist and pass; lint + build + full suite green.',
  'The integration guide steps were followed (docs/standards/integration-guides.md).',
];

/** /catalog/governance — the catalog's own rules (self-governing, ADR-0010). */
export function GovernancePage() {
  return (
    <main className="mx-auto min-h-screen max-w-3xl bg-slate-950 px-8 py-10 text-slate-100">
      <p className="text-sm">
        <Link to="/catalog" className="text-sky-400 hover:underline">
          ← Catalog
        </Link>
      </p>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">Governance</h1>
      <p className="mt-3 text-slate-400">
        The catalog governs itself (ADR-0010): these pages are the rules, and changing the rules
        goes through the process at the bottom.
      </p>

      <h2 className="mt-10 text-2xl font-semibold">How to add a component</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-slate-300">
        {ADD_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <h2 className="mt-10 text-2xl font-semibold">Component contract</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-slate-300">
        {CONTRACT_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>

      <h2 className="mt-10 text-2xl font-semibold">Documentation checklist</h2>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-slate-300">
        {DOC_CHECKLIST.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="mt-10 text-2xl font-semibold">Review checklist</h2>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-slate-300">
        {REVIEW_CHECKLIST.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="mt-10 text-2xl font-semibold">Changing these rules</h2>
      <p className="mt-3 text-slate-300">
        A PR that edits these governance pages, reviewed like any other change. If the change is
        architectural (new family, contract point added/removed, catalog mechanics), it also needs
        an ADR extending ADR-0010 — documentation ships in the same PR.
      </p>
    </main>
  );
}
