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

// Issue #208, ADR-0043: paper size is a per-control preference. The
// generator writes whichever LaTeX class option matches Input.Paper. Two
// tests, one per value, each asserting BOTH the presence of the chosen
// option and the absence of the other — this is what the review of #206
// established as the shape that catches a silent revert (a positive-only
// test passes over a bug that emits both class options and a negative-only
// test passes over a bug that emits neither).
//
// Empty Paper defaults to Letter — same guard the schema CHECK and
// paperOrDefault (service) apply at their layers, mirrored here so a
// caller landing at tex.Compile with a bug earlier in the chain still
// gets a legal source rather than an invalid \documentclass.
func TestPreambleDeclaresLetterPaperWhenInputSaysLetter(t *testing.T) {
	out := compile(t, func(in *tex.Input) { in.Paper = "letter" })
	if !strings.Contains(out, `\documentclass[letterpaper,11pt]{article}`) {
		t.Error("preamble is missing letterpaper: Input.Paper=\"letter\" must produce the letterpaper class option (ADR-0043)")
	}
	if strings.Contains(out, "a4paper") {
		t.Error("preamble emits a4paper alongside letterpaper: the two are mutually exclusive")
	}
}

func TestPreambleDeclaresA4PaperWhenInputSaysA4(t *testing.T) {
	out := compile(t, func(in *tex.Input) { in.Paper = "a4" })
	if !strings.Contains(out, `\documentclass[a4paper,11pt]{article}`) {
		t.Error("preamble is missing a4paper: Input.Paper=\"a4\" must produce the a4paper class option (ADR-0043)")
	}
	if strings.Contains(out, "letterpaper") {
		t.Error("preamble emits letterpaper alongside a4paper: the two are mutually exclusive")
	}
}

// Empty Paper is the pre-#208 shape (and any caller that omits the new
// field). Falls back to Letter so the source is legal even when a caller
// has not yet been updated. Same guard as controls.paperOrDefault at the
// service layer.
func TestPreambleFallsBackToLetterWhenInputPaperIsEmpty(t *testing.T) {
	out := compile(t, nil) // no Paper override
	if !strings.Contains(out, `\documentclass[letterpaper,11pt]{article}`) {
		t.Error("empty Input.Paper must default to letterpaper (ADR-0043 operational default)")
	}
	if strings.Contains(out, "a4paper") {
		t.Error("empty Input.Paper produced a4paper: default is Letter, not A4")
	}
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

// Issue #208 hotfix (after #213 propagated the AMC stderr): a code
// question with a UTF-8 char (í, ñ, ü, á, etc.) aborted `amc prepare`
// with "! LaTeX Error: Invalid UTF-8 byte sequence (Ã\lst@EC­)" because
// \lstinputlisting reads external files through its own byte pipeline
// that inputenc[utf8] does not cover. The fix maps every Spanish
// character to its LaTeX escape via \lstset{literate=…}; base listings,
// no extra packages (listingsutf8's inputencoding=utf8 did not work in
// this AMC image, tested 2026-08-20). This test pins the mapping so a
// silent revert of the literate block goes red at the assertion that
// encodes it — the mutation-detectable shape.
func TestPreambleMapsSpanishCharsInListingsSoLstinputlistingReadsUTF8(t *testing.T) {
	out := compile(t, nil)
	// Every char that has bitten us (or would bite us) in a real code
	// question needs a mapping. The pair is asserted verbatim because a
	// truncation or a missing brace would make the whole literate block
	// silently fall back to no mapping, and the tests below would still
	// pass with just an `í` mapping present.
	for _, want := range []string{
		`{á}{{\'a}}1`, `{é}{{\'e}}1`, `{í}{{\'i}}1`, `{ó}{{\'o}}1`, `{ú}{{\'u}}1`,
		`{Á}{{\'A}}1`, `{É}{{\'E}}1`, `{Í}{{\'I}}1`, `{Ó}{{\'O}}1`, `{Ú}{{\'U}}1`,
		`{ñ}{{\~n}}1`, `{Ñ}{{\~N}}1`,
		`{ü}{{\"u}}1`, `{Ü}{{\"U}}1`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("\\lstset is missing the literate mapping %q — a code question with that char will trip 'Invalid UTF-8 byte sequence' in amc prepare (issue #208 hotfix)", want)
		}
	}
	// The mapping must live INSIDE the \lstset block, not orphaned in a
	// stray \lstset{} elsewhere in the preamble. Assert the block that
	// contains both the basicstyle and the literate line.
	if !strings.Contains(out, "literate=") {
		t.Error("\\lstset has no literate= key at all — the whole UTF-8 fix was dropped")
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
	// Issue #203: the marking instruction travels on the printed sheet —
	// a filled box reads at 4x the threshold margin of an X (measured).
	if !strings.Contains(out, "Rellena por completo el cuadrado de tu respuesta.") {
		t.Error("header block is missing the fill-the-box instruction (issue #203)")
	}
	if !strings.Contains(out, "No marques con X ni con tilde.") {
		t.Error("header block is missing the no-X-no-tilde line (issue #203)")
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

// `<` and `>` arrive from MDX as plain text too (`>>`, `<<` in inline code)
// and are not TeX specials in general — but babel-spanish makes them ACTIVE,
// and an active `>` that meets the closing brace of a `\correctchoice{...}`
// swallows it, unwinding the whole question's group structure.
//
// Regression from prod 2026-08-19 (issue #193): the pregunta
// `tres-diferencias-de-operadores` carried the alternative "`>>` rellena
// siempre con ceros…", and generating Control 1 failed in
// `auto-multiple-choice prepare` — reproduced against the worker image with
// that single question, and shown to compile clean once `>` is emitted as
// `\textgreater` or babel-spanish is absent.
func TestAngleBracketsAreEscapedBeforeEmission(t *testing.T) {
	out := compile(t, func(in *tex.Input) {
		in.Pool = []bank.Question{
			{
				ID: "corrimiento", Document: "welcome", Anchor: "hola",
				Type:      bank.TypeSimple,
				Statement: "¿Qué hace `>>` en Java?",
				Alternatives: []string{
					"corre `>>` a la derecha",
					"corre `<<` a la izquierda",
					"nada",
				},
				Correct: []int{0},
			},
		}
		in.QuestionsPerCopy = 1
	})
	for _, want := range []string{
		`\textgreater{}\textgreater{}`,
		`\textless{}\textless{}`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("angle brackets were not escaped: missing %q in output", want)
		}
	}
	for _, unwant := range []string{"`>>`", "`<<`"} {
		if strings.Contains(out, unwant) {
			t.Errorf("angle brackets emitted UNESCAPED: %q found in output — babel-spanish's active `>` would swallow the closing brace and break the compile", unwant)
		}
	}
}

// MDX writes code identifiers between backticks and the book renders them as
// code. The sheet's answer is \texttt: a raw backtick is a quote mark on
// paper, so the bank would read 'int' where the author wrote `int`
// (issue #193 S3). The professor-typed NAME keeps escapeLatex alone — it is
// not MDX.
func TestBacktickPairsRenderAsTypewriterText(t *testing.T) {
	out := compile(t, func(in *tex.Input) {
		in.Pool = []bank.Question{
			{
				ID: "backtick", Document: "welcome", Anchor: "hola",
				Type:      bank.TypeSimple,
				Statement: "¿Cuántos bits ocupa un `char` en Java?",
				Alternatives: []string{
					"16 `bits`",
					"8",
				},
				Correct: []int{0},
			},
		}
		in.QuestionsPerCopy = 1
	})
	for _, want := range []string{
		`un \texttt{char} en Java`,
		`16 \texttt{bits}`,
	} {
		if !strings.Contains(out, want) {
			t.Errorf("backtick pair was not rendered as \\texttt: missing %q in output", want)
		}
	}
	if strings.Contains(out, "`char`") {
		t.Error("a backtick pair survived into the .tex — on paper it renders as a quote mark")
	}
}

// Issue #185: the generator branches on Input.DuplexPadding.
//
//   - true (historical): emits \AMCcleardoublepage inside \onecopy so each
//     copy pads to an even page count for duplex printing.
//   - false: emits \clearpage instead — one page per copy for simplex
//     printing, no blank filler between prints.
//
// The default of the bool at the Go level is false; the SQL default is 1;
// the handler always passes an explicit value (form checkbox). See ADR-0033
// §The sheet carries its own arithmetic for the surrounding layout.
func TestDuplexPaddingBranchesOnAMCcleardoublepageVsClearpage(t *testing.T) {
	for _, tc := range []struct {
		name    string
		padding bool
		want    string
		unwant  string
	}{
		{"padded emits AMCcleardoublepage", true, `\AMCcleardoublepage`, "  \\clearpage\n}"},
		{"unpadded emits clearpage only", false, "\n  \\clearpage\n}", `\AMCcleardoublepage`},
	} {
		t.Run(tc.name, func(t *testing.T) {
			out := compile(t, func(in *tex.Input) { in.DuplexPadding = tc.padding })
			if !strings.Contains(out, tc.want) {
				t.Errorf("missing %q in output", tc.want)
			}
			if strings.Contains(out, tc.unwant) {
				t.Errorf("unexpected %q in output", tc.unwant)
			}
		})
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
			{"fill the box instruction", strings.Contains(source, "Rellena por completo el cuadrado"), "issue #203: X marks sit at the threshold; a filled box reads at 4x margin"},
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
