# ADR-0023: Presentation requires landscape on a phone

**Status:** Accepted
**Date:** 2026-08-13
**Decision-makers:** Miguel Rodriguez
**Covers:** why the deck refuses portrait on a touch device · why the pointer
half of the query is load-bearing · what the panel must offer as a way out
**Source:** Issue #91 (require landscape for presentation mode on a phone),
found verifying #90. Constrains ADR-0013 (presentation pipeline) §2 and §5.

## Context

The slide deck is a landscape form: one idea per screen, a comfortable measure,
a counter in a corner. Held upright on a phone it stops being that. Measured in
Chromium on `/d/java-desde-cpp`, slide 2, at 390x844: the paragraph is squeezed
into a 262px column (the viewer's `px-16` leaves 64px of gutter on each side,
at any width) and runs so far past the bottom that the `h2` sits 164px above
the top of the screen — clipped by the viewer's `overflow-hidden`, with nothing
telling the reader that anything is wrong. A student who taps `Presentar` on
their phone gets that by default (#91, found verifying #90).

At 844x390 the same slide reads in nine lines of body instead of twenty-six,
and it is usable. **It is not, however, whole**: measured again during this
WP's review, the heading sits at `y = -61` there too and the closing paragraph
falls below the fold — both clipped by the same `overflow-hidden`. The issue
this ADR comes from said the landscape rendering "reads correctly"; re-measured,
that is true only of the paragraphs that fit. The remaining clipping is slide
typography, deliberately out of scope here and recorded in the last Consequence.

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
- **The panel replaces the deck, it does not sit over it, and it is modal.** No
  slide is painted, the only control reachable by keyboard is the way out, and
  the deck's slide keys are silenced at the window listener. `Escape` is the
  deliberate exception — a modal has a way out, and this one lands where the
  panel's own link lands. (Why the listener needs silencing at all is a
  React mechanic; it lives in the code comment that guards it.)
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
  `p` shortcut, and a deep link straight into `/present`. It sits in the viewer
  rather than in `PresentationPage` because the document is then already loaded:
  turning the phone shows the deck immediately, with no second fetch.
- **Any coarse pointer in portrait gets the panel, tablets included.** An iPad
  held upright has room for a slide and will still be told to turn — accepted,
  because the WP asked for one mechanism, identical on every device, and a width
  term would mean choosing a breakpoint nobody has measured. The panel says
  "Gira el teléfono" there; if that ever grates, the fix is the wording, not a
  second rule.
- **Browser baseline: Safari 14+ / iOS 14+, and no legacy fallback.**
  `MediaQueryList.addEventListener` landed in Safari 14 (MDN browser-compat-data,
  checked 2026-08-13; `addListener` goes back to 5.1), so on older WebKit the
  hook throws and takes the whole `/present` route down — a blank page, worse
  than the layout this WP fixes, on the device class it targets. Shipping it
  anyway is the decision, not an oversight, and the case that does NOT hold is
  named: **a pre-14 iOS phone loses presentation entirely, silently, and no test
  guards it.** No other ADR states a browser floor — 0016/0017 impose a much
  heavier one in practice (a browser that runs CheerpJ and WebAssembly) but never
  wrote it down, so this is the repo's first recorded baseline and the operator
  surface for it is `apps/web/README.md` §Deployed shape.
- **Live sessions (ADR-0008) are not exempted, and that is not yet a decision.**
  ADR-0013 makes `/present` + `?slide=N` the seam a session drives, so a student
  following the class from a phone held upright will get this panel instead of
  the slide the professor is on, while `?slide` keeps advancing behind it. The
  rule is deliberately unconditional today — follower mode does not exist yet —
  and whether it should stay that way is a question for whoever implements
  ADR-0008 in v0.3, not one this ADR answers.
- **Fullscreen is left when the rule takes over.** The `⛶` button is the only
  control that exits fullscreen and it lives in the deck being removed, so the
  panel would otherwise sit inside a fullscreen page with no way back. Verified
  in Chromium: enter fullscreen in landscape, rotate, `document.fullscreenElement`
  is null and the panel is up. This does not touch the button itself, which the
  WP put out of scope.
- **The deck asks for the viewport the browser actually gives, not the one it
  claims (#99).** `fixed inset-0` resolves against the *large* viewport, the one
  a mobile browser overlays with its own chrome, so the deck was drawing under
  the URL bar. It now also carries `h-[100dvh]` (dynamic viewport) and the page
  declares `viewport-fit=cover`; `theme-color` was already `#020617`, the deck's
  own background, so where a bar cannot be removed it at least stops being a
  stripe of a different colour. Measured 2026-08-13 in Chromium with an iPhone 13
  context: the deck's box is exactly `innerHeight` at 844x390, 390x844 and
  1440x900, with nothing scrollable behind it.
  **What emulation cannot answer**: whether a given mobile browser hides its
  chrome, keeps it, or changes on rotation. Headless Chromium has no URL bar, so
  that is a real-device observation and belongs here as one, with the browser and
  the date. Fullscreen remains rejected as the answer for the reasons above — this
  is what can be done without it.
- The reader's position survives rotation for free: it lives in `?slide=N`, not
  in the component.
- **jsdom implements no `matchMedia` at all**, so the suite can pin which
  question is asked and fake the answer, but never evaluate the query. The
  behaviour is verified in a real browser at 390x844 and 844x390, with a coarse
  pointer emulated and again without one (`testing-strategy.md`).
- **Corrected by #99.** This ADR claimed, as behaviour and as a scope boundary,
  that a slide taller than the viewport is still clipped by the viewer's
  `overflow-hidden` — "that is slide typography, and it is deliberately out of
  scope here". Measuring all ten slides of `java-desde-cpp` while fixing the
  phone deck falsified the boundary rather than the observation: slide 9
  overflowed its stage by 69px at **1440x900**, so the clipping was never a
  phone problem and calling it phone-side typography was wrong. The deck now
  fits a slide to its stage instead of clipping it (ADR-0013 §5.1), so nothing
  is silently cut on any screen. The failure mode moved rather than vanishing:
  a slide too dense to fit is now too small to read, which is visible instead
  of invisible, and belongs to the author (`guides/add-a-course-document.md`).
