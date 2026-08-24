# Design System

> **Scope: `apps/web`.** The `apps/server` backoffice is deliberately outside
> this document (§C13, ADR-0036): it is an internal tool for one or two people,
> server-rendered `html/template`, and it ships a small inline stylesheet built
> on `system-ui`, `color-scheme: light dark` and `currentColor` rather than these
> tokens. That is a decision, not an oversight — recorded here because this file
> says it governs any UI, and a reviewer of the first backoffice screens should
> not have to discover the exemption from a template comment.

How colour is chosen in Nalanda. **Read this before writing any UI**; the review
lenses hold every diff to it.

This is the living half. The decision behind it — why tokens, why three theme
states, what was rejected — is [ADR-0026](../decisions/0026-two-theme-colour-system.md)
and does not change. This document grows by recorded cases, like every standard
here (`documentation.md` rule 4). Typography and spacing join it when they get
their WPs; today it covers colour.

## The one rule

**Never write a raw colour.** No `bg-slate-800`, no `text-emerald-400`, no
`#1b232e`, no `rgb(...)`. Use a token.

`src/architecture.test.ts` fails the build on any raw Tailwind colour class in
production code, and it is not a style preference: **a raw colour is correct in
at most one of the two themes, and no test in a jsdom suite can see which.** The
light theme shipped broken past a completely green gate once already (#109), and
was found by looking at a screenshot.

## The tokens

| Token                                 | For                                      | Notes                                                                                |
| ------------------------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------ |
| `ground`                              | The page background                      | Painted on `html`, not on a div                                                      |
| `surface`                             | Panels, cards, the editor shell          | Sits on `ground`                                                                     |
| `sunk`                                | Table heads, inputs, chips, hover states | **The worst-case surface** — contrast is measured against it                         |
| `deck-ground`                         | The slide deck only                      | Deliberately deeper than `ground` in dark: a projected room wants less light         |
| `ink`                                 | Primary text, headings                   | AAA on every surface                                                                 |
| `ink-soft`                            | Body prose, secondary text               |                                                                                      |
| `ink-faint`                           | Labels, timings, metadata, anchors       | The smallest type in the product — held to 4.5:1, never the 3:1 large-text allowance |
| `rule`                                | Decorative separators                    | Carries no information, so it has **no** contrast floor                              |
| `rule-strong`                         | Borders that _are_ the signal            | ≥3:1. This is why `rule` and `rule-strong` are two tokens                            |
| `accent`                              | Links, active state, emphasis            | AA-legal luminance of the seed hue; held to 4.5:1                                    |
| `accent-pop`                          | Section titles, filled buttons, chips    | The raw seed hue; large-text / non-text UI floor (3:1 on `ground` and `surface`)     |
| `flag`                                | Errors, warnings, diagnostics            | Semantic, never decorative                                                           |
| `keep`                                | Success, passing cases, the run button   | Semantic                                                                             |
| `accent-soft` `flag-soft` `keep-soft` | Tinted grounds for chips and callouts    | Only ever under their own foreground                                                 |
| `on-keep`                             | The label on a filled `keep` button      | **Inverts** with the theme rather than following it                                  |
| `focus`                               | The focus ring                           | One ring for the whole product                                                       |

## The pairing table

Contrast is a property of a **pair**, not of a token. These are the legal pairs;
`styles/palette.test.ts` iterates them, reading the values out of `index.css`.

- **Text on a surface** — `ink`, `ink-soft`, `ink-faint`, `accent`, `flag`,
  `keep` on `ground`, `surface`, `sunk`, `deck-ground`. Floor **4.5:1**.
- **Meaning-carrying non-text** — `rule-strong`, `focus` on the same four
  surfaces. Floor **3:1**.
- **Chrome on the page surfaces** — `accent-pop` on `ground` and `surface`
  ONLY. Floor **3:1** (WCAG §1.4.11: large text / non-text UI). `sunk` and
  `deck-ground` are deliberately excluded — see §Títulos and the addendum in
  ADR-0026 for why testing accent-pop against them would sacrifice the deck
  seed's identity to a hypothetical use no component makes. If a future
  component needs `accent-pop` as text on `sunk`, mint a specific token for
  that use or promote `accent-pop` into the previous row.
- **Tinted pairs** — `keep`/`keep-soft`, `flag`/`flag-soft`,
  `accent`/`accent-soft`, and `on-keep`/`keep`. Floor **4.5:1**: a status chip
  is text, and small text at that.

A soft ground is **not** a general-purpose surface. `ink` on `keep-soft` is not
something to allow; it is something nobody should write.

## Adding a token

1. Declare it in **all three** blocks of `src/styles/index.css` — the bare
   `:root`, the media query, and `[data-theme='dark']`. A token missing from the
   bare `:root` is undefined for every reader who never chose a theme, which is
   most of them.
2. Add it to the pairing table in `styles/palette.test.ts`. A completeness case
   fails if you do not: the table has to describe the palette that ships, not the
   one it was written for.
3. Run the suite. If a ratio fails, change the colour — not the floor.

## Rules that are not about contrast

- **Colour is never the only signal.** An error, a passing case, a disabled
  control: each carries text or an icon as well. `flag` and `keep` are how it
  reads at a glance, not how it is understood.
- **One accent, two luminances.** The product has one accent hue. It ships as
  two tokens: `accent` (AA-legal luminance, for links and inline prose) and
  `accent-pop` (the raw seed luminance, for section titles and filled chrome).
  These are the SAME hue rendered at different luminances, not two independent
  accents — a rule ADR-0026's addendum records in full. If something needs to
  stand out and both `accent` slots are taken, the answer is hierarchy —
  weight, size, position — not a third hue.
- **The deck is not the book.** It has its own ground on purpose. Do not
  collapse them.
- **Third-party components that own their colours** take the theme through
  `lib/useResolvedTheme.ts`. That hook exists for CodeMirror and should stay
  rare: anything we style ourselves takes tokens and needs no hook.
- **A third party that draws in `currentColor` needs no hook at all**, and that
  is the better shape when you get to choose it. Worked case: KaTeX (#118). A
  formula inherits `--tw-prose-body` like the paragraph around it, so it is
  correct in both themes by construction and cannot drift when the palette
  changes — measured, 8.90:1 on dark and 7.02:1 on light, identical to the prose
  in each. Check this before reaching for `useResolvedTheme`.
- **A vendor colour we do not control is exempt from §The one rule only when it
  is recorded here, with its measured pairs.**

**A ground a third-party asset was drawn for is the second exemption** (#120
review). `plate` is white given to a brand mark because the mark cannot be given
anything else: served through `<img>` it never sees a CSS variable, so a
monochrome logo paints black and vanishes on the dark ground. It is the only
token with the same value under every theme, and it has no pair — nothing of
ours is ever painted on it. Used by `<Mosaic plate>` and nowhere else. Unlike
the KaTeX case, this one IS guarded: `palette.test.ts` asserts the value is
identical in every theme block, because the first version of it rested on a
comment and a dark value passed all 29 cases. One exists: KaTeX paints a
malformed formula in its own `#cc0000`, which measures **3.24:1 on the dark
`ground`** — above the 3:1 for large text, below the 4.5:1 the tokens hold text
to. Accepted: it is an authoring error state that should look wrong in either
theme and is never a reading surface. `architecture.test.ts` cannot see it —
it greps our class names, not vendor CSS or inline styles — so this note is
the only guard.

**A whole document we do not paint is the third exemption** (#146, ADR-0035).
`<SheetEmbed>` frames a Google spreadsheet, and Google paints it white in every
theme — there is no token to give it, no `currentColor` to inherit, and no way
to ask: it is another origin's document, not an asset of ours. So on the dark
theme a course page carries a white block, and that is accepted rather than
worked around: the sheet's own cell colours (holidays, recess, the two solemnes)
are the information, and they are designed for white.

What IS ours around it, and what it pairs with:

- `bg-sunk` on the wrapper — the placeholder's ground, the worst-case surface
  the tokens are measured against, so `text-ink-faint` on it is already held to
  4.5:1 by §The one rule. It is visible only until the frame paints.
- `border-rule` on the frame — decorative, separating a white block from the
  page rather than carrying information, so it has no contrast floor.
- Nothing of ours is ever painted **on** the white: the frame's inside belongs
  entirely to Google.

Unlike `plate`, this one is not guarded by anything at all. `palette.test.ts`
pins token values and `architecture.test.ts` greps our class names; neither can
see a cross-origin document, and no test can. This note is the guard, and the
check is to look at `/d/planificacion` in the dark theme.

**A component-scoped categorical palette is the fourth exemption** (#78).
`<RecursionTree>` cycles six hues over the arguments of a recursive call, so
duplicated subcalls (`fib(3)` twice, `fib(2)` three times) share a hue and the
duplication that makes recursive Fibonacci slow becomes visible as the reader
expands. Each hue's meaning is **identity within one component's data**, not a
role the rest of the product shares — no other panel ever paints something
`bg-cycle-3`. Tokenising the palette would cost three CSS blocks × six hues
for pairs the rest of the app never uses, and add a naming problem (`cycle`
of what?) with no reader beyond the tree. The pairs are picked inline via
`useResolvedTheme` and interpolated into `hsl(...)` — the raw-colour guard
(`architecture.test.ts`) fires on Tailwind class shapes, not on `style`
attributes, so the exemption is silent to it by construction.

The two invariants that keep this honest, and the guard:

- **Colour is never the only signal** (§Rules that are not about contrast):
  each node prints its argument in the label as well, so a reader who cannot
  distinguish hues still sees "`fib(3)` again". Colour reinforces; it does
  not carry.
- **The identity is derived from a deterministic seed the suite CAN pin.**
  `data-arg` on each node is what `paintFor` reads to pick a hue; a
  refactor that silently breaks the sharing reddens the unit test even
  though every case still paints something. See the recipe in
  `testing-strategy.md` §Conventions ("a property jsdom cannot see").
- **Guard: a browser check on both themes.** The pairs are legible on
  `surface` in both grounds by construction (low-saturation fill + higher-
  saturation border), and the S7 browser check confirms the whole tree
  against the live tokens. Contrast measurements land here when the check
  runs against the shipped build.

Adding a second component-scoped categorical palette records it here with
the same shape, or converges on shared cycle tokens if two components would
share them meaningfully. Do not extend this exemption to a hue whose meaning
IS shared across the product; that is the design failure §The one rule
exists to prevent (#109).

## Títulos

Section titles paint the seed hue. The rule is one line and applies to every
H1/H2/H3 in the product:

- **Inside `.prose`** — nothing to do. `--tw-prose-headings` is routed to
  `var(--color-accent-pop)` in `styles/index.css`, so every heading rendered
  through the typography plugin already carries it. This covers every course
  document.
- **Outside `.prose`** — apply the utility `text-accent-pop` to the heading
  element itself. The catalog pages, the `<Questions>` block, and the 404
  page all use this shape today; new surfaces follow it. `text-accent-pop`
  is generated from the `--color-accent-pop` alias declared in `@theme`, so
  it is a first-class utility and passes `architecture.test.ts`'s raw-colour
  guard.

**One exception.**

- **System UI framed on top of a course page.** The rotate-to-landscape
  notice is the only one today. Its heading is chrome the reader sees when
  the app cannot render what they asked for, not a title in a course
  document. `RotateNotice` therefore stays on `text-ink`; do the same for
  any new full-page system overlay.

**Slides are NOT an exception.** Slide titles paint `text-accent-pop` like
every other H1/H2/H3, because `--nl-deck-ground` collapses to the same
value as `--nl-ground` in both themes (see §Rules that are not about
contrast: "the deck is not the book" — narrowed since #225 to layout,
motion, and typography scale, not surface). This was different in #222,
which shipped `deck-ground` as a distinct surface and reset slide prose
headings back to `ink` because `accent-pop` failed 3:1 there. #225 unified
the two surfaces so the failing pair no longer exists — full history in
ADR-0026 addendum §Deck exception (now superseded) and §Reversal.

## Verifying a colour change

`getComputedStyle` returning the right value **is not evidence**. It reports what
the cascade resolved, not what was painted — the repo has two cases of an outline
that computed perfectly and was invisible, and one of a whole theme that was
unreadable with 598 tests green.

Build, preview, and **look at it in both themes**:

```bash
npm run build && npm run preview -- --port <n>
```

Emulate the reader who never chose, which is the common case — in Playwright,
`browser.newContext({ colorScheme: 'light' | 'dark' })`. Check the book, the
deck, the catalog and an editor. Screenshot each and look.

**Extras when the change touches `accent-pop` or the deck.** When a colour
change modifies `--nl-accent-pop`, `--nl-deck-ground`, or the `.prose`
reroute, confirm on the screenshots that slide H1/H2/H3 paint the seed
hue in BOTH themes (matching every other document H1/H2/H3). If a change
re-diverges `--nl-deck-ground` from `--nl-ground`, the accent-pop pair
against the new value has to clear 3:1 or a fresh mitigation is required —
that history is in ADR-0026 addendum §Deck exception and §Reversal. A
green suite proves nothing about this; the paint has to be looked at.

The full browser recipe, including how to stop a preview server without killing
other agents', is in `testing-strategy.md` §Conventions.
