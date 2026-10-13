/**
 * The size of a drawn binary tree, shared by the two things that draw one: the
 * tree recipes of `<SequenceStepper>` (`interactive/sequenceStepperTreeLayout.ts`)
 * and the static `<BinaryPicture>` (`media/binaryPictureLayout.ts`). A class
 * puts a figure and the widget side by side and the reader compares them node
 * for node, so the two must draw the same tree at the same size.
 *
 * Shared rather than copied because it WAS copied: until #322 the figure was a
 * component local to each of the two tree documents, with these numbers typed
 * into it by hand and a comment at both ends asking the next author to keep
 * them in step — a copy nothing tested, so a moved constant showed only in a
 * browser. It lives at the root of `components/` because two families use it
 * (`frontend-code-style.md`), the shape `slideBudget.ts` set.
 */

/** Radius of a node. */
export const TREE_NODE_R = 17;
/** Horizontal room per column: a node sits in the column of its inorder position. */
export const TREE_COLUMN_W = 46;
/** Vertical distance between two levels. */
export const TREE_LEVEL_H = 56;
/** Margin around the drawing, room for a badge beside a node. */
export const TREE_PAD = 16;
/** Width and height of a strip slot, one per column, under the tree. */
export const TREE_SLOT_W = 38;
export const TREE_SLOT_H = 30;
