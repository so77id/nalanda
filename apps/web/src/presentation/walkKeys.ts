/**
 * Whether a walk on a slide takes the keyboard when the slide arrives, so a
 * clicker's page keys step it before they move the deck (ADR-0013, #357).
 *
 * Off since 2026-11-12, the professor's call: the deck moves on the first
 * press, and a walk steps with the keys only once one of its own controls has
 * been used. Turning it back on is this one constant.
 */
export const WALK_TAKES_KEYS_ON_ARRIVAL = false;
