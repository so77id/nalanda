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

1. **Tokens, not colours.** Sixteen semantic names — surfaces (`ground`,
   `surface`, `sunk`, `deck-ground`), text (`ink`, `ink-soft`, `ink-faint`),
   lines (`rule`, `rule-strong`), meaning (`accent`, `flag`, `keep`, plus their
   `-soft` grounds and `on-keep`), and `focus`. One neutral. One accent for the
   whole product. Each is exposed to Tailwind as `--color-*: var(--nl-*)`, so a
   utility resolves through the theme and **no component writes a `dark:`
   variant**: 184 duplicated classes would have been 368.

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
