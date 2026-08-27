// Standard form fields the browser sends every keystroke to before we see it.
const FORM_FIELD_TAGS = new Set(['INPUT', 'TEXTAREA', 'SELECT']);

// Both spellings the HTML spec accepts for "editing on": `contenteditable="true"`
// and the empty-string form `<div contenteditable>`. `false` deliberately isn't
// here — an author disabling editing on a subtree is not typing.
const CONTENTEDITABLE_ON_SELECTOR = '[contenteditable="true"], [contenteditable=""]';

/**
 * Whether a keydown originated somewhere the reader is composing text — a form
 * field, or anywhere inside a contenteditable region. `.closest` walks up
 * because a rich editor's real target is a descendant of the editable root:
 * CodeMirror fires at an inner `<span class="cm-line">`, not at the
 * `.cm-content` node that carries the `contenteditable` attribute.
 *
 * Returns `false` for anything that is not an Element (null, `window`) — the
 * deck's existing keydown cases fire at `window`, and a `true` there would make
 * the guard swallow every key on every slide.
 */
export function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  if (FORM_FIELD_TAGS.has(target.tagName)) return true;
  return target.closest(CONTENTEDITABLE_ON_SELECTOR) !== null;
}
