/**
 * How much of a slide's height one block may take, in vh, before the title and
 * the deck's own chrome start losing room.
 *
 * A slide is fit and uniformly scaled rather than clipped (ADR-0013 §5.1), so a
 * block that asks for more than the stage has does not get cut off — it shrinks
 * the WHOLE slide, the text with it, and below roughly half scale the body stops
 * being readable. Every component that draws something tall on a slide caps
 * itself against this number.
 *
 * **Where 64 comes from**: measured on a 1024x768 stage, the size the guide
 * names for a projector. That leaves ~36vh — about 276px — for the slide title
 * and the deck's own chrome, which is what a two-line title at the deck's
 * heading size needs plus the footer. The case that breaks if it grows: a 3x3
 * `<Mosaic>` went from 54vh to 73vh when per-cell margins were not zeroed, and
 * at 73vh the deck scaled the whole slide down far enough that the body text
 * stopped being readable — below roughly half scale, per ADR-0013 §5.1.
 *
 * **The cheaper alternative, rejected**: let the fit scaler handle it. It
 * already scales an oversized slide to fit, so nothing is ever clipped — but it
 * scales the TEXT with the block, which turns one component's greed into an
 * unreadable slide. Capping the block instead keeps the type at its design
 * size and costs only the bottom of the block, which scrolls or crops
 * gracefully. Clipping the block outright was the third option and is worse
 * than both: it hides content with no indication that anything is missing.
 *
 * Shared rather than duplicated because the two current users each declared it
 * privately and each said in a comment that theirs was "the same budget" as the
 * other's — a claim nothing checked, and the kind that stays true only until
 * someone tunes one of them (#146 review). Worked cases: `<Mosaic>`, which
 * splits it across rows, and `<SheetEmbed>`, which clamps its frame to it.
 */
export const SLIDE_BUDGET_VH = 64;
