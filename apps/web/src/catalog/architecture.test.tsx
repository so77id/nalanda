import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { catalog } from './registry';
import { EMPTY_FAMILY_REASON, families } from './families';

// Also spelled out in app/catalogRoute.test.tsx, which guards the rendered
// pages. Two lines, two levels, no production module for a test-only concern.
const SPANISH_ORTHOGRAPHY = /[áéíóúüñ¿¡]/i;

// The catalog publishes each component's source path; this proves it resolves.
const componentModules = import.meta.glob('../components/*/*.tsx');

// L4 invariants over the live catalog (testing-strategy.md). These enforce the
// documentation checklist the governance page publishes — without them the
// checklist would be review-only, and a hollow entry would ship green.
// The MDX-map <-> catalog binding lives in app/mdxComponents.test.ts instead:
// features may not import app/, so only the shell can hold that pair.
describe('architecture: catalog entry invariants', () => {
  it('the catalog is not empty (guards against a vacuous suite)', () => {
    expect(catalog.entries.length).toBeGreaterThan(0);
  });

  it('names its families in English — the id is the route segment and the folder', () => {
    // The id was Spanish and the folder English, which is what made folderOf()
    // exist. One word now does both jobs, so there is nothing left to keep in
    // sync; the per-entry glob below is what proves the folder really is there.
    expect(families.map((f) => f.id)).toEqual(['structure', 'semantic', 'interactive', 'media']);
  });

  // #87: /catalog ships with the site but addresses component authors, which is
  // why the root CLAUDE.md §Language names it as the one English surface. This
  // guard covers the REGISTRY DATA only — the taxonomy and the catalog entries.
  // The words the pages themselves write are guarded where they are rendered
  // (app/catalogRoute.test.tsx), because only there can the deliberately
  // Spanish live examples be excluded.
  //
  // Two limits, both deliberate. It catches Spanish orthography, not Spanish:
  // "Un ejercicio completo" carries no accent and would pass. And it stops at
  // the data — an earlier version claimed to cover "the prose the catalog
  // authors" while reading neither the pages nor EMPTY_FAMILY_REASON, a string
  // in this very module that slipped through with accents intact.
  it('keeps Spanish orthography out of the registry data', () => {
    const prose = [
      EMPTY_FAMILY_REASON,
      ...families.flatMap((f) => [f.name, f.definition, f.whatBelongs]),
      ...catalog.entries.flatMap((e) => [
        e.description,
        e.whenToUse,
        ...e.props.map((p) => p.description),
        ...e.examples.map((x) => x.title),
      ]),
    ];
    for (const text of prose) {
      expect(text, `Spanish in catalog prose: "${text}"`).not.toMatch(SPANISH_ORTHOGRAPHY);
    }
  });

  it('every family in the taxonomy has a definition', () => {
    for (const family of families) {
      expect(family.name.trim(), `family ${family.id} needs a name`).not.toBe('');
      expect(family.definition.trim(), `family ${family.id} needs a definition`).not.toBe('');
    }
  });

  for (const entry of catalog.entries) {
    describe(entry.name, () => {
      it('documents description and when-to-use', () => {
        expect(entry.description.trim()).not.toBe('');
        expect(entry.whenToUse.trim()).not.toBe('');
      });

      it('belongs to a known family', () => {
        expect(families.map((f) => f.id)).toContain(entry.family);
      });

      it('the source path the catalog publishes actually exists', () => {
        expect(Object.keys(componentModules)).toContain(
          `../components/${entry.family}/${entry.name}.tsx`,
        );
      });

      it('documents every prop fully', () => {
        for (const prop of entry.props) {
          expect(prop.name.trim(), 'prop needs a name').not.toBe('');
          expect(prop.type.trim(), `prop ${prop.name} needs a type`).not.toBe('');
          expect(prop.description.trim(), `prop ${prop.name} needs a description`).not.toBe('');
        }
      });

      it('ships at least two examples with distinct titles', () => {
        expect(entry.examples.length).toBeGreaterThanOrEqual(2);
        const titles = entry.examples.map((e) => e.title);
        expect(new Set(titles).size, `duplicate example titles: ${titles.join(', ')}`).toBe(
          titles.length,
        );
      });

      for (const example of entry.examples) {
        it(`renders live output for "${example.title}"`, () => {
          const Example = example.render;
          const { container } = render(
            <MemoryRouter>
              <Example />
            </MemoryRouter>,
          );
          expect(container, 'the example rendered nothing').not.toBeEmptyDOMElement();
          expect(example.code.trim(), 'the example needs a source snippet').not.toBe('');
        });
      }
    });
  }
});
