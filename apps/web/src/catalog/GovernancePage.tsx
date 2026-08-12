import { CatalogLayout } from './CatalogLayout';
import { families } from './families';

// Derived, never retyped: a new family updates this page automatically.
const FAMILY_FOLDERS = families.map((f) => `${f.name} → ${f.folder}/`).join(', ');

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
  `Pick the family (${families.map((f) => f.name).join(', ')}) — or propose a family change here first.`,
  `Implement the component in its family folder under src/components/ (${FAMILY_FOLDERS}), satisfying the seven contract points below.`,
  'Register it in the shell MDX map (app/mdxComponents.ts). Not optional: the catalog and the MDX map are asserted to be the same set in both directions, so today a component that must not be document-facing does not get an entry either (ADR-0014 reserves an explicit opt-out for the composed-component case).',
  'Write its colocated <Component>.catalog.tsx entry (CatalogEntry from lib/) and add it to catalogEntries in the components seam. A forgotten export makes the entry invisible to the catalog; app/mdxComponents.test.ts is what catches it ("missing catalog entry for <Name>"), not the entry-shape invariants.',
  'If the component carries a heavy dependency (an editor, a WASM toolchain): register a lazy<Name>.tsx wrapper instead of the component, and import that wrapper from the catalog entry too. The shell builds both the MDX map and catalogEntries eagerly, so ANY static import from either puts the whole dependency in the entry chunk — measured 478kB to 891kB for CodeMirror (ADR-0018 §7). Copy the "stays out of the entry chunk" case in src/architecture.test.ts for your component: that guard is per-component, not generic.',
  "Test per-mode behavior (contract point 1 gives the concrete cases) plus the component's own logic.",
  'Run the review flow: the review checklist below is part of the PR review.',
];

const DOC_CHECKLIST = [
  'Entry complete: non-empty description and when-to-use, and every prop documented with a type and a description.',
  'At least two live examples that actually run, with distinct titles — covering both modes when the component behaves differently per mode.',
  'When-to-use says when NOT to use it too (what to prefer instead).',
];

const REVIEW_CHECKLIST = [
  'All seven contract points verified (see Component contract).',
  'Catalog entry present and accurate — the catalog invariants test is green.',
  'Per-mode tests exist and pass; lint + build + full suite green.',
  'The integration guide steps were followed (docs/standards/integration-guides.md).',
];

/** /catalog/governance — the catalog's own rules (self-governing, ADR-0010). */
export function GovernancePage() {
  return (
    <CatalogLayout back={{ to: '/catalog', label: 'Catalog' }}>
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
    </CatalogLayout>
  );
}
