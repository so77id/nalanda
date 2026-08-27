// Package tex is the .tex generator that turns a pool of bank questions and
// the metadata of a control into the source apps/amc-worker compiles.
//
// The rules the emitted source has to honour are ADR-0033's — every one of
// them was found by rendering a sheet and looking at the page, so they live
// somewhere binding and are asserted here in tests rather than remembered
// case by case. The worked example the reader binds to is
// apps/amc-worker/tests/fixtures/control-demo.tex.
//
// Pure Go and stdlib-only. The output is deterministic given the input:
// pool ordering is preserved (the source order is the reading order,
// ADR-0032), the seed is written verbatim, and no clock or PRNG is called
// from this file.
package tex

import (
	"fmt"
	"path/filepath"
	"regexp"
	"strings"
	"unicode"

	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// Input is what Compile takes. Pool is in reading order (typically what
// bank.Pool returned); Compile does not reorder it.
type Input struct {
	// Name is the professor-typed control title shown at the top of every
	// sheet. Escaped before emission so a %, an & or a $ in the title does
	// not break the compile.
	Name string
	// Pool is the drawn set of questions, in the order they should appear
	// in the source. AMC's own \shufflegroup shuffles what \insertgroup
	// picks; the source order only determines which questions are available
	// to draw from.
	Pool []bank.Question
	// Copies is how many printed sheets the source will \onecopy over. AMC
	// draws QuestionsPerCopy per copy, per §Design.
	Copies int
	// QuestionsPerCopy is what \insertgroup[N]{clase} passes.
	QuestionsPerCopy int
	// Seed is what \AMCrandomseed receives. Fixed per control so a
	// re-compile of the same input yields the same draw — the deterministic
	// input ADR-0030's four silent traps need to be testable against.
	Seed int64
	// ListingsDir is the ABSOLUTE directory (as seen by the worker) where
	// per-question code listings have been staged. Each question with Code
	// reads its listing from
	// <ListingsDir>/question-<question-id>.txt — that path is emitted
	// verbatim into \lstinputlisting{...}, so the caller (the Service, S5)
	// must have staged the files before compile time.
	ListingsDir string
	// DuplexPadding, when true, closes each \onecopy with
	// \AMCcleardoublepage so every copy pads to an even page count for
	// duplex printing (historical layout). When false, emits \clearpage
	// instead — one page per copy for simplex printing. Issue #185.
	DuplexPadding bool
	// Paper is one of "letter" or "a4" — the physical sheet the printed
	// PDF is laid out for (issue #208, ADR-0043). The generator turns it
	// into a \documentclass class option: "letter" → letterpaper,
	// "a4" → a4paper. An empty string defaults to Letter (the ADR-0043
	// operational default) so a caller stuck on the pre-#208 shape still
	// gets a legal source. Kept as a plain string rather than a shared
	// enum type because the tex package sits under domain/controls and
	// cannot import controls without a cycle; the two-value set is
	// enforced upstream (handler ValidPaper, schema CHECK) and defaulted
	// here.
	Paper string
}

// Compile emits the .tex source. The output ends with a newline.
//
// Errors are all wiring — an empty name, a too-small pool, a missing
// listings directory when the pool needs one. Every failure mode is caught
// before the first byte is written so a caller never has a half-formed
// source to clean up.
func Compile(in Input) (string, error) {
	if err := validate(in); err != nil {
		return "", err
	}
	var b strings.Builder
	writePreamble(&b, in)
	for _, q := range in.Pool {
		writeQuestion(&b, q, in.ListingsDir)
	}
	writeSheet(&b, in)
	return b.String(), nil
}

func validate(in Input) error {
	switch {
	case strings.TrimSpace(in.Name) == "":
		return fmt.Errorf("tex.Compile: name is required")
	case in.QuestionsPerCopy <= 0:
		return fmt.Errorf("tex.Compile: questions-per-copy must be > 0, got %d", in.QuestionsPerCopy)
	case in.Copies <= 0:
		return fmt.Errorf("tex.Compile: copies must be > 0, got %d", in.Copies)
	case len(in.Pool) < in.QuestionsPerCopy:
		return fmt.Errorf("tex.Compile: pool has %d questions, less than %d per copy",
			len(in.Pool), in.QuestionsPerCopy)
	case in.Seed == 0:
		return fmt.Errorf("tex.Compile: seed must be non-zero (\\AMCrandomseed refuses zero)")
	}
	for _, q := range in.Pool {
		if q.Code != nil && in.ListingsDir == "" {
			return fmt.Errorf("tex.Compile: question %s carries a listing but ListingsDir is empty", q.ID)
		}
	}
	return nil
}

// lastChoicePattern mirrors apps/web src/content/questionRules.ts's NEGATED
// detection (ADR-0033 §"An alternative whose wording refers to the others
// is pinned last"). Case-insensitive: `\b` anchors the two words so
// "ningunas" does not match and "anterior" alone does not match.
var lastChoicePattern = regexp.MustCompile(`(?i)\bninguna\b[^.]*\banteriores\b`)

// preambleDocumentClassFmt is the one line the paper choice touches. Split
// out of preambleHead because Sprintf-ing the whole preamble would try to
// interpret every LaTeX `%` comment as a format verb. Two lines instead of
// one abomination. Issue #208, ADR-0043.
const preambleDocumentClassFmt = "\\documentclass[%s,11pt]{article}\n\n"

// paperClassOption maps the domain enum ("letter"/"a4") to the LaTeX class
// option AMC and geometry read ("letterpaper"/"a4paper"). Empty/unknown
// falls back to letterpaper — the ADR-0043 operational default — so a
// caller with a bug earlier in the chain still gets a legal source.
func paperClassOption(paper string) string {
	if paper == "a4" {
		return "a4paper"
	}
	return "letterpaper"
}

// preamble tails and heads that never change with the input.
const preambleHead = `\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[spanish]{babel}
\usepackage{multicol}
\usepackage{listings}
% lang=ES is not cosmetic: without it AMC labels every question "Question 1"
% in English (worker README §What a control source must contain). completemulti
% is deliberately absent — it appends an all-or-nothing "none of these" box
% AMC's own Spanish gets wrong (ADR-0033 §Alternatives considered).
\usepackage[box,lang=ES]{automultiplechoice}

% Per-question label macros: one for each type, in words (ADR-0033
% §Every question states, in words, how many answers it admits). A simple
% question passes \unaSymbole in the optional argument slot; a questionmult
% cannot, because its own definition already passes \multiSymbole there —
% redefining that macro is the supported lever.
\def\unaSymbole{\textsf{\small(una respuesta)}}
\def\multiSymbole{\textsf{\small(varias respuestas)}}

% Listings style — matches apps/amc-worker/tests/fixtures/control-demo.tex.
% keepspaces keeps a Java program's indentation intact, columns=fullflexible
% avoids the false extra spacing lstlisting would otherwise insert.
%
% literate maps each UTF-8 character that appears in Spanish source code
% to its LaTeX escape. Base listings + inputenc[utf8] handles UTF-8 in
% the main .tex source, but \lstinputlisting runs its own byte pipeline
% and truncates a multi-byte char into two 8-bit chars — "! LaTeX Error:
% Invalid UTF-8 byte sequence (Ã\lst@EC­)" is the trace this class of
% bug leaves. The listingsutf8 package would be the clean fix, but its
% inputencoding=utf8 (neither via \lstset globally nor as a per-call
% option) succeeded in this AMC image (verified 2026-08-20). literate is
% the fallback that always works with base listings: each pair
% {char}{{escape}}N replaces the char with escape at display, N is the
% visual width. Traced in production 2026-08-20 on control
% C673QZI7DKYU3TE5V7RP32Z7ZQ ("vehículo" in a code question broke
% prepare), diagnosable only after #213 propagated the worker Detail.
\lstset{
  basicstyle=\ttfamily\small,
  columns=fullflexible,
  keepspaces=true,
  xleftmargin=1em,
  literate=%
    {á}{{\'a}}1 {é}{{\'e}}1 {í}{{\'i}}1 {ó}{{\'o}}1 {ú}{{\'u}}1
    {Á}{{\'A}}1 {É}{{\'E}}1 {Í}{{\'I}}1 {Ó}{{\'O}}1 {Ú}{{\'U}}1
    {ñ}{{\~n}}1 {Ñ}{{\~N}}1
    {ü}{{\"u}}1 {Ü}{{\"U}}1
    {¿}{{\textquestiondown}}1 {¡}{{\textexclamdown}}1,
}

`

func writePreamble(b *strings.Builder, in Input) {
	fmt.Fprintf(b, preambleDocumentClassFmt, paperClassOption(in.Paper))
	b.WriteString(preambleHead)
	// Fixed seed so a compile is reproducible. AMC uses this to derive the
	// per-copy shuffle; nothing here reshuffles.
	fmt.Fprintf(b, "\\AMCrandomseed{%d}\n", in.Seed)
	b.WriteString("\n\\begin{document}\n\n")
}

func writeQuestion(b *strings.Builder, q bank.Question, listingsDir string) {
	env := "question"
	if q.Type == bank.TypeMultiple {
		env = "questionmult"
	}

	b.WriteString("\\element{clase}{\n")
	if env == "question" {
		// [\unaSymbole] as the optional argument — that is the lever the
		// simple question takes for its per-question label.
		fmt.Fprintf(b, "  \\begin{%s}[\\unaSymbole]{%s}\n", env, q.ID)
	} else {
		// questionmult inherits its label from \multiSymbole in the
		// preamble; passing a second one in [...] mangles the text
		// (ADR-0033 §The sheet carries its own arithmetic).
		fmt.Fprintf(b, "  \\begin{%s}{%s}\n", env, q.ID)
	}
	fmt.Fprintf(b, "    %s\n", escapeBankText(strings.TrimSpace(q.Statement)))

	if q.Code != nil {
		// Absolute path: AMC compiles from its own working directory, so
		// a path relative to the .tex fails fatally (ADR-0033 §Anything
		// the source reads is staged under /work and referenced
		// absolutely). The Service is responsible for having staged the
		// file at this exact path.
		listingPath := filepath.Join(listingsDir, "question-"+q.ID+".txt")
		fmt.Fprintf(b, "    \\lstinputlisting{%s}\n", listingPath)
	}

	b.WriteString("    \\begin{choices}\n")
	correctSet := make(map[int]bool, len(q.Correct))
	for _, i := range q.Correct {
		correctSet[i] = true
	}
	// Split alternatives into normal and last-pinned. The last-pinned set
	// is emitted after \lastchoices so AMC keeps them at the end of the
	// shuffled list (ADR-0033).
	var normal, pinned []int
	for i, alt := range q.Alternatives {
		if lastChoicePattern.MatchString(alt) {
			pinned = append(pinned, i)
		} else {
			normal = append(normal, i)
		}
	}
	for _, i := range normal {
		emitAlternative(b, q.Alternatives[i], correctSet[i])
	}
	if len(pinned) > 0 {
		b.WriteString("      \\lastchoices\n")
		for _, i := range pinned {
			emitAlternative(b, q.Alternatives[i], correctSet[i])
		}
	}
	b.WriteString("    \\end{choices}\n")
	fmt.Fprintf(b, "  \\end{%s}\n", env)
	b.WriteString("}\n\n")
}

func emitAlternative(b *strings.Builder, text string, correct bool) {
	macro := "\\wrongchoice"
	if correct {
		macro = "\\correctchoice"
	}
	fmt.Fprintf(b, "      %s{%s}\n", macro, escapeBankText(strings.TrimSpace(text)))
}

func writeSheet(b *strings.Builder, in Input) {
	fmt.Fprintf(b, "\\onecopy{%d}{\n\n", in.Copies)

	fmt.Fprintf(b, "  \\noindent{\\large\\bf %s}\\hfill\n", escapeLatex(in.Name))
	b.WriteString(`  \namefield{\fbox{\begin{minipage}{.45\linewidth}
        Nombre:

        \vspace*{4mm}\dotfill
        \vspace*{2mm}
      \end{minipage}}}

  \begin{center}
    \emph{Marca tu RUT sin el dígito verificador (8 dígitos).}

    \AMCcode{rut}{8}
  \end{center}

`)

	// Header block: this sheet's own arithmetic (ADR-0033 §The sheet
	// carries its own arithmetic). C16: every question weighs one point,
	// so total points = questions per copy.
	b.WriteString("  \\vspace{3mm}\n")
	b.WriteString("  \\noindent\\fbox{\\begin{minipage}{0.98\\linewidth}\n")
	fmt.Fprintf(b, "      \\textbf{%s} · \\textbf{%s} · el 4,0 %s\n",
		pluralQuestions(in.QuestionsPerCopy),
		pluralPoints(in.QuestionsPerCopy),
		fourZeroClause(in.QuestionsPerCopy),
	)
	b.WriteString("\n      \\smallskip\n")
	b.WriteString("      Cada pregunta dice cuántas respuestas admite.\n")
	b.WriteString("      \\textbf{Respóndelas todas: equivocarse no descuenta.}\n")
	// Issue #203: the reader is calibrated for a FULLY FILLED box. Measured
	// on the first real batch: painted squares read 0.62-1.00 darkness
	// while pencil X marks read 0.14-0.32, right at the threshold — a faint
	// X lands in the review queue or is lost. The sheet says so, because a
	// rule the professor announces once is forgotten by question five.
	b.WriteString("      \\textbf{Rellena por completo el cuadrado de tu respuesta.}\n")
	b.WriteString("      No marques con X ni con tilde.\n")
	b.WriteString("    \\end{minipage}}\n")
	b.WriteString("  \\vspace{2mm}\n\n")

	b.WriteString("  \\shufflegroup{clase}\n")
	fmt.Fprintf(b, "  \\insertgroup[%d]{clase}\n\n", in.QuestionsPerCopy)
	// Issue #185: padded closes the copy with \AMCcleardoublepage (blank
	// filler page when the content ended on an odd page); unpadded uses
	// \clearpage so the sujet.pdf is one page per copy.
	if in.DuplexPadding {
		b.WriteString("  \\AMCcleardoublepage\n")
	} else {
		b.WriteString("  \\clearpage\n")
	}
	b.WriteString("}\n\n")
	b.WriteString("\\end{document}\n")
}

// pluralQuestions returns "1 pregunta" or "N preguntas".
func pluralQuestions(n int) string {
	if n == 1 {
		return "1 pregunta"
	}
	return fmt.Sprintf("%d preguntas", n)
}

// pluralPoints returns "1 punto" or "N puntos".
func pluralPoints(n int) string {
	if n == 1 {
		return "1 punto"
	}
	return fmt.Sprintf("%d puntos", n)
}

// fourZeroClause renders the "el 4,0 …" part. Every question weighs one
// point (§C16), 4,0 falls at 50% (§C7), so the threshold is N/2 points.
// Spanish uses a comma as decimal separator.
func fourZeroClause(questions int) string {
	if questions%2 == 0 {
		return fmt.Sprintf("son %s", pluralPoints(questions/2))
	}
	// Half-point case: "el 4,0 son 2,5 puntos". Always "son" (the number
	// after it is fractional and Spanish still takes the plural).
	return fmt.Sprintf("son %d,5 puntos", questions/2)
}

// escapeLatex escapes the TeX specials in text that arrived as plain text
// from a human author — the professor-typed control name AND the bank's
// Statement / Alternatives (which come from MDX where `70%` means "seventy
// percent", not "start of LaTeX comment"). Issue #183 is the follow-up that
// formalises the policy and designs the opt-in for a bank field that WANTS to
// carry LaTeX (formulas). Regression from prod 2026-08-18: the pregunta
// `peso-de-la-presentacion` had alternatives ending in `%`, which without
// escaping opened a LaTeX comment inside `\correctchoice{...}` and cascaded
// up to a runaway argument in `\element{clase}{...}` — the whole
// generation returned exit 1 without producing a PDF.
//
// `<` and `>` join the list even though they are not TeX specials in
// general: babel-spanish makes them ACTIVE. An active `>` decides what it
// means by looking at the token that follows it, and a `>` followed by the
// `}` that closes a `\correctchoice{...}` swallows that brace — the whole
// question's group structure unwinds and `auto-multiple-choice prepare`
// exits 1. Regression from prod 2026-08-19 (issue #193): the pregunta
// `tres-diferencias-de-operadores` carried the alternative
// "`>>` rellena siempre con ceros…", and creating Control 1 failed with a
// 500 whose server log showed only "prepare failed (1)". Reproduced against
// the worker image: the single question fails alone; the same .tex without
// babel-spanish, or with `>` written `\textgreater`, compiles clean.
func escapeLatex(s string) string {
	replacer := strings.NewReplacer(
		"\\", "\\textbackslash{}",
		"{", "\\{",
		"}", "\\}",
		"$", "\\$",
		"&", "\\&",
		"%", "\\%",
		"#", "\\#",
		"_", "\\_",
		"^", "\\^{}",
		"~", "\\~{}",
		"<", "\\textless{}",
		">", "\\textgreater{}",
	)
	return replacer.Replace(s)
}

// codeFontPattern matches an MDX-style backtick pair: the book's inline
// code, which the sheet renders as \texttt. A backtick without its pair is
// not matched and stays where it was — it renders as a quote mark, which is
// the same behaviour the sheet had before this transform existed.
//
// Backtick payloads are EXTRACTED before the emphasis / quote transforms
// run so `*`, `"` and `**` inside code fragments cannot bleed into
// \textit / \guillemotleft / \textbf — see extractCodePayloads and issue
// #239 COR-2.
var codeFontPattern = regexp.MustCompile("`([^`]+)`")

// boldPattern matches an MDX-style bold marker `**text**` and renders as
// \textbf. The inner class allows single `*` runes so a nested italic
// (`**bold *italic* end**`) is captured whole and mapItalic (below) can
// find its pair inside the resulting `\textbf{…}`. `[^*]+(?:\*[^*]+)*`
// reads as "one or more non-star runs, glued by single stars" — which
// forbids `**` inside (each glue star is required to be followed by
// non-stars), keeping each bold pair local.
//
// `\B` on both outer sides gates the marker to non-word-adjacent positions,
// so author-typed arithmetic like `n**m**p` never fires as bold. `\B`
// (opposite of `\b`) asserts "no word boundary here"; since `*` is itself
// non-word, `\B` next to `*` forbids a word character on the outside — the
// only way it matches is if the outer neighbour is start-of-string,
// whitespace, or punctuation. mapItalic below uses a stricter version of
// the same gate — its `italicBoundaryOK` also forbids an adjacent `*`,
// which pure `\B` cannot express (issue #239 COR-1). Runs BEFORE mapItalic
// so the `**` pairs are consumed before the single-`*` scan sees them.
var boldPattern = regexp.MustCompile(`\B\*\*([^*]+(?:\*[^*]+)*)\*\*\B`)

// mapItalic replaces MDX italic markers `*text*` with `\textit{text}`. A
// `*` is treated as an italic marker only when the rune immediately outside
// it (start-of-string counts as "outside") is neither a word character nor
// another `*`. This gate blocks two arithmetic patterns from being read as
// italic (issue #239 COR-1):
//
//   - `n*m*p`, `O(a*b*c*d)`, `5*3*2` — the `*` between word chars is
//     multiplication, not emphasis;
//   - `n**m es la potencia … 2**3` — bold left the `**` pairs alone
//     because its own `\B` gate rejected them, and a pure-regex italic
//     with `\B` would match the two inner `*`s across the whole span
//     (both `*` chars are non-word, so `\B` between them is satisfied).
//
// A pure Go regex cannot express "no `*` on the outside" without
// lookaround; a manual left-to-right scan handles both rules cleanly and
// preserves adjacent-italic-pair cases like `*foo* *bar*` that a
// boundary-consuming regex would drop the second half of.
//
// Content between the pair must not contain `*` and must be non-empty.
// Safe to assume no `**` pairs remain in s: boldPattern runs first and
// consumes them.
func mapItalic(s string) string {
	if !strings.ContainsRune(s, '*') {
		return s
	}
	runes := []rune(s)
	var b strings.Builder
	b.Grow(len(s) + 16)
	for i := 0; i < len(runes); {
		if runes[i] != '*' || !italicBoundaryOK(runes, i-1) {
			b.WriteRune(runes[i])
			i++
			continue
		}
		end := -1
		for j := i + 1; j < len(runes); j++ {
			if runes[j] != '*' {
				continue
			}
			// A `*` inside `[^*]+` content is not allowed — bail.
			// (No inner `*` here because we look for the FIRST `*`
			// after i and check its right boundary.)
			if j > i+1 && italicBoundaryOK(runes, j+1) {
				end = j
			}
			break
		}
		if end < 0 {
			b.WriteRune(runes[i])
			i++
			continue
		}
		b.WriteString(`\textit{`)
		for k := i + 1; k < end; k++ {
			b.WriteRune(runes[k])
		}
		b.WriteRune('}')
		i = end + 1
	}
	return b.String()
}

// italicBoundaryOK reports whether the rune at position i in rs is safe as
// the OUTSIDE neighbour of an italic `*` marker. Start-of-string
// (i == -1) and end-of-string (i == len(rs)) both count as safe. A word
// character (Unicode letter or digit) is unsafe — that is arithmetic /
// intra-word `*`. Another `*` is unsafe — that would be an arithmetic
// `**` pair or a stray triple that bold left alone.
func italicBoundaryOK(rs []rune, i int) bool {
	if i < 0 || i >= len(rs) {
		return true
	}
	r := rs[i]
	if r == '*' {
		return false
	}
	return !unicode.IsLetter(r) && !unicode.IsDigit(r)
}

// mapAsciiQuotes replaces every ASCII `"` with a T1-encoding guillemet
// macro. The first quote in the string opens (`\guillemotleft{}`), the
// second closes (`\guillemotright{}`), and so on — a running toggle rather
// than a regex, because a pair is defined by ordinal position, not by
// matching parentheses.
//
// Why `\guillemotleft{}` / `\guillemotright{}` and not babel's
// `\og`/`\fg{}`: those babel-spanish shortcuts are gated behind an
// `activeacute` (or `es-noshorthands`) option that this preamble does
// not set — `\usepackage[spanish]{babel}` alone leaves them undefined,
// and AMC compiled a Complejidad control with them into "! Undefined
// control sequence" (2026-08-27). `\guillemotleft{}` is a T1 encoding
// macro; `[T1]{fontenc}` is already in the preamble, so it works with no
// package change.
//
// Why guillemets at all: `[T1]{fontenc}` makes a bare ASCII `"` a
// diacritic-composition trigger — `"este"` on paper prints as an
// unintended superscript-e on the `e`. Guillemets are also the Spanish
// typographic convention for a quotation on the printed sheet.
//
// An odd number of quotes in one field (a stray `"` alone) still emits
// legal LaTeX: the state machine opens, and without a partner the print
// shows an unmatched open guillemet — visible on the sheet, but does not
// break brace matching. Covered by TestUnbalancedQuoteStillProducesLegalTex.
func mapAsciiQuotes(s string) string {
	if !strings.ContainsRune(s, '"') {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	open := true
	for _, r := range s {
		if r != '"' {
			b.WriteRune(r)
			continue
		}
		if open {
			b.WriteString(`\guillemotleft{}`)
		} else {
			b.WriteString(`\guillemotright{}`)
		}
		open = !open
	}
	return b.String()
}

// unicodeReplacer maps a Unicode math/greek/dash character to its LaTeX
// escape. Applied in escapeBankText AFTER escapeLatex, so the `\` and `$`
// that appear in the values are NOT re-escaped as `\textbackslash{}\$`.
//
// Shape mirrors escapeLatex above: strings.NewReplacer over a fixed set of
// source → target pairs, single pass, no allocation when nothing matches.
// The one difference is that source strings here are multi-byte runes
// rather than ASCII specials, which is transparent to Replacer (it works
// on UTF-8 byte sequences).
//
// Round 1 is exactly the character set that appears in the published
// complejidad bank today (issue #237): the 18 questions across
// `complejidad-de-hilbert-al-big-o` and `complejidad-espacial` had these
// symbols verbatim in Statement / Alternatives, and pdftex went to metafont
// synthesising a glyph — `auto-multiple-choice prepare` refused the compile
// with "prepare failed (1)" (the ecrm0800.mf trace in the issue).
//
// A standalone `√` maps to `\sqrt{}` — no argument to bind; the empty braces
// are how LaTeX draws a bare radical (an author who wants `√n` writes the
// pair as `√{n}` today, out of scope for this WP).
//
// Dashes carry semantic intent: an em-dash (U+2014) renders as `---` in
// LaTeX (which prints as an em-dash on paper), an en-dash (U+2013) as `--`,
// and the true minus sign (U+2212) as `-`.
//
// Accented Latin (`á`, `ñ`, `ü`, `¿`, `¡`) is deliberately absent: those are
// covered by the preamble's `\usepackage[utf8]{inputenc}` +
// `\usepackage[T1]{fontenc}`, and remapping them here would be dead work at
// best and a source of double-processing regressions at worst.
//
// A few look-alike codepoints share a glyph with a Round 1 entry (U+2126
// Ohm Sign vs U+03A9 Greek Capital Omega; U+03F5 Lunate Epsilon vs U+03B5
// Greek Small Epsilon; U+03D5 Greek Phi Symbol vs U+03C6 Greek Small Phi):
// keyboard layouts and copy-paste from physics or math sources emit the
// look-alike, which then survives into pdftex verbatim and reproduces the
// exact `prepare failed (1)` this WP set out to prevent. Cheap to cover.
var unicodeReplacer = strings.NewReplacer(
	// --- Round 1 — characters that broke a compile in production. ---

	// Uppercase Greek that appears in the bank today.
	"Θ", `$\Theta$`,
	"Ω", `$\Omega$`,

	// Superscripts (n², 2³, 10⁴).
	"⁰", `$^{0}$`,
	"¹", `$^{1}$`,
	"²", `$^{2}$`,
	"³", `$^{3}$`,
	"⁴", `$^{4}$`,
	"⁵", `$^{5}$`,
	"⁶", `$^{6}$`,
	"⁷", `$^{7}$`,
	"⁸", `$^{8}$`,
	"⁹", `$^{9}$`,

	// Subscripts (log₂ n, x₁).
	"₀", `$_{0}$`,
	"₁", `$_{1}$`,
	"₂", `$_{2}$`,
	"₃", `$_{3}$`,
	"₄", `$_{4}$`,
	"₅", `$_{5}$`,
	"₆", `$_{6}$`,
	"₇", `$_{7}$`,
	"₈", `$_{8}$`,
	"₉", `$_{9}$`,

	// Standalone square root: no argument to bind (see doc above).
	"√", `$\sqrt{}$`,

	// Comparisons.
	"≤", `$\leq$`,
	"≥", `$\geq$`,
	"≠", `$\neq$`,

	// Arrows.
	"→", `$\to$`,
	"↔", `$\leftrightarrow$`,

	// Logic / set.
	"∃", `$\exists$`,
	"∀", `$\forall$`,
	"∈", `$\in$`,
	"∉", `$\notin$`,

	// Misc math.
	"∞", `$\infty$`,
	"·", `$\cdot$`,

	// Dashes (semantic preservation, see doc above).
	"—", `---`,
	"–", `--`,
	"−", `-`,

	// --- Round 2 (opportunistic — coverage for future course content). ---
	//
	// The distinction from Round 1 is authorship, not correctness: Round 1
	// is characters that broke a compile in production; Round 2 is
	// characters that WOULD break the next one, added ahead of time so a
	// future author's ∑ or α does not repeat the diagnosis loop.

	// Lowercase Greek — the letters most likely to appear in algorithm
	// analysis (α, β, ε for asymptotic bounds; μ, σ for statistics;
	// π, θ, ω for the lowercase forms of Round 1's uppercase pair).
	// `ο` (omicron) is deliberately absent — LaTeX has no macro for it
	// because it prints identically to the Latin `o`.
	"α", `$\alpha$`,
	"β", `$\beta$`,
	"γ", `$\gamma$`,
	"δ", `$\delta$`,
	"ε", `$\varepsilon$`,
	"ζ", `$\zeta$`,
	"η", `$\eta$`,
	"θ", `$\theta$`,
	"ι", `$\iota$`,
	"κ", `$\kappa$`,
	"λ", `$\lambda$`,
	"μ", `$\mu$`,
	"ν", `$\nu$`,
	"ξ", `$\xi$`,
	"π", `$\pi$`,
	"ρ", `$\rho$`,
	"σ", `$\sigma$`,
	"τ", `$\tau$`,
	"υ", `$\upsilon$`,
	"φ", `$\varphi$`,
	"χ", `$\chi$`,
	"ψ", `$\psi$`,
	"ω", `$\omega$`,

	// Remaining uppercase Greek with a distinct LaTeX macro. Α, Β, Ε, Ζ,
	// Η, Ι, Κ, Μ, Ν, Ο, Ρ, Τ, Χ share glyphs with Latin letters and
	// have no LaTeX macro — an author who typed one meant the Latin
	// letter, and the map would just remove the char.
	"Γ", `$\Gamma$`,
	"Δ", `$\Delta$`,
	"Λ", `$\Lambda$`,
	"Ξ", `$\Xi$`,
	"Π", `$\Pi$`,
	"Σ", `$\Sigma$`,
	"Υ", `$\Upsilon$`,
	"Φ", `$\Phi$`,
	"Ψ", `$\Psi$`,

	// Look-alike codepoints for Round 1 & Round 2 entries: keyboards and
	// copy-paste from physics / math sources emit these instead of the
	// canonical Greek codepoint. Same LaTeX target as their twin.
	"\u2126", `$\Omega$`, // Ohm Sign U+2126 ↔ U+03A9 Greek Capital Omega
	"\u03f5", `$\varepsilon$`, // Greek Lunate Epsilon U+03F5 ↔ U+03B5 Greek Small Epsilon
	"\u03d5", `$\varphi$`, // Greek Phi Symbol U+03D5 ↔ U+03C6 Greek Small Phi

	// Extended arithmetic.
	"±", `$\pm$`,
	"×", `$\times$`,
	"÷", `$\div$`,
	"∘", `$\circ$`,
	"≈", `$\approx$`,
	"≡", `$\equiv$`,

	// Standalone big operators — same convention as √: no argument to
	// bind. An author who needs `∑ᵢ` writes `$\sum_i$` today.
	"∑", `$\sum$`,
	"∏", `$\prod$`,
	"∫", `$\int$`,

	// Set operators.
	"∅", `$\emptyset$`,
	"∪", `$\cup$`,
	"∩", `$\cap$`,
	"⊂", `$\subset$`,
	"⊃", `$\supset$`,
	"⊆", `$\subseteq$`,
	"⊇", `$\supseteq$`,

	// Calculus.
	"∂", `$\partial$`,
	"∇", `$\nabla$`,

	// Double arrows (implication).
	"⇒", `$\Rightarrow$`,
	"⇐", `$\Leftarrow$`,
	"⇔", `$\Leftrightarrow$`,
)

// mapUnicodeToLatex replaces every rune in s that has a LaTeX escape in
// unicodeReplacer with that escape. Runes with no mapping (ASCII, accented
// Latin, anything not in the table) pass through unaltered — a re-encoding
// pass here would defeat inputenc[utf8].
func mapUnicodeToLatex(s string) string {
	return unicodeReplacer.Replace(s)
}

// codePlaceholder is the sentinel form escapeBankText holds a backtick
// payload behind while the emphasis / quote transforms run. Two null bytes
// bracket a decimal index — null is not a rune any author types, is not
// touched by any downstream transform, and never appears in valid UTF-8
// text. Kept package-scoped so tests can pin the shape if they need to.
const (
	codePlaceholderOpen  = "\x00CODE"
	codePlaceholderClose = "\x00"
)

// extractCodePayloads pulls every backtick pair out of s and replaces it
// with a sentinel placeholder, returning the placeholderized string plus
// the ordered list of payloads. The emphasis / quote pipeline that runs
// downstream then cannot bleed into what the author wrote as code — the
// pre-#239 pipeline processed “ `a*b*c` “ as `\texttt{a\textit{b}c}` and
// “ `.equals("María")` “ as `\texttt{.equals(\guillemotleft{}María\guillemotright{})}`
// (issue #239 COR-2, shipped bug in buscar-con-equals). MDX treats backticks as
// inviolable on-screen, so the printed sheet needs the same guarantee.
//
// A backtick without its pair passes through — the pattern only matches
// pairs, same behaviour as the pre-#239 codeFontPattern.
func extractCodePayloads(s string) (string, []string) {
	// Strip any NUL bytes already in s so the sentinel remains
	// unambiguous. Normal MDX / YAML tooling rejects or strips NUL,
	// so this is a defence for a case that should not happen — pdftex
	// would refuse a NUL anyway, but the strip keeps restoreCodePayloads
	// from binding its `strings.Replace` to an author-typed sentinel
	// lookalike (issue #239 review recheck).
	if strings.ContainsRune(s, '\x00') {
		s = strings.ReplaceAll(s, "\x00", "")
	}
	if !strings.Contains(s, "`") {
		return s, nil
	}
	var payloads []string
	replaced := codeFontPattern.ReplaceAllStringFunc(s, func(match string) string {
		// match includes the two backticks; the payload sits between them.
		payloads = append(payloads, match[1:len(match)-1])
		return codePlaceholderOpen + fmt.Sprintf("%d", len(payloads)-1) + codePlaceholderClose
	})
	return replaced, payloads
}

// restoreCodePayloads swaps each sentinel placeholder back for a
// \texttt{…} wrapping the original code payload, with escapeLatex +
// mapUnicodeToLatex applied to that payload — the same two transforms the
// pre-#239 pipeline effectively ran on backtick content, since it ran the
// whole pipeline on the raw string. Emphasis / quote transforms are
// deliberately NOT applied: this is the whole point of the extraction.
func restoreCodePayloads(s string, payloads []string) string {
	if len(payloads) == 0 {
		return s
	}
	for i, payload := range payloads {
		placeholder := codePlaceholderOpen + fmt.Sprintf("%d", i) + codePlaceholderClose
		escaped := mapUnicodeToLatex(escapeLatex(payload))
		s = strings.Replace(s, placeholder, `\texttt{`+escaped+`}`, 1)
	}
	return s
}

// escapeBankText is the Statement / Alternatives pipeline. Seven stages in
// a load-bearing order; each stage names its "why here" in the body. The
// professor-typed control NAME goes through escapeLatex alone — it is
// plain text, not MDX (issue #193 S3).
func escapeBankText(s string) string {
	// Order is load-bearing:
	//   1. extractCodePayloads — pull every backtick pair aside behind a
	//      sentinel placeholder so the emphasis / quote transforms
	//      cannot bleed into `code` content (issue #239 COR-2). The
	//      payload is restored last, wrapped in \texttt with only
	//      escapeLatex + mapUnicodeToLatex applied to it.
	//   2. escapeLatex — TeX specials in author text (`\`, `%`, `&`, …).
	//      Runs on the placeholderized string; the placeholders survive
	//      unchanged because null and `CODE<n>` are not TeX specials.
	//   3. mapUnicodeToLatex — Θ, ², ≤, →, ∞, — … (issue #237). Runs
	//      AFTER escapeLatex so the `\` and `$` we introduce
	//      (`$\Theta$`, `$\leq$`) are NOT re-escaped as
	//      `\textbackslash{}\$`.
	//   4. boldPattern — `**text**` → \textbf (issue #239). Runs BEFORE
	//      mapItalic so the `**` pairs are consumed as a pair; if
	//      italic ran first, its single-`*` scan would match the two
	//      asterisks that open and close a `**bold**` marker and destroy
	//      the bold. Gated with `\B` on both outer sides (see the
	//      boldPattern doc) so `n**m**p` arithmetic is not read as bold.
	//   5. mapItalic — `*text*` → \textit (issue #239). A manual scan
	//      rather than a regex so the boundary check can also forbid an
	//      adjacent `*` on the outside (which pure `\B` cannot), blocking
	//      arithmetic like `n*m*p` and cross-`**` italic bleed in
	//      strings like `n**m es la … 2**3` (issue #239 COR-1).
	//   6. mapAsciiQuotes — `"..."` → `\guillemotleft{}…\guillemotright{}`
	//      (issue #239; babel-shortcut fixed post-#240). Runs
	//      AFTER the emphasis transforms so an author's `*"quoted"*` still
	//      picks up italic on the whole span.
	//   7. restoreCodePayloads — put each backtick payload back as
	//      \texttt{escaped}. Restores the extraction from step 1, so
	//      what the author wrote as code reaches the sheet as code — the
	//      screen-vs-paper parity MDX already gives on-screen.
	s, codes := extractCodePayloads(s)
	s = escapeLatex(s)
	s = mapUnicodeToLatex(s)
	s = boldPattern.ReplaceAllString(s, `\textbf{$1}`)
	s = mapItalic(s)
	s = mapAsciiQuotes(s)
	return restoreCodePayloads(s, codes)
}
