import { describe, expect, it } from 'vitest';

import { catalog } from '../catalog';
import { SectionBreak, Slide } from '../components';
import { mdxComponents } from './mdxComponents';

const map: Record<string, unknown> = mdxComponents;

describe('shell MDX components map', () => {
  it('registers the structural markers so documents use them without imports', () => {
    expect(map['Slide']).toBe(Slide);
    expect(map['SectionBreak']).toBe(SectionBreak);
  });

  it('keeps the content mappings (links and anchor headings)', () => {
    for (const key of ['a', 'h2', 'h3', 'h4']) {
      expect(map[key], `missing mapping for ${key}`).toBeDefined();
    }
  });
});

// The MDX map and the catalog must stay in lockstep in BOTH directions. This
// pair lives in app/ because features may not import app/; the entry-shape
// invariants live in catalog/architecture.test.tsx.
describe('catalog completeness (ADR-0010 / ADR-0013)', () => {
  const componentNames = Object.keys(map).filter((key) => /^[A-Z]/.test(key));

  it('the MDX map registers components (guards against a vacuous check)', () => {
    expect(componentNames.length).toBeGreaterThan(0);
  });

  it('every registered MDX component has a catalog entry', () => {
    for (const name of componentNames) {
      expect(catalog.byName(name), `missing catalog entry for <${name}>`).toBeDefined();
    }
  });

  it('every catalog entry is a registered MDX component', () => {
    for (const entry of catalog.entries) {
      expect(
        componentNames,
        `catalog entry <${entry.name}> is documented but not registered in the MDX map`,
      ).toContain(entry.name);
    }
  });
});
