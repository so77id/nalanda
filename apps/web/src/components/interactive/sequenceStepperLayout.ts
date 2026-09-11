/**
 * Geometry for `<SequenceStepper>` (ADR-0074), as a pure module.
 *
 * The widget draws its structure as one hand-written SVG — no layout library —
 * and every coordinate it paints comes from here. That is the recipe
 * `apps/web/CLAUDE.md` §2 prescribes: geometry a component COMPUTES lives in a
 * module the suite can check exactly, so jsdom never has to fake a
 * measurement and the browser is left to confirm only that it looks right.
 *
 * The viewBox is sized to the content and the SVG scales to its container, so
 * a longer structure shrinks rather than overflowing — the page never gets a
 * horizontal scrollbar of its own (rule 6 of the widget guide).
 */

import type { SequenceRecipe } from './sequenceStepperTrace';

/** A cell of an array, or the value half of a list node. */
export const BOX_W = 44;
export const BOX_H = 40;
/** The `next` half of a list node — the pointer field. */
export const LINK_W = 16;
/** Horizontal room between two nodes, where the arrow is drawn. */
export const LIST_GAP = 34;
/** Vertical room above the structure for the walking-pointer arrows. */
export const POINTER_BAND = 46;
/**
 * Horizontal room to the LEFT of a chain, where `head` sits with an arrow
 * pointing across into the first node. Drawn sideways rather than from above
 * so it never shares the band with the floating node, which arrives directly
 * over the slot it is about to occupy — at the front, which is exactly where
 * `head` used to point down.
 */
export const HEAD_LANE = 74;
/** Vertical room below for the index rail (arrays) and the ring (circular). */
export const FOOT_BAND = 36;
/** Extra room under a circular list, where the closing arc is drawn. */
export const RING_BAND = 34;
/**
 * Room ABOVE everything for a node that exists but is not linked in yet —
 * drawn as a real node with its own `next` field, so it needs a node's height
 * plus room for the arrow that leaves it.
 */
export const CARRY_BAND = 78;

export interface LayoutBox {
  /** Left edge of the VALUE half. */
  x: number;
  /**
   * Left edge of the `prev` field, for the doubly-linked recipe: a node
   * there has three fields, and the back link is one of them rather than an
   * arrow with nothing to leave from. `null` for every other recipe.
   */
  prevX: number | null;
  /** Top edge. */
  y: number;
  /** Width of the value half. */
  w: number;
  h: number;
  /** For a list node: left edge of the `next` field. `null` for an array. */
  linkX: number | null;
  /** Horizontal centre of the node, where a pointer arrow lands. */
  centerX: number;
}

export interface SequenceLayout {
  /** Left edge of the first node — `head` is drawn in the room before it. */
  lane: number;
  width: number;
  height: number;
  /** Top of the free-floating node's row, or `null` when there is none. */
  carryY: number | null;
  /** One box per cell, in reading order. */
  boxes: LayoutBox[];
  /** Baseline the boxes sit on. */
  top: number;
  /** Y of the index rail / foot labels. */
  footY: number;
  /** Y the circular closing arc dips to. `null` when the recipe has no ring. */
  ringY: number | null;
}

const isList = (recipe: SequenceRecipe) => recipe.startsWith('linked-list');

/**
 * Lays out `count` cells for `recipe`. `slots` is the RESERVED block for the
 * array recipes — capacity, which may exceed the number of live cells, and is
 * what makes "the block is full" visible before a resize.
 */
export function layoutSequence(
  count: number,
  recipe: SequenceRecipe,
  slots: number = count,
  hasCarry = false,
): SequenceLayout {
  const list = isList(recipe);
  const doubly = recipe === 'linked-list-doubly';
  const drawn = Math.max(list ? count : Math.max(count, slots), 0);
  const nodeW = list ? BOX_W + LINK_W * (doubly ? 2 : 1) : BOX_W;
  const gap = list ? LIST_GAP : 0;
  const top = POINTER_BAND + (hasCarry ? CARRY_BAND : 0);

  const lane = list ? HEAD_LANE : 0;
  const boxes: LayoutBox[] = [];
  for (let i = 0; i < drawn; i += 1) {
    // `x` stays the VALUE half's left edge, which is what every arrow and
    // every pointer is aimed at; the `prev` field is reserved to its left.
    const left = lane + i * (nodeW + gap);
    const x = left + (doubly ? LINK_W : 0);
    boxes.push({
      x,
      prevX: doubly ? left : null,
      y: top,
      w: BOX_W,
      h: BOX_H,
      linkX: list ? x + BOX_W : null,
      centerX: left + nodeW / 2,
    });
  }

  const contentW = lane + (drawn === 0 ? nodeW : drawn * nodeW + (drawn - 1) * gap);
  const ring = recipe === 'linked-list-circular' && drawn > 0;
  const footY = top + BOX_H + FOOT_BAND;
  return {
    // A trailing `null` marker is drawn past the last list node, so the box
    // needs room for it; an array ends flush with its last slot.
    width: contentW + (list ? LIST_GAP + BOX_W / 2 : 0),
    height: footY + (ring ? RING_BAND : 0),
    boxes,
    lane,
    top,
    carryY: hasCarry ? 6 : null,
    footY,
    ringY: ring ? footY + RING_BAND - 10 : null,
  };
}

/**
 * The arrow between node `i` and node `i + 1`: from the right edge of the
 * `next` field to the left edge of the following node.
 */
export function linkArrow(
  layout: SequenceLayout,
  i: number,
): { x1: number; x2: number; y: number } {
  const from = layout.boxes[i];
  const to = layout.boxes[i + 1];
  const y = layout.top + BOX_H / 2;
  if (!from) return { x1: 0, x2: 0, y };
  const x1 = (from.linkX ?? from.x) + LINK_W;
  // The next node's LEFT EDGE, which on a doubly-linked node is its `prev`
  // field rather than its value half.
  const x2 = to ? (to.prevX ?? to.x) : x1 + LIST_GAP;
  return { x1, x2, y };
}
