// Package tex writes the LaTeX source of a survey run's sheet (issue
// #310 S3) — the input `apps/amc-worker`'s /generate compiles.
//
// It is the survey twin of internal/domain/controls/tex and imports
// nothing of it (ADR-0078): the two sheets share the paper and AMC, not
// the code. What makes this sheet a survey, each rule MEASURED in the S0
// spike and pinned against apps/amc-worker/tests/fixtures/survey-demo.tex
// by TestTheGeneratorReproducesTheSheetTheWorkerReads:
//
//   - anonymous: no \namefield and no \AMCcode on the sheet;
//   - authored order: no \element / \shufflegroup, every choices
//     environment `[o]`, so a scale reads 1..N left to right;
//   - every SIMPLE question carries exactly ONE stand-in \correctchoice
//     (the first) — AMC refuses zero and all ("0/3 good answers not
//     coherent for a simple question"), the worker needs the scoring
//     tables, and the score is computed and ignored. A questionmult is
//     all \wrongchoice.
//
// Every string here was typed into a web form by a professor (the first
// such text the worker compiles — control banks come from the repo), so
// every one goes through escapeText before it reaches the source (#309
// review, SEC-1).
package tex

import (
	"errors"
	"fmt"
	"strings"
	"unicode"
)

// Kind is how a question prints. Its own enum rather than
// survey.QuestionKind: the survey service is what calls Compile, so this
// package cannot import survey without a cycle — and a sheet only needs
// to know which of three shapes to draw.
type Kind int

const (
	// Single is one answer among N, listed vertically.
	Single Kind = iota + 1
	// Scale is one answer among N points, laid out in a numbered row.
	Scale
	// Multi is any number of answers, listed vertically.
	Multi
)

// MaxCopies mirrors survey.MaxCopies (the schema's CHECK); Compile refuses
// above it rather than hand AMC a run nobody can have created.
const MaxCopies = 200

// ErrNoQuestions refuses a sheet with nothing on it.
var ErrNoQuestions = errors.New("tex: a sheet needs at least one question")

// Input is one run's sheet.
type Input struct {
	Title       string
	Description string
	// Copies is how many distinct copies AMC prints (\onecopy{N}).
	Copies int
	// Questions in PRINT order (survey.PrintOrder): AMC numbers them as it
	// meets them, so this order is the printed numbering.
	Questions []Question
}

// Question is one question as the sheet prints it.
type Question struct {
	// Name is the AMC question name, "q<question id>" (QuestionName): the
	// key the reading report hands back (#311).
	Name      string
	Kind      Kind
	Statement string
	Section   string
	Labels    []string
	// Guide is a multi-select question's guidance ("marca entre 1 y 3"),
	// printed after the statement; "" for none.
	Guide string
}

// QuestionName is the AMC name a survey question prints under. Stable
// across runs, so a reading maps back to the bank by it.
func QuestionName(questionID int64) string {
	return fmt.Sprintf("q%d", questionID)
}

// Compile returns the LaTeX source of the sheet.
func Compile(in Input) (string, error) {
	switch {
	case in.Copies < 1 || in.Copies > MaxCopies:
		return "", fmt.Errorf("tex.Compile: %d copies, want 1..%d", in.Copies, MaxCopies)
	case len(in.Questions) == 0:
		return "", fmt.Errorf("tex.Compile: %w", ErrNoQuestions)
	}
	for _, q := range in.Questions {
		if len(q.Labels) == 0 {
			return "", fmt.Errorf("tex.Compile: question %s has no alternatives", q.Name)
		}
		if q.Kind != Single && q.Kind != Scale && q.Kind != Multi {
			return "", fmt.Errorf("tex.Compile: question %s has kind %d", q.Name, q.Kind)
		}
	}

	var b strings.Builder
	b.WriteString(preamble)
	fmt.Fprintf(&b, "\\onecopy{%d}{\n\n", in.Copies)
	fmt.Fprintf(&b, "  \\noindent{\\large\\bf %s}\n\n", escapeText(in.Title))
	if d := escapeText(in.Description); d != "" {
		fmt.Fprintf(&b, "  \\smallskip\n  \\noindent %s\n\n", d)
	}
	b.WriteString("  \\smallskip\n  \\noindent Encuesta anónima: no escribas tu nombre.\n\n")
	b.WriteString("  \\smallskip\n  \\noindent\\textbf{Rellena por completo el cuadrado de tu respuesta.}\n\n")

	section := ""
	for _, q := range in.Questions {
		// A heading per run of consecutive questions sharing a label, in
		// print order — the same rule survey.Sections applies on screen.
		if q.Section != section {
			section = q.Section
			if section != "" {
				fmt.Fprintf(&b, "  \\subsection*{%s}\n\n", escapeText(section))
			}
		}
		writeQuestion(&b, q)
	}
	b.WriteString("  \\clearpage\n}\n\n\\end{document}\n")
	return b.String(), nil
}

// preamble is constant: Letter paper (ADR-0043's default; per-run paper is
// #313), the AMC package in Spanish, and a fixed seed — nothing is
// shuffled, so the seed only keeps AMC's own bookkeeping reproducible.
const preamble = `\documentclass[letterpaper,11pt]{article}

\usepackage[utf8]{inputenc}
\usepackage[T1]{fontenc}
\usepackage[spanish]{babel}
\usepackage[box,lang=ES]{automultiplechoice}

\def\unaSymbole{\textsf{\small(una respuesta)}}
\def\multiSymbole{\textsf{\small(varias respuestas)}}

\AMCrandomseed{1}

\begin{document}

`

func writeQuestion(b *strings.Builder, q Question) {
	statement := escapeText(q.Statement)
	if q.Guide != "" {
		statement += " (" + escapeText(q.Guide) + ")"
	}
	choices := "choices"
	if q.Kind == Scale {
		choices = "choiceshoriz"
	}

	if q.Kind == Multi {
		fmt.Fprintf(b, "  \\begin{questionmult}{%s}\n", q.Name)
	} else {
		fmt.Fprintf(b, "  \\begin{question}[\\unaSymbole]{%s}\n", q.Name)
	}
	fmt.Fprintf(b, "    %s\n", statement)
	fmt.Fprintf(b, "    \\begin{%s}[o]\n", choices)
	for i, label := range q.Labels {
		text := escapeText(label)
		if q.Kind == Scale {
			// A scale point prints its value, then its words if it has any.
			text = fmt.Sprintf("%d", i+1)
			if l := escapeText(label); l != "" {
				text += " " + l
			}
		}
		macro := "\\wrongchoice"
		if i == 0 && q.Kind != Multi {
			// The stand-in AMC demands of a simple question (package doc).
			macro = "\\correctchoice"
		}
		fmt.Fprintf(b, "      %s{%s}\n", macro, text)
	}
	fmt.Fprintf(b, "    \\end{%s}\n", choices)
	if q.Kind == Multi {
		b.WriteString("  \\end{questionmult}\n\n")
	} else {
		b.WriteString("  \\end{question}\n\n")
	}
}

// specials are TeX's reserved characters, each replaced by text that prints
// it. A backslash first would be re-escaped by the braces after it, which
// is why this is one Replacer (it never revisits its own output).
var specials = strings.NewReplacer(
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

// mapped are the few non-Latin-1 characters a professor plausibly types
// that pdflatex's utf8 inputenc does not define on its own; each becomes
// its LaTeX spelling.
var mapped = map[rune]string{
	'≤': "$\\leq$", '≥': "$\\geq$", '≠': "$\\neq$",
	'→': "$\\rightarrow$", '←': "$\\leftarrow$",
	'•': "\\textbullet{}",
}

// typographic are the non-Latin-1 characters utf8 inputenc + T1 DO print:
// quotes, dashes, the ellipsis.
var typographic = map[rune]bool{
	'“': true, '”': true, '‘': true, '’': true,
	'–': true, '—': true, '…': true,
}

// escapeText makes professor-typed text safe to embed in the source: TeX
// specials escaped (so `\input`, `\write18` and an unbalanced brace are
// just text), line breaks and control characters collapsed to a space
// (a blank line would end a paragraph mid-statement), and any character
// pdflatex cannot print replaced — mapped when there is a spelling, "?"
// otherwise. An undefined Unicode character is a FATAL LaTeX error, and
// one emoji in one label would otherwise fail a whole run's generation.
func escapeText(s string) string {
	var b strings.Builder
	for _, r := range strings.TrimSpace(s) {
		switch {
		case r == '\n' || r == '\r' || r == '\t':
			b.WriteRune(' ')
		case unicode.IsControl(r):
			// dropped
		case r < 0x100:
			b.WriteString(specials.Replace(string(r)))
		case mapped[r] != "":
			b.WriteString(mapped[r])
		case typographic[r]:
			b.WriteRune(r)
		default:
			b.WriteRune('?')
		}
	}
	return b.String()
}
