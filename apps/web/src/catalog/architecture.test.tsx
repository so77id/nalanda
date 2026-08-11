import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';

import { catalog } from './registry';
import { families } from './families';

// L4 invariants over the live catalog (testing-strategy.md). These enforce the
// documentation checklist the governance page publishes — without them the
// checklist would be review-only, and a hollow entry would ship green.
// The MDX-map <-> catalog binding lives in app/mdxComponents.test.ts instead:
// features may not import app/, so only the shell can hold that pair.
describe('architecture: catalog entry invariants', () => {
  it('the catalog is not empty (guards against a vacuous suite)', () => {
    expect(catalog.entries.length).toBeGreaterThan(0);
  });

  it('every family in the taxonomy has a definition and a components folder', () => {
    for (const family of families) {
      expect(family.name.trim(), `family ${family.id} needs a name`).not.toBe('');
      expect(family.folder.trim(), `family ${family.id} needs a folder`).not.toBe('');
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
