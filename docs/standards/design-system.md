# Design System

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
| `accent`                              | Links, active state, emphasis            | **One accent in the whole product**                                                  |
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
- **One accent.** If something needs to stand out and `accent` is taken, the
  answer is hierarchy — weight, size, position — not a second hue.
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
  is recorded here, with its measured pairs.** One exists: KaTeX paints a
  malformed formula in its own `#cc0000`, which measures **3.24:1 on the dark
  `ground`** — above the 3:1 for large text, below the 4.5:1 the tokens hold text
  to. Accepted: it is an authoring error state that should look wrong in either
  theme and is never a reading surface. `architecture.test.ts` cannot see it —
  it greps our class names, not vendor CSS or inline styles — so this note is
  the only guard.

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

The full browser recipe, including how to stop a preview server without killing
other agents', is in `testing-strategy.md` §Conventions.
