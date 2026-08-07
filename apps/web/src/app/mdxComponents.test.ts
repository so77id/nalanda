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

describe('catalog completeness (ADR-0010 / ADR-0013)', () => {
  it('every registered MDX component has a catalog entry', () => {
    const componentNames = Object.keys(map).filter((key) => /^[A-Z]/.test(key));
    expect(componentNames.length).toBeGreaterThan(0);
    for (const name of componentNames) {
      expect(catalog.byName(name), `missing catalog entry for <${name}>`).toBeDefined();
    }
  });
});
