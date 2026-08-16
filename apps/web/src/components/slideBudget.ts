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
 * Shared rather than duplicated because the two current users each declared it
 * privately and each said in a comment that theirs was "the same budget" as the
 * other's — a claim nothing checked, and the kind that stays true only until
 * someone tunes one of them (#146 review). Worked cases: `<Mosaic>`, which
 * splits it across rows, and `<SheetEmbed>`, which clamps its frame to it.
 */
export const SLIDE_BUDGET_VH = 64;
