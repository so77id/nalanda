/**
 * The text of the figures this family draws in SVG (`<StepBoxes>`,
 * `<ChainTable>`): a part between backticks is drawn in the code face, as the
 * course writes code in prose, and a caption is measured by what it shows, its
 * backticks left out. Private to the family (frontend-code-style.md §Folder
 * layout). A course document cannot import it, so
 * `content/courses/sample-course/24-edd-set-map.mdx` keeps a copy of both
 * (`codeText`, `captionWidth`). That copy is the one that fails late — nothing
 * tests it, and a drift shows only as its captions drawn or measured unlike
 * these figures' — so a change here is carried there.
 */

/** What one caption character takes, in the figure's units, to widen the canvas for it. */
const CAPTION_CHAR_W = 6.6;

/** `text` with each part between backticks in the code face: `el objeto \`a\``. No text draws nothing. */
export function codeText(text: string | undefined) {
  return (text ?? '').split(/(`[^`]+`)/).map((part, i) =>
    part.startsWith('`') ? (
      <tspan key={i} fontFamily="var(--font-mono, monospace)" fontWeight="700">
        {part.slice(1, -1)}
      </tspan>
    ) : (
      part
    ),
  );
}

/** The width a caption asks of its canvas: 0 for no caption. */
export function captionWidth(caption: string | undefined): number {
  return caption ? caption.replace(/`/g, '').length * CAPTION_CHAR_W + 24 : 0;
}
