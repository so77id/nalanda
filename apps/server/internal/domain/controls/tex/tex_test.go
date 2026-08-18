package tex_test

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/controls/tex"
	"github.com/so77id/nalanda/apps/server/internal/domain/course/bank"
)

// samplePool is a small pool exercising every shape ADR-0033 pins the
// generator against: a simple question, a multiple, and a question with
// code. Any missing shape here is a shape nothing else in the suite
// exercises.
func samplePool() []bank.Question {
	return []bank.Question{
		{
			ID: "iteraciones", Document: "welcome", Anchor: "hola",
			Type:      bank.TypeSimple,
			Statement: "¿Cuántas iteraciones hace la búsqueda binaria?",
			Alternatives: []string{
				"Alrededor de log_2 n",
				"Alrededor de n",
				"Alrededor de n^2",
			},
			Correct: []int{0},
		},
		{
			ID: "comparar-cadenas", Document: "welcome", Anchor: "hola",
			Type:      bank.TypeMultiple,
			Statement: "¿Cuáles expresiones comparan el contenido?",
			Alternatives: []string{
				"a.equals(b)",
				"a.compareTo(b) == 0",
				"a == b",
				"Ninguna de las anteriores",
			},
			Correct: []int{0, 1},
		},
		{
			ID: "suma-arreglo", Document: "welcome", Anchor: "hola",
			Type:      bank.TypeSimple,
			Statement: "¿Qué imprime este programa?",
			Code:      &bank.Code{Language: "java", Source: "public class SumaArreglo { … }"},
			Alternatives: []string{
				"20",
				"8",
			},
			Correct: []int{0},
		},
	}
}

// expandedPool copies the sample pool a few times with fresh ids so a
// QuestionsPerCopy up to 12 is legal. Used by header-arithmetic tests that
// don't inspect ids.
func expandedPool() []bank.Question {
	base := samplePool()
	out := append([]bank.Question(nil), base...)
	for round := 1; round <= 3; round++ {
		for i, q := range base {
			q.ID = fmt.Sprintf("%s-copy%di%d", q.ID, round, i)
			out = append(out, q)
		}
	}
	return out
}

func compile(t *testing.T, override func(*tex.Input)) string {
	t.Helper()
	in := tex.Input{
		Name:             "Control de entrada",
		Pool:             samplePool(),
		Copies:           5,
		QuestionsPerCopy: 3, // the sample has three, so the default fits
		Seed:             1242,
		ListingsDir:      "/work/controls/abc/inputs",
	}
	if override != nil {
		override(&in)
	}
	out, err := tex.Compile(in)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	return out
}

func TestPreambleDeclaresLangESAndDoesNotUseCompletemulti(t *testing.T) {
	out := compile(t, nil)
	if !strings.Contains(out, `\usepackage[box,lang=ES]{automultiplechoice}`) {
		t.Error("preamble is missing lang=ES: AMC would label every question 'Question 1' in English (worker README)")
	}
	// Match the ACTUAL package-option syntax, not a comment mentioning
	// the name. `\usepackage[...completemulti...]{automultiplechoice}`
	// would be the miscall; a comment saying "completemulti is off" is
	// not.
	for _, form := range []string{
		",completemulti]{automultiplechoice}",
		"completemulti,",
		"[completemulti]{automultiplechoice}",
	} {
		if strings.Contains(out, form) {
			t.Errorf("preamble uses completemulti (%q): it appends a wrong-Spanish 'none of these' box (ADR-0033 §Alternatives considered)", form)
		}
	}
}

func TestPreambleDeclaresBothPerQuestionLabelMacros(t *testing.T) {
	out := compile(t, nil)
	if !strings.Contains(out, `\def\unaSymbole{\textsf{\small(una respuesta)}}`) {
		t.Error("preamble is missing \\unaSymbole")
	}
	if !strings.Contains(out, `\def\multiSymbole{\textsf{\small(varias respuestas)}}`) {
		t.Error("preamble is missing \\multiSymbole")
	}
	if !strings.Contains(out, `\lstset{`) {
		t.Error("preamble is missing \\lstset: a code question would print with no indentation preserved")
	}
}

func TestSimpleQuestionCarriesUnaLabelInTheOptionalArgument(t *testing.T) {
	out := compile(t, nil)
	if !strings.Contains(out, `\begin{question}[\unaSymbole]{iteraciones}`) {
		t.Error("simple question is missing [\\unaSymbole] in its optional argument (ADR-0033)")
	}
}

func TestMultipleQuestionUsesQuestionmultAndNoInlineLabel(t *testing.T) {
	out := compile(t, nil)
	// questionmult cannot take [label]; the label comes from \multiSymbole
	// in the preamble (worker README §What a control source must contain).
	if !strings.Contains(out, `\begin{questionmult}{comparar-cadenas}`) {
		t.Error("multi-answer question is missing \\begin{questionmult}{comparar-cadenas}")
	}
	if strings.Contains(out, `\begin{questionmult}[`) {
		t.Error("multi-answer question was given a [label] optional argument, which mangles the text")
	}
}

func TestNingunaDeLasAnterioresIsPinnedLastWithLastchoices(t *testing.T) {
	out := compile(t, nil)

	lastchoicesIdx := strings.Index(out, `\lastchoices`)
	if lastchoicesIdx < 0 {
		t.Fatal("\\lastchoices missing: 'Ninguna de las anteriores' would shuffle to any position and print something false (ADR-0033)")
	}
	pinnedIdx := strings.Index(out, "Ninguna de las anteriores")
	if pinnedIdx < 0 {
		t.Fatal("'Ninguna de las anteriores' missing from output")
	}
	if pinnedIdx <= lastchoicesIdx {
		t.Errorf("'Ninguna de las anteriores' at %d appears BEFORE \\lastchoices at %d — the pin has no effect",
			pinnedIdx, lastchoicesIdx)
	}
}

func TestCodeQuestionEmitsLstinputlistingWithAbsolutePath(t *testing.T) {
	out := compile(t, nil)
	// The Service (S5) stages the file at
	// <ListingsDir>/question-<id>.txt, ABSOLUTE per ADR-0033.
	if !strings.Contains(out, `\lstinputlisting{/work/controls/abc/inputs/question-suma-arreglo.txt}`) {
		t.Error("code question is missing \\lstinputlisting with the absolute staged path (ADR-0033)")
	}
	// A relative path here would compile fatally with no PDF, so its
	// absence is the point.
	if strings.Contains(out, `\lstinputlisting{question-`) {
		t.Error("\\lstinputlisting used a relative path — AMC compiles from its own working directory (ADR-0033)")
	}
}

func TestHeaderBlockCarriesThisSheetsArithmetic(t *testing.T) {
	out := compile(t, func(in *tex.Input) {
		in.Pool = expandedPool()
		in.QuestionsPerCopy = 4
	})

	if !strings.Contains(out, `\textbf{4 preguntas} · \textbf{4 puntos} · el 4,0 son 2 puntos`) {
		t.Error("header block for a 4-question sheet is not the exact 'N preguntas · N puntos · el 4,0 son N/2 puntos' shape (ADR-0033)")
	}

	out = compile(t, func(in *tex.Input) {
		in.Pool = expandedPool()
		in.QuestionsPerCopy = 5
	})
	if !strings.Contains(out, `el 4,0 son 2,5 puntos`) {
		t.Error("header block for an odd number of questions is missing the fractional threshold (2,5 puntos)")
	}

	if !strings.Contains(out, `\textbf{Respóndelas todas: equivocarse no descuenta.}`) {
		t.Error("header block is missing the 'answering everything is free' line (§C7)")
	}
	// The one instruction that stopped being true once a control could
	// draw a multiple must not appear (ADR-0033 §Context).
	if strings.Contains(out, "Marca una sola alternativa por pregunta") {
		t.Error("header contains the deleted 'Marca una sola alternativa por pregunta' — it is false when a multiple is drawn")
	}
}

func TestSheetWritesOnecopyAndInsertgroupWithTheRightNumbers(t *testing.T) {
	out := compile(t, func(in *tex.Input) {
		in.Copies = 30
		in.QuestionsPerCopy = 3 // matches sample pool size
	})
	if !strings.Contains(out, `\onecopy{30}{`) {
		t.Error("sheet is missing \\onecopy{30}")
	}
	if !strings.Contains(out, `\insertgroup[3]{clase}`) {
		t.Error("sheet is missing \\insertgroup[3]{clase}")
	}
	if !strings.Contains(out, `\AMCcode{rut}{8}`) {
		t.Error("sheet is missing the 8-digit RUT code grid (§C5)")
	}
}

func TestSeedIsEmittedVerbatim(t *testing.T) {
	out := compile(t, func(in *tex.Input) { in.Seed = 424242 })
	if !strings.Contains(out, `\AMCrandomseed{424242}`) {
		t.Error("preamble is missing \\AMCrandomseed with the input seed")
	}
}

func TestPoolOrderIsPreserved(t *testing.T) {
	out := compile(t, nil)
	// iteraciones must appear before comparar-cadenas, which must appear
	// before suma-arreglo — the same order the sample pool defined.
	i := strings.Index(out, "{iteraciones}")
	j := strings.Index(out, "{comparar-cadenas}")
	k := strings.Index(out, "{suma-arreglo}")
	if !(i > 0 && i < j && j < k) {
		t.Errorf("pool order was not preserved (indices: iteraciones=%d, comparar-cadenas=%d, suma-arreglo=%d)", i, j, k)
	}
}

func TestNameIsEscapedBeforeEmission(t *testing.T) {
	out := compile(t, func(in *tex.Input) { in.Name = "50% control & test" })
	if !strings.Contains(out, `\bf 50\% control \& test`) {
		t.Errorf("name was not LaTeX-escaped: output does not contain the escaped '\\%%' or '\\&'\n---\n%s\n---", takeLines(out, "\\bf ", 1))
	}
}

// A bank Statement and its alternatives arrive from the MDX author as plain
// text; the generator escapes them like it escapes the professor-typed name.
// Regression from prod 2026-08-18: the pregunta `peso-de-la-presentacion` had
// alternatives `70%`/`50%`/`30%`, and `%` is a LaTeX comment, so
// `\correctchoice{70%}` swallowed the closing brace and cascaded up to a
// runaway argument in `\element{clase}{...}`. See issue #183 for the future
// opt-in that would let a professor emit real LaTeX (formulas).
func TestStatementAndAlternativesAreEscapedBeforeEmission(t *testing.T) {
	out := compile(t, func(in *tex.Input) {
		in.Pool = []bank.Question{
			{
				ID: "peso", Document: "welcome", Anchor: "hola",
				Type:      bank.TypeSimple,
				Statement: "¿Cuánto pesa la nota en el 100% final?",
				Alternatives: []string{
					"70% & algo",
					"50%",
					"30%",
				},
				Correct: []int{0},
			},
		}
		in.QuestionsPerCopy = 1
	})
	for _, want := range []string{
		`el 100\% final`,
		`\correctchoice{70\% \& algo}`,
		`\wrongchoice{50\%}`,
		`\wrongchoice{30\%}`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("bank text was not LaTeX-escaped: missing %q in output", want)
		}
	}
	for _, unwant := range []string{
		"100% final",
		"70% & algo",
		"{70%}",
		"{50%}",
	} {
		if strings.Contains(out, unwant) {
			t.Errorf("bank text emitted UNESCAPED: %q found in output — the raw %% would open a LaTeX comment and break brace matching", unwant)
		}
	}
}

func TestCompileRefusesShapesThatCannotProduceASheet(t *testing.T) {
	cases := []struct {
		name string
		mut  func(*tex.Input)
	}{
		{"empty name", func(in *tex.Input) { in.Name = "" }},
		{"zero questions per copy", func(in *tex.Input) { in.QuestionsPerCopy = 0 }},
		{"zero copies", func(in *tex.Input) { in.Copies = 0 }},
		{"pool smaller than questions per copy", func(in *tex.Input) { in.QuestionsPerCopy = 100 }},
		{"seed zero", func(in *tex.Input) { in.Seed = 0 }},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			in := tex.Input{
				Name: "n", Pool: samplePool(), Copies: 5, QuestionsPerCopy: 3, Seed: 1, ListingsDir: "/work/x",
			}
			c.mut(&in)
			if _, err := tex.Compile(in); err == nil {
				t.Error("Compile accepted a shape that cannot produce a sheet")
			}
		})
	}
}

func TestCompileRefusesACodeQuestionWithoutListingsDir(t *testing.T) {
	in := tex.Input{
		Name: "n", Pool: samplePool(), Copies: 5, QuestionsPerCopy: 3, Seed: 1,
		// ListingsDir intentionally empty.
	}
	if _, err := tex.Compile(in); err == nil {
		t.Error("Compile accepted a code question without a ListingsDir (the \\lstinputlisting path would be non-absolute and AMC would fail)")
	}
}

// TestFixtureAndGeneratorAgreeOnTheLoadBearingRules reads the AMC worker's
// checked-in fixture (apps/amc-worker/tests/fixtures/control-demo.tex) and
// asserts every rule ADR-0033 pins the generator on. Both files must
// satisfy the same set — that is what keeps the fixture from drifting from
// the shape WP-E emits, and what makes "the fixture is the reference"
// something the suite believes.
//
// Byte-identity between the generator's output and the fixture is not the
// pin: the fixture carries authoring comments the generator does not emit,
// and hand-writing the pool that would reproduce the fixture is fixture
// work, not code work. Shape-identity is what the ADR is written against.
func TestFixtureAndGeneratorAgreeOnTheLoadBearingRules(t *testing.T) {
	fixturePath := "../../../../../amc-worker/tests/fixtures/control-demo.tex"
	fixture, err := os.ReadFile(fixturePath)
	if err != nil {
		t.Fatalf("read %s: %v", fixturePath, err)
	}
	fixtureStr := string(fixture)

	assertShape := func(t *testing.T, source, label string) {
		t.Helper()
		checks := []struct {
			name string
			ok   bool
			note string
		}{
			{"lang=ES", strings.Contains(source, `lang=ES`), "AMC would label questions in English"},
			{"no completemulti in usepackage", !strings.Contains(source, ",completemulti]{automultiplechoice}") && !strings.Contains(source, "[completemulti]{automultiplechoice}"), "would append wrong-Spanish 'none of these'"},
			{`\unaSymbole def`, strings.Contains(source, `\def\unaSymbole`), ""},
			{`\multiSymbole def`, strings.Contains(source, `\def\multiSymbole`), ""},
			{`\lstset present`, strings.Contains(source, `\lstset`), ""},
			{`\AMCcode{rut}{8}`, strings.Contains(source, `\AMCcode{rut}{8}`), "8-digit RUT grid (§C5)"},
			{`\shufflegroup{clase}`, strings.Contains(source, `\shufflegroup{clase}`), ""},
			{`\lastchoices before "Ninguna de las anteriores"`, lastchoicesPinsCorrectly(source), "pin has no effect (ADR-0033) — a \\lastchoices comment mention does not satisfy the rule the CODE version has to obey"},
			{"deleted 'Marca una sola alternativa'", !containsOutsideComments(source, "Marca una sola alternativa por pregunta"), "false when a multiple is drawn"},
			{"answering everything is free", strings.Contains(source, "equivocarse no descuenta"), "§C7"},
		}
		for _, c := range checks {
			if !c.ok {
				if c.note != "" {
					t.Errorf("%s: rule %q failed — %s", label, c.name, c.note)
				} else {
					t.Errorf("%s: rule %q failed", label, c.name)
				}
			}
		}
	}

	t.Run("fixture", func(t *testing.T) { assertShape(t, fixtureStr, "fixture") })
	t.Run("generator", func(t *testing.T) {
		generated := compile(t, func(in *tex.Input) {
			in.Pool = expandedPool()
			in.QuestionsPerCopy = 4
		})
		assertShape(t, generated, "generator")
	})
}

// lastchoicesPinsCorrectly enforces two things at once, both against a
// comment-stripped copy of the source: `\lastchoices` really appears in
// CODE (not just in a comment explaining why it is there), and it
// appears BEFORE "Ninguna de las anteriores". Reviewed in as its own
// helper because the naive `strings.Index(source, "\\lastchoices")` was
// satisfied by a comment mentioning the macro — measured on the
// checked-in fixture, which has the comment above the real command.
func lastchoicesPinsCorrectly(source string) bool {
	stripped := stripLatexComments(source)
	last := strings.Index(stripped, `\lastchoices`)
	if last < 0 {
		return false
	}
	pinned := strings.Index(stripped, "Ninguna de las anteriores")
	if pinned < 0 {
		return false
	}
	return last < pinned
}

// stripLatexComments returns source with LaTeX line comments removed
// (everything from an unescaped % to end of line). Newlines are
// preserved so offsets outside comments remain meaningful.
func stripLatexComments(source string) string {
	var out strings.Builder
	out.Grow(len(source))
	for _, line := range strings.Split(source, "\n") {
		if i := indexUnescapedPercent(line); i >= 0 {
			out.WriteString(line[:i])
		} else {
			out.WriteString(line)
		}
		out.WriteByte('\n')
	}
	return out.String()
}

// containsOutsideComments reports whether needle appears in source outside
// a LaTeX line comment. A line comment starts with an unescaped %; anything
// after that on the same line is stripped before the search. The check is
// deliberately line-oriented rather than tokenising the whole file.
func containsOutsideComments(source, needle string) bool {
	for _, line := range strings.Split(source, "\n") {
		if i := indexUnescapedPercent(line); i >= 0 {
			line = line[:i]
		}
		if strings.Contains(line, needle) {
			return true
		}
	}
	return false
}

func indexUnescapedPercent(line string) int {
	for i := 0; i < len(line); i++ {
		if line[i] != '%' {
			continue
		}
		if i > 0 && line[i-1] == '\\' {
			continue
		}
		return i
	}
	return -1
}

// takeLines returns the line matching prefix, plus n following lines, for
// diagnostic messages.
func takeLines(s, prefix string, n int) string {
	lines := strings.Split(s, "\n")
	for i, line := range lines {
		if strings.Contains(line, prefix) {
			end := i + n + 1
			if end > len(lines) {
				end = len(lines)
			}
			return strings.Join(lines[i:end], "\n")
		}
	}
	return ""
}
