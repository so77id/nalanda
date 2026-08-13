import { describe, expect, it } from 'vitest';

import { placeholderClass } from './placeholder';

describe('the placeholder while the editor chunk arrives', () => {
  it('draws its own frame when nothing else does', () => {
    expect(placeholderClass(false)).toContain('border');
  });

  // Without this, a fence in a SideBySide column showed the doubled border for
  // the whole of the fetch — the exact thing `embedded` exists to remove, on
  // display for the one moment the reader has nothing else to look at.
  it('draws no frame inside something that already frames it', () => {
    expect(placeholderClass(true)).not.toContain('border');
    expect(placeholderClass(true)).not.toContain('rounded');
  });

  // It still has to occupy space: a zero-height placeholder means the whole
  // document reflows when each editor lands.
  it('reserves height either way', () => {
    expect(placeholderClass(true)).toContain('h-40');
    expect(placeholderClass(false)).toContain('h-40');
  });
});
