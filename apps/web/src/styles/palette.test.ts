import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// L4 (testing-strategy.md): the palette's contract, read out of the stylesheet
// that ships it.
//
// Not from a TypeScript copy of the same hexes. A second declaration is a second
// thing to keep in sync, and the failure mode is silent — the test would keep
// passing over values the browser never sees. #108 cost a full red run to learn
// the general form of this: an assertion over a model proves nothing about the
// source the model was built from.
const CSS = readFileSync(join(process.cwd(), 'src/styles/index.css'), 'utf8');

/** Every `--nl-<name>: <hex>` inside the given selector block. */
function tokensIn(selector: string): Record<string, string> {
  // The block is matched by its selector and closing brace; token declarations
  // are the only thing these blocks are allowed to contain.
  const block = new RegExp(`${selector}\\s*\\{([^}]*)\\}`, 'm').exec(CSS);
  if (!block) return {};
  const out: Record<string, string> = {};
  for (const [, name, hex] of block[1]!.matchAll(/--nl-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)) {
    out[name!] = hex!.toLowerCase();
  }
  return out;
}

const srgb = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);

function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => srgb(v / 255));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
}

/**
 * The pairing table — which foreground token may be painted on which surface.
 *
 * This is the contract, not a convenience. Checking tokens in isolation passes a
 * palette that still permits `rule` on `surface` (1.3:1): contrast is a property
 * of a PAIR, so the legal pairs are what has to be declared and iterated. A new
 * token lands here or it is not covered — see the completeness case below, which
 * is what makes that true rather than aspirational.
 */
// `deck-ground` is retained in SURFACES so the completeness case still names it
// and every TEXT_TOKENS/UI_TOKENS pair keeps a gate against it. Since #225 both
// themes have `--nl-deck-ground === --nl-ground` (see ADR-0026 addendum
// §Reversal), so every pair collapses to a `ground` pair this file already
// verifies — the alias is kept as a semantic anchor for the slide surface,
// not because the value is expected to diverge again. A re-divergence is
// guarded by the "deck-ground stays coupled to ground" case below.
const SURFACES = ['ground', 'surface', 'sunk', 'deck-ground'] as const;

/** Text: WCAG AA is 4.5:1. `ink-faint` is deliberately included — it carries the
 *  smallest type in the product, so it is the one that must not be waved through
 *  at the 3:1 "large text" allowance. */
const TEXT_TOKENS = ['ink', 'ink-soft', 'ink-faint', 'accent', 'flag', 'keep'] as const;

/** WCAG's "large text / non-text UI" floor. Shared by `UI_TOKENS` (meaning-
 *  carrying non-text) and `CHROME_TOKENS` (large-text chrome). Two spellings
 *  would drift: a future author who tightens one would silently leave the
 *  other behind. Named because the error-message string benefits from it.
 *
 *  #247 attempted to raise this to 3.1 so a token nudge could not silently
 *  consume the entire headroom. Three pairs failed the raise:
 *    - light  `rule-strong` on `sunk`      3.05:1
 *    - light  `accent-pop`  on `ground`    3.02:1  (via the `deck-ground` alias)
 *    - dark   `rule-strong` on `sunk`      3.00:1
 *  The raise was reverted per the WP's escape hatch: the current palette has
 *  ~zero headroom on those three pairs and a nudge would need a new token
 *  value, which is out of scope for a housekeeping WP (#247 non-goal: "Do not
 *  change palette token VALUES"). The finding is the deliverable — a separate
 *  WP (or a design-driven nudge under #109's successor) has to move those
 *  pairs above 3.05 before the floor can rise. */
const LARGE_TEXT_FLOOR = 3;

/** Non-text UI that carries meaning: WCAG AA is 3:1. `rule` is absent on purpose
 *  — it is decorative, and a decorative hairline needs no ratio. That is exactly
 *  why `rule-strong` exists as a separate token. */
const UI_TOKENS = ['rule-strong', 'focus'] as const;

/**
 * Chrome tokens paint on the two page-level surfaces (canvas + cards) at the
 * WCAG "large text / non-text UI" floor of 3:1, and are NOT checked against
 * inset surfaces like `sunk`. The real uses of `accent-pop` are: filled
 * buttons (BG `accent-pop` + label on-pop, folded into `PAIRS` via the
 * existing on-keep shape), TEXT on `accent-soft` (chips, covered by
 * `[accent, accent-soft]`), and section titles (H1/H2/H3) on `ground` or
 * `surface`. Slides paint titles here too since #225 unified
 * `--nl-deck-ground` with `--nl-ground` — every deck-ground pair collapses
 * into a `ground` pair this test already verifies. Testing `accent-pop`
 * against every surface would sacrifice the deck seed's identity (reference
 * `#E86800`, shipped as the nudged `#E66600` — see ADR-0026 addendum §Seed
 * provenance) to a pairing no component paints; if a future component needs
 * `accent-pop` on `sunk`, mint a specific token for that use or promote
 * `accent-pop` into `UI_TOKENS`. If a future WP re-diverges deck-ground
 * from ground, revisit `CHROME_SURFACES` alongside the palette nudge — see
 * ADR-0026 addendum §Reversal for why this coupling is now the shape. */
const CHROME_TOKENS = ['accent-pop'] as const;
const CHROME_SURFACES = ['ground', 'surface'] as const;

/**
 * Pairs that are not "text on a surface": a tinted state background with its own
 * foreground, and the label on a filled button.
 *
 * These exist because the interactive components need them (#109 S4) — a status
 * chip is `bg-<state>-soft text-<state>`, and the run button is a filled `keep`.
 * They are listed explicitly rather than folded into the surface loop because a
 * soft background is NOT a general-purpose surface: `ink` on `keep-soft` is not
 * something to allow, it is something nobody should write.
 */
const PAIRS = [
  ['keep', 'keep-soft'],
  ['flag', 'flag-soft'],
  ['accent', 'accent-soft'],
  ['on-keep', 'keep'],
] as const;

const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: ':root\\[data-theme=.dark.\\]' },
] as const;

describe('the palette', () => {
  for (const theme of THEMES) {
    describe(theme.name, () => {
      const tokens = tokensIn(theme.selector);

      it('declares every token the pairing table names', () => {
        const required = [
          ...SURFACES,
          ...TEXT_TOKENS,
          ...UI_TOKENS,
          ...CHROME_TOKENS,
          ...PAIRS.flat(),
          'rule',
        ];
        expect(
          Object.keys(tokens).length,
          `no --nl-* tokens found for the ${theme.name} theme — the selector in this test no longer matches index.css`,
        ).toBeGreaterThan(0);
        for (const name of required) {
          expect(tokens[name], `${theme.name}: --nl-${name} is not declared`).toBeDefined();
        }
      });

      it.each(TEXT_TOKENS)('%s reaches AA (4.5) on every surface', (fg) => {
        for (const bg of SURFACES) {
          const ratio = contrast(tokens[fg]!, tokens[bg]!);
          expect(
            ratio,
            `${theme.name}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, below AA for text`,
          ).toBeGreaterThanOrEqual(4.5);
        }
      });

      it.each(PAIRS)('%s on %s reaches AA (4.5)', (fg, bg) => {
        const ratio = contrast(tokens[fg]!, tokens[bg]!);
        expect(
          ratio,
          `${theme.name}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, below AA — a status chip or a filled button is text, and small text at that`,
        ).toBeGreaterThanOrEqual(4.5);
      });

      it.each(UI_TOKENS)('%s reaches AA for non-text (3.0) on every surface', (fg) => {
        for (const bg of SURFACES) {
          const ratio = contrast(tokens[fg]!, tokens[bg]!);
          expect(
            ratio,
            `${theme.name}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, below the ${LARGE_TEXT_FLOOR}:1 floor for a meaning-carrying border`,
          ).toBeGreaterThanOrEqual(LARGE_TEXT_FLOOR);
        }
      });

      it.each(CHROME_TOKENS)('%s reaches large-text (3.0) on the page surfaces', (fg) => {
        for (const bg of CHROME_SURFACES) {
          const ratio = contrast(tokens[fg]!, tokens[bg]!);
          expect(
            ratio,
            `${theme.name}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, below the ${LARGE_TEXT_FLOOR}:1 large-text / non-text UI floor for a chrome token`,
          ).toBeGreaterThanOrEqual(LARGE_TEXT_FLOOR);
        }
      });
    });
  }

  // Without this, adding a token to index.css and forgetting the pairing table
  // silently leaves it unchecked — the table would describe the palette it was
  // written for rather than the palette that ships.
  it('every declared token appears in the pairing table', () => {
    const declared = Object.keys(tokensIn(':root'));
    const known = new Set<string>([
      ...SURFACES,
      ...TEXT_TOKENS,
      ...UI_TOKENS,
      ...CHROME_TOKENS,
      ...PAIRS.flat(),
      'rule',
      // `plate` carries no product text and no product UI — it is the white a
      // third-party brand mark was drawn for, given to it because an `<img>`
      // cannot read any of the tokens above (#120 review). Nothing of ours is
      // painted on it, so there is no contrast pair to check — what it must be
      // is the same VALUE in every theme, and that is asserted by its own case
      // below rather than by the token-set case, which compares names.
      'plate',
    ]);
    const orphans = declared.filter((name) => !known.has(name));
    expect(
      orphans,
      `these tokens are declared but named nowhere in the pairing table, so nothing checks them: ${orphans.join(', ')}. Add each to TEXT_TOKENS, UI_TOKENS or SURFACES — or to the decorative exemptions, with a reason.`,
    ).toEqual([]);
  });

  // A token that exists in one theme and not the other is a component that
  // renders correctly in one and falls back to the browser default in the other.
  it('light and dark declare the same token set', () => {
    expect(Object.keys(tokensIn(THEMES[1].selector)).sort()).toEqual(
      Object.keys(tokensIn(':root')).sort(),
    );
  });

  // The guard against silently re-diverging `deck-ground` from `ground` — the
  // failure mode ADR-0026 addendum §Reversal calls out by name. #222 shipped
  // `--nl-deck-ground: #F5EEEA` in light and paid for it with a 2.92:1 pair
  // that only came out in review. #225 collapsed the value, and every real
  // component gate today assumes the collapse: `CHROME_SURFACES` excludes
  // `deck-ground` because the pair is already tested via `ground`. If a future
  // author reintroduces a distinct `deck-ground` without adding it to
  // `CHROME_SURFACES` too, `accent-pop` becomes ungated on the surface the
  // slide actually paints, and the failure mode of #222 reappears green.
  //
  // The case is not "deck-ground equals ground" (that would foreclose a
  // legitimate future re-divergence). It is "if you re-diverge, own the
  // consequence" — either move `deck-ground` into `CHROME_SURFACES` and
  // re-verify the palette, or mint a specific token for the deeper deck ground
  // and leave this alias alone.
  it.each(THEMES)(
    '$name: if deck-ground diverges from ground, CHROME_SURFACES must catch up',
    (theme) => {
      const tokens = tokensIn(theme.selector);
      if (tokens['deck-ground'] !== tokens['ground']) {
        expect(
          CHROME_SURFACES,
          `${theme.name}: --nl-deck-ground (${tokens['deck-ground']}) diverges from --nl-ground (${tokens['ground']}), but CHROME_SURFACES does not include 'deck-ground'. That is the silent-pass ADR-0026 addendum §Reversal warns about — accent-pop is ungated on the surface the slide paints. Add 'deck-ground' to CHROME_SURFACES and re-verify contrast, or mint a specific darker/warmer deck token instead of re-diverging this alias.`,
        ).toContain('deck-ground');
      }
    },
  );

  /**
   * The tokens whose whole point is NOT following the theme, and which therefore
   * must carry the same value everywhere.
   *
   * One so far. `plate` is the white a third-party brand mark was drawn for,
   * handed to it because an `<img>` cannot read a CSS variable: a monochrome
   * logo paints black and vanishes on the dark ground. Give it a dark value
   * "to match the theme" and the marks disappear on the theme that motivated it.
   *
   * Its own case because the token-set case above compares NAMES. Measured while
   * reviewing #120: setting `--nl-plate` to the dark ground in both dark blocks
   * left all 29 cases green, so the invariance was resting on a comment.
   */
  const THEME_INVARIANT = ['plate'] as const;

  it.each(THEME_INVARIANT)('%s carries the same value under every theme', (name) => {
    const light = tokensIn(':root')[name];
    expect(light, `${name} is not declared in :root`).toBeDefined();
    for (const theme of THEMES.slice(1)) {
      expect(
        tokensIn(theme.selector)[name],
        `${name} differs under ${theme.selector}. It is theme-invariant on purpose (design-system.md) — if it should now follow the theme, take it out of THEME_INVARIANT and give it a pairing entry.`,
      ).toBe(light);
    }
  });

  // The THIRD block, and the one that serves most readers.
  //
  // The dark palette is written twice — inside the media query for the reader
  // who never chose, and in `[data-theme='dark']` for the reader who did. The
  // duplication is forced: "dark applies when (the OS is dark AND not stamped
  // light) OR stamped dark" is not one plain-CSS rule at this project's browser
  // floor. What is NOT forced is leaving one copy unverified, and it was:
  // breaking `--nl-ink` to 1.05:1 INSIDE the media query left all 625 tests
  // green (#109 review). Every case above reads the stamped block, so the
  // default dark experience had no contrast check, no completeness check and
  // nothing keeping the two copies in step.
  it('the media-query dark block is identical to the stamped one', () => {
    const media = tokensIn(":root:not\\(\\[data-theme='light'\\]\\)");
    expect(
      Object.keys(media).length,
      'no tokens found in the media-query block — its selector changed and this case stopped reading anything',
    ).toBeGreaterThan(0);
    expect(media).toEqual(tokensIn(THEMES[1].selector));
  });
});
