import { describe, expect, it } from 'vitest';

import { isTypingTarget } from './typingTarget';

// The whole point of the predicate is to answer, at the deck's keydown
// listener, "is the reader typing?". Every case here is one node shape that
// listener actually meets. jsdom cannot execute CodeMirror, so the descendant
// case builds by hand the tree the browser produces (`.cm-editor > .cm-content
// > .cm-line`) — what matters is the ancestor walk, which the suite can judge.
describe('isTypingTarget', () => {
  it('is true for an <input>', () => {
    const input = document.createElement('input');
    expect(isTypingTarget(input)).toBe(true);
  });

  it('is true for a <textarea>', () => {
    const textarea = document.createElement('textarea');
    expect(isTypingTarget(textarea)).toBe(true);
  });

  it('is true for a <select>', () => {
    const select = document.createElement('select');
    expect(isTypingTarget(select)).toBe(true);
  });

  it('is true for an element with contenteditable="true"', () => {
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', 'true');
    expect(isTypingTarget(editable)).toBe(true);
  });

  it('is true for an element with a bare contenteditable attribute', () => {
    // `<div contenteditable>` — the empty-string form the HTML spec treats the
    // same as "true". A predicate that only matched `="true"` missed it.
    const editable = document.createElement('div');
    editable.setAttribute('contenteditable', '');
    expect(isTypingTarget(editable)).toBe(true);
  });

  it('is true for a descendant of a contenteditable ancestor', () => {
    // The shape CodeMirror produces: the real keydown target is an inner
    // <span class="cm-line">, not the .cm-content wrapper that carries the
    // attribute. A predicate that only looked at the target itself missed it.
    const editor = document.createElement('div');
    editor.className = 'cm-editor';
    const content = document.createElement('div');
    content.className = 'cm-content';
    content.setAttribute('contenteditable', 'true');
    const line = document.createElement('span');
    line.className = 'cm-line';
    content.append(line);
    editor.append(content);
    document.body.append(editor);

    expect(isTypingTarget(line)).toBe(true);

    editor.remove();
  });

  it('is false for a plain <div>', () => {
    const div = document.createElement('div');
    expect(isTypingTarget(div)).toBe(false);
  });

  it('is false for null', () => {
    expect(isTypingTarget(null)).toBe(false);
  });

  it('is false for a target that is not an Element (like window)', () => {
    // The other presentation-route cases fire keydown at `window`, which is not
    // an Element. If the predicate said `true` for that, EVERY existing case
    // would see the guard swallow the key and go red.
    expect(isTypingTarget(window)).toBe(false);
  });

  it('is false for a descendant of a contenteditable="false" ancestor', () => {
    // The negative form of contenteditable — an author disabling editing on a
    // subtree. Not something the deck cares about in practice, but the
    // predicate must not confuse it with an enabled region.
    const outer = document.createElement('div');
    outer.setAttribute('contenteditable', 'false');
    const inner = document.createElement('span');
    outer.append(inner);
    document.body.append(outer);

    expect(isTypingTarget(inner)).toBe(false);

    outer.remove();
  });
});
