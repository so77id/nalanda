# ADR-0026: A two-theme colour system with semantic tokens

**Status:** Accepted
**Date:** 2026-08-14
**Decision-makers:** Miguel Rodriguez
**Source:** Issue #109. Extends ADR-0004 (frontend stack) and ADR-0010 (component
contract); the usage rules live in `docs/standards/design-system.md`.

## Context

Nalanda was dark by construction: `html` pinned `color-scheme: dark` and a
`slate-950` ground, and the codebase contained no `dark:` variant, no
`data-theme`, and no `prefers-color-scheme` query. A student reading in daylight
had no alternative, and neither did a projector in a lit room.

Underneath, colour was hardcoded and split: 184 colour-class usages across 23
files, over **two** neutral families — `slate` in the book, the deck and the
catalog, `zinc` in the interactive components — with no semantic names anywhere.
There was no single place a theme could have been changed even if a mechanism had
existed. The surface was also growing: it was 128 usages across 20 files when
this work was specified, a fortnight earlier.

## Decision

**One palette of semantic tokens, two complete themes, and three theme states.**

1. **Tokens, not colours.** One semantic name per role — surfaces, text, lines,
   meaning, focus. One neutral. One accent for the whole product. The roster and
   the legal pairings live in `docs/standards/design-system.md`, which is the
   living document; enumerating them here too would be a second home for a fact
   that changes (it had already drifted before this line was written: the count
   said sixteen and the stylesheet declared seventeen). Each token is exposed to
   Tailwind as `--color-*: var(--nl-*)`, so a utility resolves through the theme
   and **no component writes a `dark:` variant**: 184 duplicated classes would
   have been 368.

2. **Three theme states, because a reader can be in three.** An explicit choice
   stamps `data-theme`; the default state stamps nothing and only
   `prefers-color-scheme` decides — and that is where most readers are. The bare
   `:root` therefore declares the palette in FULL; a token defined only inside
   the media query or the attribute selector is undefined in the unstamped
   state, which paints one theme's text on the other theme's ground.

3. **Contrast is a property of a PAIR, and the pairs are declared.** The palette
   ships a pairing table — which foreground is legal on which surface — and
   `styles/palette.test.ts` iterates it, reading the values out of `index.css`
   itself. Checking tokens in isolation is not equivalent and not enough: a
   palette whose tokens are each defensible still permits `rule` on `surface` at
   1.3:1.

4. **A raw Tailwind colour class is an architecture violation**, enforced by
   `src/architecture.test.ts`. A raw colour is correct in at most one theme, and
   no jsdom test can see which.

## Alternatives considered

- **`dark:` variants on every class.** The obvious Tailwind answer and rejected
  on arithmetic: 184 usages become 368, every future component must remember
  both, and forgetting one is invisible to the suite.
- **Two themes rather than three states.** Rejected because "follow my system"
  is a preference, not the absence of one. A two-way toggle converts a reader who
  never chose into one who chose whatever they were seeing, with no way back.
- **A TypeScript module as the source of the palette**, with the CSS generated or
  duplicated from it. Rejected: two declarations of the same hexes drift, and the
  drift is silent — the contrast test would keep passing over values the browser
  never sees. The stylesheet is the source and the test reads it.
- **Keeping the emerald run button and the sky links as they were**, theming only
  the neutrals. Rejected: it preserves exactly the arbitrariness this replaces,
  and it leaves the focus ring measured against colours nothing else uses.
- **A bespoke syntax-highlighting theme for the editor.** Deferred, not rejected:
  eight to ten more colours with their own contrast research over the editor
  surface. The package's own light/dark themes are used, selected by
  `useResolvedTheme`.

## Consequences

- **The focus ring depends on `outline-offset` more than before.** Re-measured:
  the focus token clears 3:1 on every page surface (light 5.15/5.84/4.78/5.01,
  dark 8.84/8.09/7.39/9.42) but reads **1.10:1 light and 1.03:1 dark** against
  the filled run button, against 1.76:1 for the emerald it replaces. Offsetting
  draws the ring on the surface around a control rather than on it, and that is
  now the only thing between the run button and an invisible focus state.
- **CodeMirror cannot be styled by the cascade.** It takes a theme as a prop, so
  `lib/useResolvedTheme.ts` exists to answer "which theme is in force" in JS. Its
  precedence must stay identical to the stylesheet's, and its test asserts all
  four cases: if they ever disagree, CSS paints one theme while the editor
  renders the other inside the same panel.
- **The anti-flash script duplicates the storage key.** It must run before the
  first paint, so it cannot import the module that owns the key. Two spellings,
  each naming the other; there is no third.
- **A colour test cannot see colour.** The light theme shipped broken past 598
  green tests during this work — `prose-invert` painting white text on the light
  ground — and was found only by taking a screenshot and looking at it. Colour
  changes are verified by pixels; `testing-strategy.md` §Conventions carries the
  rule and now this case.
- Themes beyond two, or a high-contrast mode, are additive: a new block of token
  values and an entry in the pairing table. Nothing in the components changes.

## Addendum — 2026-08-24 (#222)

The palette this ADR shipped carried placeholder values Miguel accepted to
unblock the two-theme system: cool blue-grey ground with a magenta accent,
neither derived from anything the course actually uses. #222 replaces both
palettes with values SEEDED on material the course already ships, and
introduces a second accent token so that section titles can carry the seed
without paying the 4.5:1 body-text obligation.

### Seed provenance

- **Light seed `#E86800`** (reference) — the title colour of the *Complejidad
  de Algoritmos* deck the course ships. A student who has sat through a
  lecture recognises it. The `--nl-accent-pop` token ships the nudged
  `#E66600`, one luminance step darker so `accent-pop` clears the 3:1 floor on
  `--nl-ground` and `--nl-surface`; the reference lives on to name the visual
  intent when the wording says "the seed" (see the shipped vs. reference rule
  below).
- **Dark seed `#D946EF`** — the brand accent from the original nalanda POC
  (`fuchsia-500`). Reused so the site keeps its identity when the reader flips
  to the theme most readers arrive in.

Every `--nl-*` token in each theme is derived from its seed's hue. Per-token
luminances were nudged from the reference artifacts to keep every AA pairing
in `palette.test.ts` green — the reference specifies visual intent; the test
specifies contract, and the contract wins where they disagree.

### The `accent-pop` token

Both themes gain `--nl-accent-pop` separated from `--nl-accent`. They are
**one hue with two luminances**, not two independent accents — clarifies
Decision §1's "one accent for the whole product". The pair:

- `--nl-accent` is the AA-legal variant. Used for body-sized text: links,
  inline prose accents, `--tw-prose-links`. Passes 4.5:1 on every surface.
- `--nl-accent-pop` is the seed itself. Used for **section titles**
  (`--tw-prose-headings` and the H1/H2/H3 chrome outside `.prose`), filled
  buttons' BG, chips. Passes the 3:1 large-text / non-text UI floor WCAG
  §1.4.11 explicitly allows for its use cases.

### `CHROME_TOKENS` — the pairing table's third category

`accent-pop` is tested against a subset of surfaces (`ground` + `surface`),
not the full four, and `palette.test.ts` models this with a new
`CHROME_TOKENS` category parallel to `UI_TOKENS` at the 3:1 floor. Its
worked-case comment carries the reasoning. In one line:

> `accent-pop` no se testea contra `sunk` ni `deck-ground`. El diseño lo usa
> exclusivamente en (a) BG de botones llenos con label on-pop, (b) TEXTO sobre
> `accent-soft` (chips), y (c) H1/H2/H3 sobre `ground` o `surface`. Testear el
> par accent-pop×sunk chequea una combinación que ningún componente pinta y
> que forzaría sacrificar la identidad visual de la semilla del deck
> (referencia `#E86800`, embarcado como `#E66600` — ver §Seed provenance) sin
> proteger ningún uso real. El test lo modela con la
> categoría `CHROME_TOKENS`, que itera solo sobre `ground` y `surface` con
> floor 3.0. Si un componente futuro necesita pintar accent-pop como texto
> sobre sunk, el diseño debe crear un token específico para ese uso o mover
> accent-pop a `UI_TOKENS`.

This is a genuine relaxation of Decision §3 ("the pairs are declared") and
lives here on purpose: the ADR is where the exception is written down,
because the reason the test-subset exists is a design intent (protect the
seed's identity), not a test convenience. If it is not written down, the
next author who sees the `CHROME_TOKENS` block deletes it and folds
`accent-pop` into `UI_TOKENS`, then re-nudges the seed hex to pass the
harder floor, breaking the identity this ADR chose to preserve.

### Titles policy

Section titles (H1/H2/H3) paint the seed. Inside `.prose` this is automatic
via `--tw-prose-headings = var(--color-accent-pop)`. Outside `.prose` —
catalog surfaces, the `<Questions>` block, the 404, and (since #225) the
slide `<h2>` in `SlideDeck.tsx` — the class `text-accent-pop` is applied
to the heading. `design-system.md` carries the utility rule; this ADR
carries the intent.

### Deck exception (superseded — see §Reversal below)

> ⚠️ **This subsection describes what #222 shipped and #225 reversed.** It is
> kept as the historical record of the trade-off that got the palette merged
> in the first place. The rule it declares does NOT govern the current code —
> read §Reversal for what does.

**The deck is not the book.** Slides live on `--nl-deck-ground`, a surface
deliberately distinct from `--nl-ground` — deeper in dark, warmer-but-lower-
contrast in light — because a projected room wants less light than a book.
`design-system.md` §Rules that are not about contrast phrases this rule the
same way.

The reroute of `--tw-prose-headings` to `accent-pop` does NOT apply inside
`bg-deck-ground`. `accent-pop` clears only 2.92:1 on `deck-ground` in light —
below the 3:1 floor `CHROME_TOKENS` declares. The override lives declaratively
in `styles/index.css` as
`.bg-deck-ground .prose { --tw-prose-headings: var(--color-ink); }`, so slide
prose headings paint in `ink` without any component-side knowledge. The slide
`<h2>` title in `SlideDeck.tsx` also stays on `text-ink` (never
`text-accent-pop`), mirroring `RotateNotice.tsx`'s exclusion on the same
surface. If a future component needs the seed hue on `deck-ground`, mint a
darker `accent-pop-deck` variant that clears 3:1 there; do not lift the
override, and do not extend `CHROME_SURFACES` to `deck-ground` without a
palette nudge that keeps the exclusion honest.

### Reversal — 2026-08-24 (#225)

Miguel opened the merged #222 build (PR #223) in presentation mode and
rejected the ink-titled slides. The doctrine loss ("the deck is not the book" narrowing
to layout only) is preferable to the identity loss (slide titles muted while
every other document surface carries the seed).

**Decision.** `--nl-deck-ground` is unified with `--nl-ground` in both
themes — light drops from `#F5EEEA` to `#F8F2EF` (dark was already `#0D1117`
in both). Every `deck-ground` pair collapses to a `ground` pair
`palette.test.ts` already verifies; the 2.92:1 concern dissolves because
the pair no longer exists. Consequences:

- `.bg-deck-ground .prose { --tw-prose-headings: var(--color-ink) }`
  deleted. Slide prose headings inherit the normal `accent-pop` reroute.
- `SlideDeck.tsx`'s slide `<h2>` restores `text-accent-pop`.
- `RotateNotice.tsx`'s H1 stays on `text-ink`, but for a different reason —
  it's system UI (a device-shape signal), not a course-content title. The
  comment there is refreshed to reflect the new reasoning.
- `CHROME_TOKENS` continues to check `ground` + `surface` only; that pair
  now includes what used to be `deck-ground`, so coverage is unchanged.
- `--nl-deck-ground` is kept as a pure alias of `--nl-ground`, not retired.
  The alias is the marker that says "slide surface", so a future
  re-divergence has to touch the palette (one file, one line per theme)
  rather than every callsite (`bg-deck-ground` in `SlideDeck.tsx` and
  `RotateNotice.tsx`, the token binding in `@theme`, the token-table row
  in `design-system.md`). The `palette.test.ts` coupling guard
  ("deck-ground stays coupled to ground until CHROME_SURFACES catches up")
  is what makes the alias safe — a silent re-divergence fails there.
- The "deck is not the book" clause in `design-system.md` §Rules that are
  not about contrast narrows to **layout, motion, and typography scale**.
  It no longer implies a separate surface.

This is a two-line palette change with a large doctrinal footprint. The
addendum keeps §Deck exception above as the record of the trade-off that
got #222 out the door — deleting it would erase the reasoning a future
reviewer needs to understand why the two-value split ever existed.

If a future WP wants a projected-room-specific ground back (deeper dark,
warmer light), reopen this decision explicitly: rename `--nl-deck-ground`
to something like `--nl-deck-projection` so its use is intentional, add it
to `CHROME_SURFACES` with a palette nudge, and update `design-system.md`
§Títulos accordingly. Do NOT silently re-diverge `deck-ground` from
`ground`; the CHROME_TOKENS test will pass and the slide titles will still
land on the accent, but the doctrine will be back to the same broken
shape #222 → #225 fixed.

### What is NOT changed

- CodeMirror still uses the package's built-in `light`/`dark` themes. A
  bespoke highlighting theme remains deferred (Alternatives §, unchanged).
- Mermaid still uses its built-in `default`/`dark` themes. Custom
  `themeVariables` remain a follow-up; see #222 Notes.
- The 27 hand-drawn SVGs under `content/` are not re-palettified in this
  WP; visual review is a follow-up.
- **Four learned-during-review follow-ups** (surfaced by the Round A
  pipeline of #222, deferred out of this WP by explicit agreement):
  - Raise `LARGE_TEXT_FLOOR` from 3.0 to 3.1 to give `accent-pop`'s razor-thin
    ground/surface margins (3.02/3.21 today) some headroom.
  - Add a JSX-walk test asserting every `text-<token>` in `src/` has a
    matching `--color-<token>: var(--nl-<token>)` in the `@theme` block —
    closes the alias-drift hole this WP ships nine callers of.
  - Codify in `testing-strategy.md` §Conventions that palette-critical
    changes obligate a preview-screenshot artifact in the PR body — the
    review had to catch a class-2 (jsdom-invisible) regression by prose
    inspection rather than by a required protocol step.
  - Fold `--nl-accent-pop`'s declaration into the same commit as the
    `--tw-prose-headings` reroute so the between-commit "invalid var"
    window disappears (would require rebasing shipped commits; the cost
    outweighed the benefit at this stage).
