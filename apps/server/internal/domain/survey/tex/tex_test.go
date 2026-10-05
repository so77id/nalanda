package tex_test

import (
	"os"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/domain/survey/tex"
)

// The sheet the worker reads in apps/amc-worker/tests/08-survey.sh — the S0
// spike kept as a regression. Read from the worker's tree, like the
// controls' generator test reads control-demo.tex: the two must not drift.
const workerFixture = "../../../../../amc-worker/tests/fixtures/survey-demo.tex"

// fixtureInput is the bank survey-demo.tex prints.
func fixtureInput() tex.Input {
	return tex.Input{
		Title:  "Autoevaluación de conceptos",
		Copies: 3,
		Questions: []tex.Question{
			{Name: "q1", Kind: tex.Single, Section: "Contexto",
				Statement: "¿En qué sección estás?", Labels: []string{"A", "B", "C"}},
			{Name: "q2", Kind: tex.Scale, Section: "Confianza en los temas",
				Statement: "¿Qué tan clara te resultó la definición de TDA?",
				Labels:    []string{"Nada clara", "", "", "", "Muy clara"}},
			{Name: "q3", Kind: tex.Multi, Section: "Confianza en los temas",
				Statement: "¿Qué estructuras te costó más entender?",
				Labels:    []string{"ArrayList", "Lista enlazada", "Heap", "BST"},
				Guide:     "marca entre 1 y 3"},
			{Name: "q4", Kind: tex.Scale, Section: "Confianza en los temas",
				Statement: "El ritmo de las clases te pareció...",
				Labels:    []string{"lento", "adecuado", "rápido", "muy rápido"}},
		},
	}
}

// The generator's output for the fixture's bank IS the sheet S0 measured
// the worker reading (survey-demo.tex, below its comment header). Every
// load-bearing rule — no ID grid, authored order, one stand-in correct
// answer per simple question — is therefore checked against a sheet the
// real worker has read, not against this file's idea of it.
func TestTheGeneratorReproducesTheSheetTheWorkerReads(t *testing.T) {
	raw, err := os.ReadFile(workerFixture)
	if err != nil {
		t.Fatalf("reading the worker's fixture: %v", err)
	}
	var body []string
	for _, line := range strings.Split(string(raw), "\n") {
		if strings.HasPrefix(line, "%") {
			continue
		}
		body = append(body, line)
	}
	want := strings.TrimSpace(strings.Join(body, "\n"))

	got, err := tex.Compile(fixtureInput())
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	if strings.TrimSpace(got) != want {
		t.Errorf("the generator and the sheet the worker reads differ.\n--- generated ---\n%s\n--- survey-demo.tex ---\n%s", got, want)
	}
}

func TestTheSheetIsAnonymousAndUnshuffled(t *testing.T) {
	got, err := tex.Compile(fixtureInput())
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	for _, forbidden := range []string{`\namefield`, `\AMCcode`, `\shufflegroup`, `\element`, `\insertgroup`} {
		if strings.Contains(got, forbidden) {
			t.Errorf("the sheet contains %s", forbidden)
		}
	}
	if n := strings.Count(got, `\begin{choices}[o]`) + strings.Count(got, `\begin{choiceshoriz}[o]`); n != 4 {
		t.Errorf("%d ordered choice environments, want one per question (4)", n)
	}
	if strings.Count(got, `\begin{choices}`)+strings.Count(got, `\begin{choiceshoriz}`) != 4 {
		t.Error("an unordered choice environment slipped in")
	}
}

func TestEverySimpleQuestionHasExactlyOneStandInAndAMultiNone(t *testing.T) {
	got, _ := tex.Compile(fixtureInput())
	// Three simple questions (q1, q2, q4) → three \correctchoice; q3 none.
	if n := strings.Count(got, `\correctchoice`); n != 3 {
		t.Errorf("%d \\correctchoice, want exactly one per simple question (3)", n)
	}
	multi := got[strings.Index(got, `\begin{questionmult}`):strings.Index(got, `\end{questionmult}`)]
	if strings.Contains(multi, `\correctchoice`) {
		t.Error("the multi-select carries a \\correctchoice")
	}
}

func TestProfessorTypedTextCannotEscapeIntoTeX(t *testing.T) {
	in := fixtureInput()
	in.Title = `Encuesta \input{/etc/passwd} 100% & #1`
	in.Description = "línea uno\n\nlínea dos"
	in.Questions[0].Statement = `¿\write18{rm -rf /}? {sin cerrar ^_~ $x$ <b>`
	in.Questions[0].Labels = []string{"a ≤ b → c", "emoji 🎉", "“comillas” — y…"}
	in.Questions[0].Section = "Sec}ción"

	got, err := tex.Compile(in)
	if err != nil {
		t.Fatalf("Compile: %v", err)
	}
	for _, raw := range []string{`\input{`, `\write18{`, "100% ", " & ", " #1", "? {sin cerrar", "Sec}ción", "🎉", "\n\nlínea dos"} {
		if strings.Contains(got, raw) {
			t.Errorf("unescaped %q reached the source", raw)
		}
	}
	for _, escaped := range []string{
		`\textbackslash{}input\{/etc/passwd\}`, `100\%`, `\&`, `\#1`, `\textbackslash{}write18\{rm -rf /\}`,
		`\{sin cerrar \^{}\_\~{} \$x\$ \textless{}b\textgreater{}`, `Sec\}ción`,
		`a $\leq$ b $\rightarrow$ c`, "emoji ?", "“comillas” — y…", "línea uno  línea dos",
	} {
		if !strings.Contains(got, escaped) {
			t.Errorf("the source lacks %q", escaped)
		}
	}
}

func TestSectionHeadingsFollowPrintOrderRuns(t *testing.T) {
	in := fixtureInput()
	// Context first (printed), then the rest: two runs of "Confianza…"
	// separated by an unlabelled question must print the heading twice.
	in.Questions = []tex.Question{
		{Name: "q1", Kind: tex.Single, Section: "A", Statement: "1", Labels: []string{"x", "y"}},
		{Name: "q2", Kind: tex.Single, Section: "", Statement: "2", Labels: []string{"x", "y"}},
		{Name: "q3", Kind: tex.Single, Section: "A", Statement: "3", Labels: []string{"x", "y"}},
	}
	got, _ := tex.Compile(in)
	if n := strings.Count(got, `\subsection*{A}`); n != 2 {
		t.Errorf("heading A printed %d times, want 2 (one per run)", n)
	}
}

func TestCompileRefusesWhatCannotBePrinted(t *testing.T) {
	cases := map[string]func(*tex.Input){
		"no copies":       func(in *tex.Input) { in.Copies = 0 },
		"too many copies": func(in *tex.Input) { in.Copies = tex.MaxCopies + 1 },
		"no questions":    func(in *tex.Input) { in.Questions = nil },
		"no alternatives": func(in *tex.Input) { in.Questions[0].Labels = nil },
		"an unknown kind": func(in *tex.Input) { in.Questions[0].Kind = 99 },
	}
	for name, mutate := range cases {
		in := fixtureInput()
		mutate(&in)
		if _, err := tex.Compile(in); err == nil {
			t.Errorf("%s: compiled, want a refusal", name)
		}
	}
}

func TestQuestionNameIsTheBankID(t *testing.T) {
	if got := tex.QuestionName(42); got != "q42" {
		t.Errorf("QuestionName(42) = %q", got)
	}
}
