package tex

import "testing"

// Issue #237: statements in the published bank carry Unicode math/greek/dash
// characters (Θ, Ω, ², ³, √, ≤, ≥, →, ∃, ∈, ∞, ·, —, −, …). The AMC preamble
// uses inputenc[utf8] + fontenc[T1], which covers Latin accents but not these
// symbols — pdftex goes to metafont to synthesise a glyph and either fails or
// times out, and `auto-multiple-choice prepare` refuses the compile with
// "prepare failed (1)" (see the ecrm0800.mf trace in the issue).
//
// The fix is to translate the symbols to LaTeX in the escapeBankText pipeline
// BEFORE emission. This test pins every Round 1 character character-by-character
// so a silent revert of a single row in the table lands red exactly on the
// character the revert broke, not on an unrelated assertion later in the file.
//
// The mapping runs AFTER escapeLatex — the `\` and `$` that mapUnicodeToLatex
// introduces (`$\Theta$`, `$\leq$`) must not be re-escaped as
// `\textbackslash{}\$`, so this test asserts the escape sequences verbatim.
func TestMapUnicodeToLatex_Round1(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		// Greek letters that appear in the bank today (Θ(n), Ω(n²)).
		{"uppercase-theta", "Θ", `$\Theta$`},
		{"uppercase-omega", "Ω", `$\Omega$`},

		// Superscripts: n², 2³, 10⁴ appear across the complejidad bank.
		{"superscript-two", "²", `$^{2}$`},
		{"superscript-three", "³", `$^{3}$`},
		{"superscript-zero", "⁰", `$^{0}$`},
		{"superscript-one", "¹", `$^{1}$`},
		{"superscript-four", "⁴", `$^{4}$`},
		{"superscript-five", "⁵", `$^{5}$`},
		{"superscript-six", "⁶", `$^{6}$`},
		{"superscript-seven", "⁷", `$^{7}$`},
		{"superscript-eight", "⁸", `$^{8}$`},
		{"superscript-nine", "⁹", `$^{9}$`},

		// Subscripts: log₂ n, x₁, x₂.
		{"subscript-zero", "₀", `$_{0}$`},
		{"subscript-one", "₁", `$_{1}$`},
		{"subscript-two", "₂", `$_{2}$`},
		{"subscript-three", "₃", `$_{3}$`},
		{"subscript-four", "₄", `$_{4}$`},
		{"subscript-five", "₅", `$_{5}$`},
		{"subscript-six", "₆", `$_{6}$`},
		{"subscript-seven", "₇", `$_{7}$`},
		{"subscript-eight", "₈", `$_{8}$`},
		{"subscript-nine", "₉", `$_{9}$`},

		// √ as a STANDALONE symbol — LaTeX's \sqrt binds an argument, but
		// the bank uses √ without one (e.g. "O(√n)" reads "square root of
		// n"). The empty-braces form is deliberate: no argument to bind,
		// but still a valid \sqrt with the radical glyph.
		{"square-root-standalone", "√", `$\sqrt{}$`},

		// Comparison operators.
		{"less-or-equal", "≤", `$\leq$`},
		{"greater-or-equal", "≥", `$\geq$`},
		{"not-equal", "≠", `$\neq$`},

		// Arrows.
		{"rightwards-arrow", "→", `$\to$`},
		{"left-right-arrow", "↔", `$\leftrightarrow$`},

		// Logic / set operators.
		{"there-exists", "∃", `$\exists$`},
		{"for-all", "∀", `$\forall$`},
		{"element-of", "∈", `$\in$`},
		{"not-element-of", "∉", `$\notin$`},

		// Misc math.
		{"infinity", "∞", `$\infty$`},
		{"middle-dot", "·", `$\cdot$`},

		// Dashes: em-dash (U+2014) → --- (LaTeX ligature that renders an
		// em-dash), en-dash (U+2013) → --, minus sign (U+2212) → -.
		// Semantic preservation: three hyphens ARE how LaTeX writes an
		// em-dash, so author intent survives.
		{"em-dash", "—", `---`},
		{"en-dash", "–", `--`},
		{"minus-sign", "−", `-`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapUnicodeToLatex(tc.in)
			if got != tc.want {
				t.Errorf("mapUnicodeToLatex(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// Round 2 (opportunistic — coverage for future course content). These would
// break the next compile the same way Round 1 broke #237's, so they land ahead
// of time. Same shape as the Round 1 table for the same mutation-detectable
// reason: each row asserted independently so a silent revert of a single map
// entry lands red on that row.
func TestMapUnicodeToLatex_Round2(t *testing.T) {
	cases := []struct {
		name string
		in   string
		want string
	}{
		// Lowercase Greek. Omicron (ο) is deliberately not tested — LaTeX
		// has no macro for it (prints identically to Latin `o`).
		{"lower-alpha", "α", `$\alpha$`},
		{"lower-beta", "β", `$\beta$`},
		{"lower-gamma", "γ", `$\gamma$`},
		{"lower-delta", "δ", `$\delta$`},
		{"lower-epsilon", "ε", `$\varepsilon$`},
		{"lower-zeta", "ζ", `$\zeta$`},
		{"lower-eta", "η", `$\eta$`},
		{"lower-theta", "θ", `$\theta$`},
		{"lower-iota", "ι", `$\iota$`},
		{"lower-kappa", "κ", `$\kappa$`},
		{"lower-lambda", "λ", `$\lambda$`},
		{"lower-mu", "μ", `$\mu$`},
		{"lower-nu", "ν", `$\nu$`},
		{"lower-xi", "ξ", `$\xi$`},
		{"lower-pi", "π", `$\pi$`},
		{"lower-rho", "ρ", `$\rho$`},
		{"lower-sigma", "σ", `$\sigma$`},
		{"lower-tau", "τ", `$\tau$`},
		{"lower-upsilon", "υ", `$\upsilon$`},
		{"lower-phi", "φ", `$\varphi$`},
		{"lower-chi", "χ", `$\chi$`},
		{"lower-psi", "ψ", `$\psi$`},
		{"lower-omega", "ω", `$\omega$`},

		// Remaining uppercase Greek with a distinct LaTeX macro.
		{"upper-gamma", "Γ", `$\Gamma$`},
		{"upper-delta", "Δ", `$\Delta$`},
		{"upper-lambda", "Λ", `$\Lambda$`},
		{"upper-xi", "Ξ", `$\Xi$`},
		{"upper-pi", "Π", `$\Pi$`},
		{"upper-sigma", "Σ", `$\Sigma$`},
		{"upper-upsilon", "Υ", `$\Upsilon$`},
		{"upper-phi", "Φ", `$\Phi$`},
		{"upper-psi", "Ψ", `$\Psi$`},

		// Extended arithmetic.
		{"plus-minus", "±", `$\pm$`},
		{"multiplication", "×", `$\times$`},
		{"division", "÷", `$\div$`},
		{"composition", "∘", `$\circ$`},
		{"approx", "≈", `$\approx$`},
		{"identical", "≡", `$\equiv$`},

		// Standalone big operators (same convention as √).
		{"sum-standalone", "∑", `$\sum$`},
		{"product-standalone", "∏", `$\prod$`},
		{"integral-standalone", "∫", `$\int$`},

		// Set operators.
		{"empty-set", "∅", `$\emptyset$`},
		{"union", "∪", `$\cup$`},
		{"intersection", "∩", `$\cap$`},
		{"subset", "⊂", `$\subset$`},
		{"superset", "⊃", `$\supset$`},
		{"subset-or-equal", "⊆", `$\subseteq$`},
		{"superset-or-equal", "⊇", `$\supseteq$`},

		// Calculus.
		{"partial", "∂", `$\partial$`},
		{"nabla", "∇", `$\nabla$`},

		// Double arrows (implication).
		{"right-double-arrow", "⇒", `$\Rightarrow$`},
		{"left-double-arrow", "⇐", `$\Leftarrow$`},
		{"iff-double-arrow", "⇔", `$\Leftrightarrow$`},

		// Look-alike codepoints: keyboards and math/physics copy-paste emit
		// these instead of the canonical Greek codepoint, and they render
		// visually identically — an author cannot spot the difference in an
		// editor. Same LaTeX target as their twin. Written with \u escapes
		// because a bare literal in this test would be visually identical
		// to the Round 1 / Round 2 row that already covers the twin and
		// prove nothing.
		{"lookalike-ohm-sign", "\u2126", `$\Omega$`},
		{"lookalike-lunate-epsilon", "\u03f5", `$\varepsilon$`},
		{"lookalike-phi-symbol", "\u03d5", `$\varphi$`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			got := mapUnicodeToLatex(tc.in)
			if got != tc.want {
				t.Errorf("mapUnicodeToLatex(%q) = %q, want %q", tc.in, got, tc.want)
			}
		})
	}
}

// A string with no mapped characters must pass through unaltered. This is the
// "no regression" guard for the existing 66-ish ASCII/accented-Latin questions
// — an over-eager replacer that touched accents (`á`, `ñ`) would break the
// live bank the day this ships.
func TestMapUnicodeToLatex_LeavesUnmappedCharactersAlone(t *testing.T) {
	cases := []string{
		"",
		"plain ASCII text",
		// Accented Latin: covered by inputenc[utf8]+fontenc[T1] in the
		// preamble, so these must NOT be touched.
		"¿Cuántas iteraciones? La respuesta es única.",
		"Público, año, señor, pingüino.",
		// LaTeX escape sequences (as produced by escapeLatex): must not
		// be re-escaped, must not be interfered with.
		`\textbackslash{} \{ \} \$ \& \% \# \_ \^{} \~{} \textless{} \textgreater{}`,
	}
	for _, in := range cases {
		if got := mapUnicodeToLatex(in); got != in {
			t.Errorf("mapUnicodeToLatex(%q) altered its input: got %q", in, got)
		}
	}
}

// Mixed content: unicode chars scattered through a real-shaped statement.
// Ordering matters — the replacer runs across the full string, not just the
// first hit — so this test would go red if the implementation used a
// find-first-and-return pattern.
func TestMapUnicodeToLatex_ReplacesEveryOccurrence(t *testing.T) {
	in := "Θ(n) domina a Ω(n²) cuando n → ∞; log₂ n ≤ n."
	// Expected shape: each Unicode char is replaced independently; the ASCII
	// text between them stays intact.
	want := `$\Theta$(n) domina a $\Omega$(n$^{2}$) cuando n $\to$ $\infty$; log$_{2}$ n $\leq$ n.`
	if got := mapUnicodeToLatex(in); got != want {
		t.Errorf("mapUnicodeToLatex(mixed) mismatch\n got: %q\nwant: %q", got, want)
	}
}
