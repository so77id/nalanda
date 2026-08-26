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
var codeFontPattern = regexp.MustCompile("`([^`]+)`")

// unicodeToLatex maps a Unicode math/greek/dash character to its LaTeX
// escape. Applied in escapeBankText AFTER escapeLatex, so the `\` and `$`
// that appear in the values are NOT re-escaped as `\textbackslash{}\$`.
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
var unicodeToLatex = map[rune]string{
	// Uppercase Greek that appears in the bank today.
	'Θ': `$\Theta$`,
	'Ω': `$\Omega$`,

	// Superscripts (n², 2³, 10⁴).
	'⁰': `$^{0}$`,
	'¹': `$^{1}$`,
	'²': `$^{2}$`,
	'³': `$^{3}$`,
	'⁴': `$^{4}$`,
	'⁵': `$^{5}$`,
	'⁶': `$^{6}$`,
	'⁷': `$^{7}$`,
	'⁸': `$^{8}$`,
	'⁹': `$^{9}$`,

	// Subscripts (log₂ n, x₁).
	'₀': `$_{0}$`,
	'₁': `$_{1}$`,
	'₂': `$_{2}$`,
	'₃': `$_{3}$`,
	'₄': `$_{4}$`,
	'₅': `$_{5}$`,
	'₆': `$_{6}$`,
	'₇': `$_{7}$`,
	'₈': `$_{8}$`,
	'₉': `$_{9}$`,

	// Standalone square root: no argument to bind (see doc above).
	'√': `$\sqrt{}$`,

	// Comparisons.
	'≤': `$\leq$`,
	'≥': `$\geq$`,
	'≠': `$\neq$`,

	// Arrows.
	'→': `$\to$`,
	'↔': `$\leftrightarrow$`,

	// Logic / set.
	'∃': `$\exists$`,
	'∀': `$\forall$`,
	'∈': `$\in$`,
	'∉': `$\notin$`,

	// Misc math.
	'∞': `$\infty$`,
	'·': `$\cdot$`,

	// Dashes (semantic preservation, see doc above).
	'—': `---`,
	'–': `--`,
	'−': `-`,
}

// mapUnicodeToLatex replaces every rune in s that has a LaTeX escape in
// unicodeToLatex with that escape. Runes with no mapping (ASCII, accented
// Latin, anything not in the table) pass through unaltered — a
// re-encoding pass here would defeat inputenc[utf8].
func mapUnicodeToLatex(s string) string {
	needsWork := false
	for _, r := range s {
		if _, ok := unicodeToLatex[r]; ok {
			needsWork = true
			break
		}
	}
	if !needsWork {
		return s
	}
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if repl, ok := unicodeToLatex[r]; ok {
			b.WriteString(repl)
		} else {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// escapeBankText is the Statement / Alternatives pipeline: TeX specials
// escaped, then backtick pairs rendered as code. Escaping runs FIRST so the
// \texttt command itself is not escaped, and the pair pattern survives it
// intact because backticks are not special to TeX.
//
// A raw backtick is a quote mark on paper: the sheet would read 'int' where
// the author wrote `int`. The professor-typed control NAME goes through
// escapeLatex alone — it is plain text, not MDX (issue #193 S3).
func escapeBankText(s string) string {
	// Order is load-bearing:
	//   1. escapeLatex — TeX specials in author text (`\`, `%`, `&`, …).
	//   2. mapUnicodeToLatex — Θ, ², ≤, →, ∞, — … (issue #237). Runs
	//      AFTER escapeLatex so the `\` and `$` we introduce
	//      (`$\Theta$`, `$\leq$`) are NOT re-escaped as
	//      `\textbackslash{}\$`.
	//   3. codeFontPattern — backtick pairs → \texttt. Runs LAST because
	//      its output (`\texttt{…}`) must not be re-escaped either, and
	//      because the pair pattern survives the previous two intact
	//      (backticks are not TeX-special and are not in the Unicode
	//      map).
	s = escapeLatex(s)
	s = mapUnicodeToLatex(s)
	return codeFontPattern.ReplaceAllString(s, `\texttt{$1}`)
}
