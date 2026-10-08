package handler_test

import (
	"context"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"testing"

	"github.com/so77id/nalanda/apps/server/internal/app/web/handler"
	"github.com/so77id/nalanda/apps/server/internal/domain/survey"
	"github.com/so77id/nalanda/apps/server/internal/infra/storage/surveystore"
)

// Screens 4 and 4b of epic #308 (issue #309 S6): the question forms of the
// three kinds, and delete / move from the bank.

func questionsPath(s survey.Survey) string { return handler.SurveyPathFor(s.ID) + "/questions" }

func questionBase(s survey.Survey, q survey.Question) string {
	return handler.SurveyPathFor(s.ID) + "/questions/" + strconv.FormatInt(q.ID, 10)
}

func (f *surveyFixture) questionValues(s survey.Survey, q survey.Question) []string {
	return []string{"id", strconv.FormatInt(s.ID, 10), "qid", strconv.FormatInt(q.ID, 10)}
}

func (f *surveyFixture) bank(s survey.Survey) []survey.Question {
	f.t.Helper()
	qs, err := f.surveys.Questions(context.Background(), s.ID)
	if err != nil {
		f.t.Fatalf("Questions: %v", err)
	}
	return qs
}

func labelsOf(q survey.Question) string {
	out := make([]string, len(q.Alternatives))
	for i, a := range q.Alternatives {
		out[i] = a.Label
	}
	return strings.Join(out, "|")
}

func TestTheNewQuestionFormRendersEachKind(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")

	cases := []struct {
		kind   string
		has    []string
		hasNot []string
	}{
		{"single", []string{`name="alternative"`, `name="is_context"`, "<strong>[Opción única]</strong>"},
			[]string{`name="scale_label"`, `name="min_marks"`}},
		{"scale", []string{`name="scale_label"`, `name="points"`, `value="Muy en desacuerdo"`, "<strong>[Escala]</strong>"},
			[]string{`name="alternative"`, `name="is_context"`}},
		{"multi", []string{`name="alternative"`, `name="min_marks"`, `name="max_marks"`},
			[]string{`name="is_context"`, `name="scale_label"`}},
		// An unknown kind falls back to single choice.
		{"ranking", []string{`name="is_context"`}, nil},
	}
	for _, tc := range cases {
		t.Run(tc.kind, func(t *testing.T) {
			rec := f.do(http.MethodGet, questionsPath(s)+"/new?kind="+tc.kind, f.handler.NewQuestion, nil, f.surveyValue(s)...)
			if rec.Code != http.StatusOK {
				t.Fatalf("status = %d", rec.Code)
			}
			body := rec.Body.String()
			for _, want := range tc.has {
				if !strings.Contains(body, want) {
					t.Errorf("lacks %s", want)
				}
			}
			for _, unwanted := range tc.hasNot {
				if strings.Contains(body, unwanted) {
					t.Errorf("has %s", unwanted)
				}
			}
		})
	}
}

func TestCreatingAQuestionOfEachKindAppendsItToTheBank(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")

	posts := []url.Values{
		{"kind": {"single"}, "statement": {"¿En qué sección estás?"}, "section": {"Contexto"},
			"is_context": {"1"}, "alternative": {"A", "B", "", "C", "", "", "", "", "", ""}},
		{"kind": {"scale"}, "statement": {"¿Ritmo?"}, "points": {"4"},
			"scale_label": {"lento", "adecuado", "rápido", "muy rápido", "sobra", "", ""}},
		{"kind": {"multi"}, "statement": {"¿Cuáles costaron?"}, "min_marks": {"1"}, "max_marks": {"2"},
			"alternative": {"Heap", "BST", "Stack", "", "", "", "", "", "", ""}},
	}
	for i, form := range posts {
		rec := f.do(http.MethodPost, questionsPath(s), f.handler.CreateQuestion, form, f.surveyValue(s)...)
		if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.SurveyPathFor(s.ID) {
			t.Fatalf("post %d: status = %d, Location = %q\n%s", i, rec.Code, rec.Header().Get("Location"), rec.Body.String())
		}
	}

	bank := f.bank(s)
	if len(bank) != 3 {
		t.Fatalf("the bank holds %d questions, want 3", len(bank))
	}
	if q := bank[0]; q.Kind != survey.KindSingle || !q.IsContext || q.Section != "Contexto" || labelsOf(q) != "A|B|C" {
		t.Errorf("single: %+v", q)
	}
	// A 4-point scale keeps its first four labels and drops the rest.
	if q := bank[1]; q.Kind != survey.KindScale || labelsOf(q) != "lento|adecuado|rápido|muy rápido" {
		t.Errorf("scale: %+v (labels %s)", q, labelsOf(q))
	}
	if q := bank[2]; q.Kind != survey.KindMulti || q.MinMarks == nil || *q.MinMarks != 1 || q.MaxMarks == nil || *q.MaxMarks != 2 {
		t.Errorf("multi: %+v", q)
	}
}

func TestARefusedQuestionIs422WithWhatWasTyped(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")

	cases := []struct {
		name string
		form url.Values
		want string
	}{
		{"one alternative", url.Values{"kind": {"single"}, "statement": {"¿lo que escribí?"}, "alternative": {"Sola"}},
			"Escribe al menos 2 alternativas."},
		{"a scale of eight", url.Values{"kind": {"scale"}, "statement": {"¿lo que escribí?"}, "points": {"8"}},
			"Una escala tiene entre 3 y 7 puntos."},
		{"a word for a number", url.Values{"kind": {"multi"}, "statement": {"¿lo que escribí?"},
			"alternative": {"A", "B"}, "min_marks": {"dos"}}, "Escribe un número entero"},
		{"a context multi", url.Values{"kind": {"multi"}, "statement": {"¿lo que escribí?"},
			"alternative": {"A", "B"}, "is_context": {"1"}}, "Solo una pregunta de opción única puede ser de contexto."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rec := f.do(http.MethodPost, questionsPath(s), f.handler.CreateQuestion, tc.form, f.surveyValue(s)...)
			if rec.Code != http.StatusUnprocessableEntity {
				t.Fatalf("status = %d, want 422", rec.Code)
			}
			body := rec.Body.String()
			if !strings.Contains(body, tc.want) || !strings.Contains(body, "¿lo que escribí?") {
				t.Errorf("the re-render lacks %q or the typed statement", tc.want)
			}
		})
	}
	if n := len(f.bank(s)); n != 0 {
		t.Errorf("refused questions reached the bank: %d", n)
	}
}

func TestEditingAQuestionPrefillsItAndRewritesIt(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	q := f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿Antes?", Labels: []string{"A", "B"}})

	rec := f.do(http.MethodGet, questionBase(s, q)+"/edit", f.handler.EditQuestion, nil, f.questionValues(s, q)...)
	if body := rec.Body.String(); rec.Code != http.StatusOK || !strings.Contains(body, "¿Antes?") || !strings.Contains(body, `value="B"`) {
		t.Fatalf("the edit form is not pre-filled (status %d)", rec.Code)
	}
	// Switching kind on an edit keeps what carries over.
	rec = f.do(http.MethodGet, questionBase(s, q)+"/edit?kind=multi", f.handler.EditQuestion, nil, f.questionValues(s, q)...)
	if body := rec.Body.String(); !strings.Contains(body, "¿Antes?") || !strings.Contains(body, `name="max_marks"`) {
		t.Error("switching to multi lost the statement or did not render the multi fields")
	}

	rec = f.do(http.MethodPost, questionBase(s, q)+"/edit", f.handler.UpdateQuestion,
		url.Values{"kind": {"single"}, "statement": {"¿Después?"}, "alternative": {"X", "Y", "Z"}}, f.questionValues(s, q)...)
	if rec.Code != http.StatusSeeOther {
		t.Fatalf("status = %d\n%s", rec.Code, rec.Body.String())
	}
	if got := f.bank(s)[0]; got.Statement != "¿Después?" || labelsOf(got) != "X|Y|Z" {
		t.Errorf("stored %+v", got)
	}
}

func TestDeletingAndMovingQuestionsFromTheBank(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	one := f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿1?", Labels: []string{"A", "B"}})
	two := f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿2?", Labels: []string{"A", "B"}})
	f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿3?", Labels: []string{"A", "B"}})

	order := func() string {
		var out []string
		for _, q := range f.bank(s) {
			out = append(out, q.Statement)
		}
		return strings.Join(out, ",")
	}

	rec := f.do(http.MethodPost, questionBase(s, two)+"/move", f.handler.MoveQuestion, url.Values{"dir": {"up"}}, f.questionValues(s, two)...)
	if rec.Code != http.StatusSeeOther || order() != "¿2?,¿1?,¿3?" {
		t.Errorf("move up: status = %d, bank = %s", rec.Code, order())
	}
	rec = f.do(http.MethodPost, questionBase(s, two)+"/move", f.handler.MoveQuestion, url.Values{"dir": {"sideways"}}, f.questionValues(s, two)...)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Errorf("an unknown direction: status = %d, want 422", rec.Code)
	}

	rec = f.do(http.MethodPost, questionBase(s, one)+"/delete", f.handler.DeleteQuestion, url.Values{}, f.questionValues(s, one)...)
	if rec.Code != http.StatusSeeOther || order() != "¿2?,¿3?" {
		t.Errorf("delete: status = %d, bank = %s", rec.Code, order())
	}
	if !strings.Contains(flashOf(t, rec), "borrada") {
		t.Errorf("flash = %q", flashOf(t, rec))
	}

	// The bank page offers ↑ on all but the first and ↓ on all but the last.
	page := f.do(http.MethodGet, handler.SurveyPathFor(s.ID), f.handler.Detail, nil, f.surveyValue(s)...).Body.String()
	if strings.Count(page, `aria-label="Subir la pregunta`) != 1 || strings.Count(page, `aria-label="Bajar la pregunta`) != 1 {
		t.Errorf("a two-question bank should offer one ↑ and one ↓")
	}
}

func TestAQuestionOfAnotherSurveyIs404ThroughThisSurveysURL(t *testing.T) {
	f := newSurveyFixture(t)
	mine := f.createSurvey("Mía")
	other := f.createSurvey("Otra")
	theirs := f.addQuestion(other, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿ajena?", Labels: []string{"A", "B"}})

	values := []string{"id", strconv.FormatInt(mine.ID, 10), "qid", strconv.FormatInt(theirs.ID, 10)}
	for name, h := range map[string]http.HandlerFunc{
		"edit": f.handler.EditQuestion, "update": f.handler.UpdateQuestion,
		"delete": f.handler.DeleteQuestion, "move": f.handler.MoveQuestion,
	} {
		method := http.MethodPost
		if name == "edit" {
			method = http.MethodGet
		}
		rec := f.do(method, questionBase(mine, theirs)+"/"+name, h,
			url.Values{"kind": {"single"}, "statement": {"¿?"}, "alternative": {"A", "B"}, "dir": {"up"}}, values...)
		if rec.Code != http.StatusNotFound {
			t.Errorf("%s: status = %d, want 404", name, rec.Code)
		}
	}
	if got := f.bank(other)[0]; got.Statement != "¿ajena?" {
		t.Errorf("the other survey's question changed: %+v", got)
	}
}

// Screen 5 (issue #309 S7): the preview is an HTML approximation, and says
// so; a scale lays its points out in a row with their numbers, the others
// list lettered bubbles.
func TestThePreviewApproximatesThePrintedQuestion(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	multi := f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindMulti, Statement: "¿Qué estructuras te costaron?",
		Labels: []string{"ArrayList", "Heap"}, MaxMarks: func() *int { n := 2; return &n }()})
	scale := f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindScale, Statement: "¿Qué tan clara?",
		Labels: []string{"Nada", "", "Muy"}})

	body := f.do(http.MethodGet, questionBase(s, multi)+"/preview", f.handler.PreviewQuestion, nil, f.questionValues(s, multi)...).Body.String()
	for _, want := range []string{"Aproximación", "1. ¿Qué estructuras te costaron?", "A&nbsp;&nbsp;ArrayList", "B&nbsp;&nbsp;Heap", "(marca hasta 2)"} {
		if !strings.Contains(body, want) {
			t.Errorf("the multi preview lacks %q", want)
		}
	}

	body = f.do(http.MethodGet, questionBase(s, scale)+"/preview", f.handler.PreviewQuestion, nil, f.questionValues(s, scale)...).Body.String()
	if !strings.Contains(body, `class="survey-preview-scale"`) || !strings.Contains(body, " 1<br />Nada") || !strings.Contains(body, " 3<br />Muy") {
		t.Errorf("the scale preview is not a numbered row:\n%s", body)
	}

	// The bank links to it.
	page := f.do(http.MethodGet, handler.SurveyPathFor(s.ID), f.handler.Detail, nil, f.surveyValue(s)...).Body.String()
	if !strings.Contains(page, questionBase(s, scale)+"/preview") {
		t.Error("the bank does not link to the preview")
	}
}

// #309 review, COR-3: an unparsable number must not hide the rest of the
// draft's problems to the next submit.
func TestAnUnparsableNumberDoesNotHideTheOtherProblems(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	rec := f.do(http.MethodPost, questionsPath(s), f.handler.CreateQuestion,
		url.Values{"kind": {"multi"}, "statement": {""}, "alternative": {"A", "B"}, "min_marks": {"dos"}}, f.surveyValue(s)...)
	if rec.Code != http.StatusUnprocessableEntity {
		t.Fatalf("status = %d, want 422", rec.Code)
	}
	body := rec.Body.String()
	for _, want := range []string{"Escribe un número entero", "Escribe el enunciado."} {
		if !strings.Contains(body, want) {
			t.Errorf("the re-render lacks %q", want)
		}
	}
}

// Issue #310 S2: once a run exists the bank's existing questions are
// locked, and a refused write is a flash on the survey page, not a 500.
func TestALockedBankRefusesEditsWithAFlashAndStillTakesNewQuestions(t *testing.T) {
	f := newSurveyFixture(t)
	s := f.createSurvey("Banco")
	q := f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿1?", Labels: []string{"A", "B"}})
	f.addQuestion(s, survey.QuestionDraft{Kind: survey.KindSingle, Statement: "¿2?", Labels: []string{"A", "B"}})
	if _, _, err := surveystore.New(f.db).CreateRun(context.Background(), survey.Run{
		SurveyID: s.ID, AppliedOn: "2026-10-15", Copies: 10, CreatedBy: f.professor.ID, CreatedAt: f.now,
	}); err != nil {
		t.Fatalf("CreateRun: %v", err)
	}

	for name, h := range map[string]http.HandlerFunc{
		"update": f.handler.UpdateQuestion, "delete": f.handler.DeleteQuestion, "move": f.handler.MoveQuestion,
	} {
		rec := f.do(http.MethodPost, questionBase(s, q)+"/"+name, h,
			url.Values{"kind": {"single"}, "statement": {"¿cambiada?"}, "alternative": {"X", "Y"}, "dir": {"down"}},
			f.questionValues(s, q)...)
		if rec.Code != http.StatusSeeOther || rec.Header().Get("Location") != handler.SurveyPathFor(s.ID) {
			t.Errorf("%s: status = %d, Location = %q; want 303 to the survey", name, rec.Code, rec.Header().Get("Location"))
		}
		if !strings.Contains(flashOf(t, rec), "ya tiene una pasada") {
			t.Errorf("%s: flash = %q", name, flashOf(t, rec))
		}
	}
	if got := f.bank(s); len(got) != 2 || got[0].Statement != "¿1?" {
		t.Errorf("the locked bank changed: %+v", got)
	}

	rec := f.do(http.MethodPost, questionsPath(s), f.handler.CreateQuestion,
		url.Values{"kind": {"single"}, "statement": {"¿3?"}, "alternative": {"A", "B"}}, f.surveyValue(s)...)
	if rec.Code != http.StatusSeeOther || len(f.bank(s)) != 3 {
		t.Errorf("appending to a locked bank: status = %d, bank size = %d; want it allowed", rec.Code, len(f.bank(s)))
	}
}
