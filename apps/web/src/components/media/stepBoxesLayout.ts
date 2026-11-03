import { captionWidth } from './figureText';

/**
 * Where `<StepBoxes>` puts its boxes and the steps between them, as numbers the
 * suite can check rather than a drawing it cannot see (apps/web/CLAUDE.md: the
 * way out is to not measure). The numbers are the ones the two file-local
 * copies typed by hand in Tablas Hash and Set y Map, so the promoted figure
 * draws those slides as they were.
 */

/** Height of a box. */
export const STEP_BOX_H = 44;
/** Room between two boxes, where the step is written over its arrow. */
export const STEP_GAP = 150;
/** Default width of a box: a short key or a position. */
export const STEP_BOX_W = 120;

const PAD = 14;
/** Room above the boxes for their titles. */
const TOP = 26;

export interface StepBoxesLayout {
  width: number;
  height: number;
  /** The y of every box's top edge. */
  top: number;
  boxW: number;
  boxH: number;
  gap: number;
  /** The x of each box's left edge, in order. */
  boxX: number[];
}

export function stepBoxesLayout(
  boxCount: number,
  boxWidth: number = STEP_BOX_W,
  caption?: string,
): StepBoxesLayout {
  const core = 2 * PAD + boxCount * boxWidth + (boxCount - 1) * STEP_GAP;
  const width = Math.max(core, captionWidth(caption));
  const left = (width - core) / 2 + PAD;
  const height = TOP + STEP_BOX_H + (caption ? 40 : 12);
  const boxX = Array.from({ length: boxCount }, (_, i) => left + i * (boxWidth + STEP_GAP));
  return { width, height, top: TOP, boxW: boxWidth, boxH: STEP_BOX_H, gap: STEP_GAP, boxX };
}
