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
// `deck-ground` is a surface like the others and is checked like the others. It
// is separate from `ground` because a projected room wants less light, so the
// deck runs deeper than the book in dark and lighter-but-not-white in light —
// but "it is the deck" is not a licence to be less readable.
const SURFACES = ['ground', 'surface', 'sunk', 'deck-ground'] as const;

/** Text: WCAG AA is 4.5:1. `ink-faint` is deliberately included — it carries the
 *  smallest type in the product, so it is the one that must not be waved through
 *  at the 3:1 "large text" allowance. */
const TEXT_TOKENS = ['ink', 'ink-soft', 'ink-faint', 'accent', 'flag', 'keep'] as const;

/** Non-text UI that carries meaning: WCAG AA is 3:1. `rule` is absent on purpose
 *  — it is decorative, and a decorative hairline needs no ratio. That is exactly
 *  why `rule-strong` exists as a separate token. */
const UI_TOKENS = ['rule-strong', 'focus'] as const;

const THEMES = [
  { name: 'light', selector: ':root' },
  { name: 'dark', selector: ':root\\[data-theme=.dark.\\]' },
] as const;

describe('the palette', () => {
  for (const theme of THEMES) {
    describe(theme.name, () => {
      const tokens = tokensIn(theme.selector);

      it('declares every token the pairing table names', () => {
        const required = [...SURFACES, ...TEXT_TOKENS, ...UI_TOKENS, 'rule'];
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

      it.each(UI_TOKENS)('%s reaches AA for non-text (3.0) on every surface', (fg) => {
        for (const bg of SURFACES) {
          const ratio = contrast(tokens[fg]!, tokens[bg]!);
          expect(
            ratio,
            `${theme.name}: ${fg} (${tokens[fg]}) on ${bg} (${tokens[bg]}) is ${ratio.toFixed(2)}:1, below AA for a meaning-carrying border`,
          ).toBeGreaterThanOrEqual(3);
        }
      });
    });
  }

  // Without this, adding a token to index.css and forgetting the pairing table
  // silently leaves it unchecked — the table would describe the palette it was
  // written for rather than the palette that ships.
  it('every declared token appears in the pairing table', () => {
    const declared = Object.keys(tokensIn(':root'));
    const known = new Set<string>([...SURFACES, ...TEXT_TOKENS, ...UI_TOKENS, 'rule']);
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
});
