# ADR-0023: Presentation requires landscape on a phone

**Status:** Accepted
**Date:** 2026-08-13

## Context

The slide deck is a landscape form: one idea per screen, a comfortable measure,
a counter in a corner. Held upright on a phone it stops being that. Measured on
`/d/java-desde-cpp`, slide 2, at 390x844: the paragraph runs edge to edge, the
`h2` is pushed off screen, and nothing tells the reader that anything is wrong.
The same slide at 844x390 reads correctly. A student who taps `Presentar` on
their phone therefore gets the broken version by default (#91, found verifying
#90).

The book view already serves reading on a phone in portrait, by design (#84), so
the platform is not missing a way to read the material there — only a way to
stop the deck from being the thing that answers.

## Decision

**A slide is never painted on a coarse pointer in portrait.** The viewer asks
one media query — `(pointer: coarse) and (orientation: portrait)` — and when it
matches it renders a panel in place of the deck: a rotate icon, one line in
Spanish, and a link to the document's book view.

Three things this fixes in place:

- **The pointer half is load-bearing.** A narrow or tall window on a laptop is
  not a phone; telling its user to turn their screen sideways is worse than the
  layout ever was.
- **The panel replaces the deck, it does not sit over it.** No slide is painted,
  so nothing is readable behind it and nothing of it is reachable by keyboard.
- **The way out is an absolute route** (`/d/<id>`), not `history.back()`: a
  reader who opened `/d/<id>/present` from a message or a bookmark has nothing
  behind them to go back to.

## Alternatives considered

- **`screen.orientation.lock('landscape')`** — the first idea, and the reason
  this ADR exists. It only works inside fullscreen, and **iPhone Safari has no
  Fullscreen API for a web page at all** (only native `<video>` gets it — which
  is why YouTube can rotate an iPhone and a web page cannot imitate it). It would
  deliver three different behaviours across browsers and a maintenance burden for
  each, and would still leave the iPhone case unsolved. Rejected with that in
  hand. `SlideDeck`'s existing `toggleFullscreen()` is where such a lock would
  hang if a later WP ever wants it on the browsers that do support it.
- **Requesting fullscreen automatically on entering presentation** — same
  dependency, plus it takes a decision away from the reader. Rejected.
- **Redesigning slide typography for narrow portrait** — makes the deck a second
  reading surface competing with the book view, for a shape nobody presents in.
  The decision is landscape, not "make portrait work".
- **A "view it anyway" escape** — the way out is out (the book view), not
  through. Two ways of reading the same document on a phone is the confusion the
  book view exists to prevent.
- **Doing nothing and documenting it** — the failure is silent, and silence is
  what the WP was opened to fix.

## Consequences

- A phone with rotation locked in the OS cannot reach the deck at all. That is
  accepted: the panel's link to the book view is the answer for it, which is why
  the way out is a requirement of the rule and not a courtesy.
- The rule lives in the viewer (`presentation/SlideDeck.tsx` + `RotateNotice`),
  so every entry point to presentation inherits it — the `Presentar` button, the
  `p` shortcut, and a deep link straight into `/present`.
- The reader's position survives rotation for free: it lives in `?slide=N`, not
  in the component.
- **jsdom implements no `matchMedia` at all**, so the suite can pin which
  question is asked and fake the answer, but never evaluate the query. The
  behaviour is verified in a real browser at 390x844 and 844x390, with a coarse
  pointer emulated and again without one (`testing-strategy.md`).
- The deck's own behaviour on a short landscape phone screen is untouched by this
  decision: a slide taller than the viewport is still clipped by the viewer's
  `overflow-hidden`, as it is on any short window. That is slide typography, and
  it is deliberately out of scope here.
