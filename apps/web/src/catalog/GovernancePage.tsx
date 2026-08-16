import { CatalogLayout } from './CatalogLayout';
import { families } from './families';

const CONTRACT_POINTS = [
  'Explicit render per mode — no component may ignore a mode (even if the answer is "I don\'t appear").',
  'Typed props schema (TypeScript) — the public contract.',
  'Mandatory catalog entry — usage docs, when-to-use, live examples. A PR adding a component without its entry fails review AND the completeness test.',
  'Reserved optional sync interface — which session event types it emits/consumes (ADR-0008), designed per component when needed.',
  'Client-side compute (ADR-0001) for any heavy work.',
  'Feature-toggle props — capabilities switch on/off per instance.',
  'Composition — abstract components may receive/render injected components.',
  'A component that marks a section renders the MDX-mapped h2 in book mode — in-document navigation reads the h2 elements the page PAINTED, not the source (ADR-0021). A <Slide> that stopped rendering its title would silently empty the section rail, with a green suite.',
  'Anything wider than running text marks itself .not-prose or .measure-full — the book view narrows prose to 39rem inside a 768px column and the rule is unlayered, so a max-w-* of your own cannot opt out (ADR-0022). Neither /catalog nor presentation mode applies the measure, so check it in a real document.',
];

const ADD_STEPS = [
  `Pick the family (${families.map((f) => f.name).join(', ')}) — or propose a family change here first.`,
  'Implement the component in src/components/<family id>/ — the id IS the folder name (#87), so there is no mapping to look up. Satisfy the contract points below.',
  'Register it in the shell MDX map (app/mdxComponents.ts). Not optional: the catalog and the MDX map are asserted to be the same set in both directions — for CAPITALISED keys, the names an author writes — so today a component that must not be document-facing does not get an entry either (ADR-0014 reserves an explicit opt-out for the composed-component case). An intrinsic element the shell maps to a component, such as pre to MdxPre, is registered and has no entry: that is by design, not an omission (ADR-0024).',
  'Write its colocated <Component>.catalog.tsx entry (CatalogEntry from lib/) and add it to the array in components/catalogEntries.ts. A forgotten entry is invisible to the catalog; app/mdxComponents.test.ts is what catches it ("missing catalog entry for <Name>"), not the entry-shape invariants. That module is deliberately not the components seam — the seam reaches it through loadCatalogEntries(), behind a dynamic import, because these pages are documentation for you and not payload for a student reading a course document (12.86 kB gzip of it, on every page, before #122).',
  'If the component carries a heavy dependency (an editor, a WASM toolchain): register a lazy<Name>.tsx wrapper instead of the component, and import that wrapper from the catalog entry too. The shell builds the MDX map eagerly, so ANY static import from it puts the whole dependency in the entry chunk — for CodeMirror that roughly doubles it (measured in ADR-0018 §7). Copy the "stays out of the entry chunk" case in src/architecture.test.ts for your component: that guard is per-component; a second, generic one walks what the shell reaches eagerly and fails on any package outside its allowlist — never widen that allowlist to go green.',
  "Test per-mode behavior (contract point 1 gives the concrete cases) plus the component's own logic.",
  'Run the review flow: the review checklist below is part of the PR review.',
];

const DOC_CHECKLIST = [
  'Entry complete: non-empty description and when-to-use, and every prop documented with a type and a description.',
  'At least two live examples that actually run, with distinct titles — covering both modes when the component behaves differently per mode.',
  'When-to-use says when NOT to use it too (what to prefer instead).',
];

const REVIEW_CHECKLIST = [
  'Every contract point verified (see Component contract).',
  'Catalog entry present and accurate — the catalog invariants test is green.',
  'Per-mode tests exist and pass; lint + build + full suite green.',
  'The integration guide steps were followed (docs/standards/integration-guides.md).',
];

/** /catalog/governance — the catalog's own rules (self-governing, ADR-0010). */
export function GovernancePage() {
  return (
    <CatalogLayout back={{ to: '/catalog', label: 'Catalog' }}>
      <h1 className="mt-4 text-4xl font-bold tracking-tight">Governance</h1>
      <p className="mt-3 text-ink-faint">
        The catalog governs itself (ADR-0010): these pages are the rules, and changing the rules
        goes through the process at the bottom.
      </p>

      <h2 className="mt-10 text-2xl font-semibold">How to add a component</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-ink-soft">
        {ADD_STEPS.map((step) => (
          <li key={step}>{step}</li>
        ))}
      </ol>

      <h2 className="mt-10 text-2xl font-semibold">Component contract</h2>
      <ol className="mt-3 list-decimal space-y-2 pl-6 text-ink-soft">
        {CONTRACT_POINTS.map((point) => (
          <li key={point}>{point}</li>
        ))}
      </ol>

      <h2 className="mt-10 text-2xl font-semibold">Documentation checklist</h2>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-ink-soft">
        {DOC_CHECKLIST.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="mt-10 text-2xl font-semibold">Review checklist</h2>
      <ul className="mt-3 list-disc space-y-2 pl-6 text-ink-soft">
        {REVIEW_CHECKLIST.map((item) => (
          <li key={item}>{item}</li>
        ))}
      </ul>

      <h2 className="mt-10 text-2xl font-semibold">Changing these rules</h2>
      <p className="mt-3 text-ink-soft">
        A PR that edits these governance pages, reviewed like any other change. If the change is
        architectural (new family, contract point added/removed, catalog mechanics), it also needs
        an ADR extending ADR-0010 — documentation ships in the same PR.
      </p>
    </CatalogLayout>
  );
}
