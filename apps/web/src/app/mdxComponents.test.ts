import { describe, expect, it } from 'vitest';

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
