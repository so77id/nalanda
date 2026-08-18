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

// preamble tails and heads that never change with the input.
const preambleHead = `\documentclass[a4paper,11pt]{article}

\usepackage[utf8]{inputenc}
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
\lstset{
  basicstyle=\ttfamily\small,
  columns=fullflexible,
  keepspaces=true,
  xleftmargin=1em,
}

`

func writePreamble(b *strings.Builder, in Input) {
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
	fmt.Fprintf(b, "    %s\n", escapeLatex(strings.TrimSpace(q.Statement)))

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
	fmt.Fprintf(b, "      %s{%s}\n", macro, escapeLatex(strings.TrimSpace(text)))
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
	b.WriteString("    \\end{minipage}}\n")
	b.WriteString("  \\vspace{2mm}\n\n")

	b.WriteString("  \\shufflegroup{clase}\n")
	fmt.Fprintf(b, "  \\insertgroup[%d]{clase}\n\n", in.QuestionsPerCopy)
	b.WriteString("  \\AMCcleardoublepage\n")
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

// escapeLatex escapes the ten TeX specials in text that arrived as plain text
// from a human author — the professor-typed control name AND the bank's
// Statement / Alternatives (which come from MDX where `70%` means "seventy
// percent", not "start of LaTeX comment"). Issue #183 is the follow-up that
// formalises the policy and designs the opt-in for a bank field that WANTS to
// carry LaTeX (formulas). Regression from prod 2026-08-18: the pregunta
// `peso-de-la-presentacion` had alternatives ending in `%`, which without
// escaping opened a LaTeX comment inside `\correctchoice{...}` and cascaded
// up to a runaway argument in `\element{clase}{...}` — the whole
// generation returned exit 1 without producing a PDF.
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
	)
	return replacer.Replace(s)
}
