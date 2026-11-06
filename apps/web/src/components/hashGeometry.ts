/**
 * The heights a drawn hash table shares with the widget that animates one: the
 * hash recipe of `<SequenceStepper>` (`interactive/sequenceStepperHashLayout.ts`)
 * and the static `<ChainTable>` (`media/chainTableLayout.ts`). A class puts a
 * still table beside the widget and the reader compares them cell for cell, so
 * the cell and the two fields of a node are the same height in both — but
 * for the key field of the still table's `rut` size, two units taller for the
 * smaller face a RUT is drawn in (`CHAIN_TABLE_SIZES`).
 *
 * Only the heights: the still table is drawn at its own pitch — narrower for
 * a name, wider for a RUT — because a slide holds it beside prose, while the
 * widget has the slide to itself. Shared rather than copied because it WAS
 * copied: until #353 the figure was a component local to Tablas Hash and to
 * Set y Map, with these numbers typed into each by hand. It lives at the root
 * of `components/` because two families use it, the shape `treeGeometry.ts`
 * set.
 */

/** Height of a cell of the table's strip. */
export const HASH_CELL_H = 30;
/** Height of a node's key field. */
export const HASH_NODE_KEY_H = 22;
/** Height of a node's `next` field, where the reference to the next node starts. */
export const HASH_NODE_LINK_H = 12;
